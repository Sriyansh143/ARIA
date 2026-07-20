#!/usr/bin/env node
// =====================================================================
// start-fleets.js -- Start all 18 mini-services (agent fleets).
// =====================================================================
// Phase 46 fixes:
//   - Runs `npm install` in each mini-service BEFORE starting (fixes
//     "Cannot find module 'socket.io'" reliably on Windows)
//   - Adds .on('error') handler to log streams (fixes EBUSY crash)
//   - Uses append mode for logs
//   - Local tsx resolution (auto-install if missing)
//   - Staged boot (Tier 1 -> 2 -> 3) with health checks
// =====================================================================

const { spawn, spawnSync } = require('child_process')
const { existsSync, mkdirSync, createWriteStream, readFileSync } = require('fs')
const { join, resolve } = require('path')
const { platform } = require('os')

const ROOT = resolve(__dirname, '..')
const LOG_DIR = join(ROOT, 'logs')
if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true })

const isWindows = platform() === 'win32'

// ─── Load .env into process.env ──────────────────────────────────────
const envPath = join(ROOT, '.env')
if (existsSync(envPath)) {
  const envContent = readFileSync(envPath, 'utf-8')
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx).trim()
    let value = trimmed.slice(eqIdx + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    process.env[key] = value
  }
}

// ─── Service definitions with boot tiers ─────────────────────────────
const SERVICES = [
  { name: 'credential-vault', port: 3011, tier: 1, always: true },
  { name: 'vector-memory',    port: 3010, tier: 1, always: true },
  { name: 'agent-status',     port: 3003, tier: 2, always: true },
  { name: 'heartbeat',        port: 3005, tier: 2, always: true },
  { name: 'agent-comms',      port: 3012, tier: 2, always: true },
  { name: 'system-monitor',   port: 3009, tier: 2, always: true },
  { name: 'process-manager',  port: 3006, tier: 3, always: true },
  { name: 'screen-viewer',    port: 3007, tier: 3, always: true, disableKey: 'JARVIS_DISABLE_SCREEN_VIEWER' },
  { name: 'telegram-bot',     port: 3008, tier: 3, always: true },
  { name: 'browser-login',    port: 3004, tier: 3, always: true },
  { name: 'orchestrator',     port: 3013, tier: 3, always: true },
  { name: 'planner',          port: 3018, tier: 3, always: true },
  { name: 'department-supervisor', port: 3019, tier: 3, always: true },
  { name: 'autonomous-loop',       port: 3020, tier: 3, always: true },
  { name: 'okara-crawler',    port: 3014, tier: 3, always: false, toggle: 'PHASE17_OKARA_ENABLED' },
  { name: 'mcts-engine',      port: 3015, tier: 3, always: false, toggle: 'PHASE17_MCTS_ENABLED', disableKey: 'JARVIS_DISABLE_MCTS' },
  { name: 'mcp-gateway',      port: 3016, tier: 3, always: false, toggle: 'PHASE17_MCP_ENABLED' },
  { name: 'tmux-bridge',      port: 3017, tier: 3, always: false, toggle: 'PHASE17_TMUX_ENABLED' },
]

// ─── Resolve tsx command ─────────────────────────────────────────────
function resolveTsx() {
  const nodeModulesPath = join(ROOT, 'node_modules')
  const tsxCliPath = join(nodeModulesPath, 'tsx', 'dist', 'cli.mjs')
  if (existsSync(tsxCliPath)) {
    return { type: 'local', cmd: 'node', args: [tsxCliPath] }
  }
  const binName = isWindows ? 'tsx.cmd' : 'tsx'
  const binPath = join(nodeModulesPath, '.bin', binName)
  if (existsSync(binPath)) {
    return { type: 'bin', cmd: binPath, args: [] }
  }
  console.log('[fleets] tsx not found - installing...')
  spawnSync('npm', ['install', 'tsx@latest', '--no-save', '--silent'], {
    cwd: ROOT, stdio: 'inherit', shell: isWindows,
  })
  if (existsSync(tsxCliPath)) {
    return { type: 'local', cmd: 'node', args: [tsxCliPath] }
  }
  console.log('[fleets] Using npx -y tsx as fallback')
  const npxCmd = isWindows ? 'npx.cmd' : 'npx'
  return { type: 'npx', cmd: npxCmd, args: ['-y', 'tsx'] }
}

const tsx = resolveTsx()
const NODE_PATH = join(ROOT, 'node_modules')

// FEAT-4 / Feature 3 — one-shot flag so we only log the JARVIS_SHARED_KEY
// propagation status once (on the first service start) instead of 18×.
let _keyPropagationLogged = false

// ─── Phase 46: Install deps for each mini-service ────────────────────
// This is the RELIABLE fix for "Cannot find module 'socket.io'" on Windows.
// tsx resolves modules relative to the FILE, not cwd. Each mini-service
// has its own package.json listing socket.io. We must run npm install
// in each mini-service so it gets its own node_modules/socket.io.
function ensureServiceDeps(svcName) {
  const svcDir = join(ROOT, 'mini-services', svcName)
  const pkgJsonPath = join(svcDir, 'package.json')
  const nodeModulesPath = join(svcDir, 'node_modules')

  if (!existsSync(pkgJsonPath)) return true // no package.json = no deps

  // Check if node_modules already has the deps installed
  const lockfile = join(nodeModulesPath, '.package-lock.json')
  if (existsSync(lockfile)) return true // already installed

  // Run npm install in the mini-service directory
  console.log(`[fleets]   installing deps for ${svcName}...`)
  try {
    const result = spawnSync('npm', ['install', '--no-audit', '--no-fund', '--silent'], {
      cwd: svcDir,
      stdio: 'pipe',
      shell: isWindows,
      timeout: 60000,
    })
    if (result.status !== 0) {
      // Fallback: try creating a junction to root node_modules
      console.log(`[fleets]   npm install failed for ${svcName}, trying junction...`)
      try {
        if (isWindows) {
          require('fs').symlinkSync(NODE_PATH, nodeModulesPath, 'junction')
        } else {
          require('fs').symlinkSync(NODE_PATH, nodeModulesPath, 'dir')
        }
        console.log(`[fleets]   junction created for ${svcName}`)
        return true
      } catch {
        console.error(`[fleets]   FAILED to setup deps for ${svcName}`)
        return false
      }
    }
    return true
  } catch (err) {
    console.error(`[fleets]   deps install error for ${svcName}: ${err.message}`)
    return false
  }
}

// ─── Kill anything on our ports ──────────────────────────────────────
// FIX (audit 2026-07-07, regression from phase46): The previous Windows
// implementation used a complex cmd.exe `for /f` one-liner that silently
// failed to actually kill the listening processes (the `^|` escapes were
// being interpreted incorrectly when passed through spawnSync). The
// result was that `npm run fleets` run after `start-jarvis-all.bat`
// would try to bind to ports already held by the still-running previous
// instances → EADDRINUSE → "FAIL" log lines, then "OK" on the health
// check (because the OLD instance responded).
//
// The new implementation:
//   1. Parses `netstat -ano` output in Node.js (no cmd.exe quoting issues)
//   2. Calls `taskkill /F /PID <pid>` for each PID listening on our ports
//   3. Also kills the dashboard on port 3000 (so prisma generate later
//      doesn't hit EPERM on the query engine DLL).
//   4. Waits up to 3s after killing for the OS to release the ports
//      (TIME_WAIT / graceful shutdown).
function killStalePorts() {
  const portsToClear = SERVICES.map(s => s.port)
  // ALSO include 3000 (dashboard) so a subsequent `npm run dev` or
  // `start-jarvis-all.bat` doesn't fight a stale dashboard instance.
  portsToClear.push(3000)

  console.log(`[fleets] Clearing ports 3000,3003-3020...`)

  // Collect all PIDs listening on any of our ports
  const pidsToKill = new Set()
  try {
    const netstat = isWindows
      ? spawnSync('netstat', ['-ano'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      : spawnSync('sh', ['-c', `lsof -ti -i :${portsToClear.join(',')} 2>/dev/null || true`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })

    if (isWindows) {
      const lines = (netstat.stdout || '').split(/\r?\n/)
      for (const line of lines) {
        // Match lines like:
        //   TCP    127.0.0.1:3009    0.0.0.0:0    LISTENING    12345
        //   TCP    0.0.0.0:3009      0.0.0.0:0    LISTENING    12345
        //   TCP    [::]:3009         [::]:0       LISTENING    12345
        const trimmed = line.trim()
        if (!trimmed || !trimmed.includes('LISTENING')) continue
        const parts = trimmed.split(/\s+/)
        if (parts.length < 5) continue
        const localAddr = parts[1] // e.g. "127.0.0.1:3009"
        const pidStr = parts[parts.length - 1]
        const colonIdx = localAddr.lastIndexOf(':')
        if (colonIdx === -1) continue
        const portStr = localAddr.slice(colonIdx + 1)
        const port = parseInt(portStr, 10)
        if (portsToClear.includes(port)) {
          const pid = parseInt(pidStr, 10)
          if (Number.isFinite(pid) && pid > 0 && pid !== process.pid) {
            pidsToKill.add(pid)
          }
        }
      }
    } else {
      // lsof output: one PID per line
      for (const line of (netstat.stdout || '').split(/\r?\n/)) {
        const pid = parseInt(line.trim(), 10)
        if (Number.isFinite(pid) && pid > 0 && pid !== process.pid) {
          pidsToKill.add(pid)
        }
      }
    }
  } catch (err) {
    console.warn(`[fleets]   netstat parsing warning: ${err.message}`)
  }

  // Kill each unique PID
  for (const pid of pidsToKill) {
    try {
      if (isWindows) {
        spawnSync('taskkill', ['/F', '/PID', String(pid)], { stdio: 'ignore' })
      } else {
        process.kill(pid, 'SIGKILL')
      }
      console.log(`[fleets]   killed PID ${pid}`)
    } catch {}
  }

  if (pidsToKill.size === 0) {
    console.log('[fleets]   (no stale processes found)')
  }

  // Wait for the OS to actually release the ports (TIME_WAIT, graceful
  // shutdown of child handlers, etc.). Without this wait, the new spawn
  // can race the OS and still hit EADDRINUSE.
  // Use a synchronous 2-second block via Atomics.wait on a shared buffer.
  try {
    const buf = new Int32Array(new SharedArrayBuffer(4))
    Atomics.wait(buf, 0, 0, 2000)
  } catch {
    // Fallback: tiny busy-wait (only if SharedArrayBuffer unavailable)
    const start = Date.now()
    while (Date.now() - start < 2000) {}
  }
}

// ─── Create a safe log stream (EBUSY-proof) ──────────────────────────
function createSafeLogStream(logFile) {
  try {
    const stream = createWriteStream(logFile, { flags: 'a' })
    // CRITICAL: handle 'error' event to prevent unhandled crash
    // This fixes "EBUSY: resource busy or locked" on Windows
    stream.on('error', (err) => {
      // Silently ignore — the service can still run without log file
    })
    return stream
  } catch {
    return { write: () => {}, end: () => {}, on: () => {} }
  }
}

// ─── Start a single service ──────────────────────────────────────────
function startService(svc) {
  const svcDir = join(ROOT, 'mini-services', svc.name)
  const svcIndex = join(svcDir, 'index.ts')
  if (!existsSync(svcIndex)) {
    console.log(`[fleets] SKIP ${svc.name} (no index.ts)`)
    return false
  }

  if (svc.disableKey && process.env[svc.disableKey] === 'true') {
    console.log(`[fleets] SKIP ${svc.name} (${svc.disableKey}=true)`)
    return false
  }

  if (!svc.always && svc.toggle && process.env[svc.toggle] !== 'true') {
    console.log(`[fleets] SKIP ${svc.name} (${svc.toggle} != true)`)
    return false
  }

  // Ensure deps are installed
  if (!ensureServiceDeps(svc.name)) {
    console.log(`[fleets] SKIP ${svc.name} (deps install failed)`)
    return false
  }

  const logFile = join(LOG_DIR, `${svc.name}.log`)
  const logStream = createSafeLogStream(logFile)
  let stderrBuffer = ''

  const env = {
    ...process.env,
    NODE_PATH,
    NODE_ENV: 'development',
  }

  // FEAT-4 / Feature 3 — sanity-check that JARVIS_SHARED_KEY propagated
  // to the child env. If the operator set it in .env but the child
  // doesn't see it, every mini-service will run in dev mode (no auth)
  // — defeating the whole point of auth propagation. Log once on the
  // first service start.
  if (!_keyPropagationLogged) {
    _keyPropagationLogged = true
    if (env.JARVIS_SHARED_KEY) {
      console.log(`[fleets] JARVIS_SHARED_KEY propagated to mini-service env (auth ENABLED)`)
    } else {
      console.log(`[fleets] JARVIS_SHARED_KEY not set — mini-service auth DISABLED (dev mode). Set it in .env to enforce X-JARVIS-Key.`)
    }
  }

  const child = spawn(tsx.cmd, [...tsx.args, svcIndex], {
    cwd: ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  })

  child.stdout?.on('data', (data) => {
    try { logStream.write(data) } catch {}
  })

  child.stderr?.on('data', (data) => {
    try { logStream.write(data) } catch {}
    stderrBuffer += data.toString()
    if (stderrBuffer.length > 2000) {
      stderrBuffer = stderrBuffer.slice(-2000)
    }
  })

  child.on('error', (err) => {
    console.log(`[fleets] FAIL ${svc.name} spawn error: ${err.message}`)
  })

  child.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      console.log(`[fleets] FAIL ${svc.name} exited with code ${code}`)
      const errLines = stderrBuffer.split('\n').filter(l => l.trim()).slice(0, 5)
      if (errLines.length > 0) {
        for (const line of errLines) {
          console.log(`[fleets]   ${line.slice(0, 200)}`)
        }
      } else {
        console.log(`[fleets]   (check logs/${svc.name}.log)`)
      }
    } else if (code === 0) {
      console.log(`[fleets] STOP ${svc.name} exited cleanly`)
    }
  })

  console.log(`[fleets] START ${svc.name} -> port ${svc.port} (PID ${child.pid})`)
  return true
}

// ─── Health check ────────────────────────────────────────────────────
function checkPort(port, name) {
  const http = require('http')
  const healthPath = name === 'telegram-bot' ? '/status' : '/health'
  return new Promise((resolve) => {
    const req = http.get({
      hostname: '127.0.0.1', port, path: healthPath, timeout: 5000,
      headers: { 'User-Agent': 'jarvis-fleets-healthcheck' },
    }, (res) => {
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => resolve(data.trim().length > 0))
    })
    req.on('error', () => resolve(false))
    req.on('timeout', () => { req.destroy(); resolve(false) })
  })
}

// ─── Main: staged boot ───────────────────────────────────────────────
async function main() {
  console.log('')
  console.log('================================================================')
  console.log('  JARVIS Agent Fleet Engine -- Starting 18 mini-services')
  console.log('  (Staged boot: Tier 1 DB -> Tier 2 telemetry -> Tier 3 apps)')
  console.log('================================================================')
  console.log(`  tsx mode: ${tsx.type}`)
  console.log(`  NODE_PATH: ${NODE_PATH}`)
  console.log('')

  killStalePorts()

  // Phase 46: Pre-install all mini-service deps in parallel
  console.log('[fleets] Pre-installing mini-service dependencies...')
  const servicesToStart = SERVICES.filter(svc => {
    if (svc.disableKey && process.env[svc.disableKey] === 'true') return false
    if (!svc.always && svc.toggle && process.env[svc.toggle] !== 'true') return false
    return existsSync(join(ROOT, 'mini-services', svc.name, 'index.ts'))
  })

  for (const svc of servicesToStart) {
    ensureServiceDeps(svc.name)
  }
  console.log('[fleets] Dependencies ready.\n')

  const tiers = [1, 2, 3]
  let started = 0

  for (const tier of tiers) {
    const tierServices = SERVICES.filter(s => s.tier === tier)
    if (tierServices.length === 0) continue

    console.log(`\n[fleets] --- Tier ${tier}: ${tierServices.map(s => s.name).join(', ')} ---`)

    for (const svc of tierServices) {
      if (startService(svc)) started++
    }

    const waitMs = tier === 1 ? 6000 : tier === 2 ? 6000 : 5000
    console.log(`[fleets]   waiting ${waitMs / 1000}s for tier ${tier}...`)
    await new Promise(r => setTimeout(r, waitMs))

    for (const svc of tierServices) {
      const up = await checkPort(svc.port, svc.name)
      console.log(`[fleets]   ${up ? 'OK ' : '.. '} :${svc.port} ${svc.name}`)
    }
  }

  console.log('')
  console.log(`[fleets] ${started} service(s) started. Logs in logs/ directory.`)

  console.log('\n[fleets] Final fleet status:')
  await new Promise(r => setTimeout(r, 3000))
  for (const svc of SERVICES) {
    const up = await checkPort(svc.port, svc.name)
    console.log(`  ${up ? 'OK ' : '.. '} :${svc.port} ${svc.name}`)
  }

  console.log('')
  console.log('[fleets] Done. Dashboard: http://localhost:3000')
  console.log('[fleets] If services crashed, check logs/<service>.log')
  process.exit(0)
}

main().catch(err => {
  console.error('[fleets] FATAL:', err)
  process.exit(1)
})
