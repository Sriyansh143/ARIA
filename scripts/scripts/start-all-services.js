// =====================================================================
// start-all-services.js — Starts all 18 mini-services in background.
// =====================================================================
// Phase 46: Same fixes as start-fleets.js:
//   - Runs npm install in each mini-service (fixes socket.io)
//   - EBUSY-proof log streams with error handler
//   - Local tsx resolution
// =====================================================================

const { spawn, spawnSync } = require('child_process')
const path = require('path')
const fs = require('fs')

const SERVICES = [
  { name: 'agent-status', port: 3003 },
  { name: 'browser-login', port: 3004 },
  { name: 'heartbeat', port: 3005 },
  { name: 'process-manager', port: 3006 },
  { name: 'screen-viewer', port: 3007 },
  { name: 'telegram-bot', port: 3008 },
  { name: 'system-monitor', port: 3009 },
  { name: 'vector-memory', port: 3010 },
  { name: 'credential-vault', port: 3011 },
  { name: 'agent-comms', port: 3012 },
  { name: 'orchestrator', port: 3013 },
  { name: 'okara-crawler', port: 3014 },
  { name: 'mcts-engine', port: 3015 },
  { name: 'mcp-gateway', port: 3016 },
  { name: 'tmux-bridge', port: 3017 },
  { name: 'planner', port: 3018 },
  { name: 'department-supervisor', port: 3019 },
  { name: 'autonomous-loop', port: 3020 },
]

const cwd = process.cwd()
const nodeModulesPath = path.join(cwd, 'node_modules')
const isWindows = process.platform === 'win32'

// ─── Resolve tsx ─────────────────────────────────────────────────────
function resolveTsx() {
  const tsxCliPath = path.join(nodeModulesPath, 'tsx', 'dist', 'cli.mjs')
  if (fs.existsSync(tsxCliPath)) {
    return { cmd: 'node', args: [tsxCliPath] }
  }
  const binName = isWindows ? 'tsx.cmd' : 'tsx'
  const binPath = path.join(nodeModulesPath, '.bin', binName)
  if (fs.existsSync(binPath)) {
    return { cmd: binPath, args: [] }
  }
  console.log('  tsx not found - installing...')
  spawnSync('npm', ['install', 'tsx@latest', '--no-save', '--silent'], {
    cwd, stdio: 'inherit', shell: isWindows,
  })
  if (fs.existsSync(tsxCliPath)) {
    return { cmd: 'node', args: [tsxCliPath] }
  }
  console.log('  Using npx -y tsx as fallback')
  const npxCmd = isWindows ? 'npx.cmd' : 'npx'
  return { cmd: npxCmd, args: ['-y', 'tsx'] }
}

const tsx = resolveTsx()

// ─── Install deps for mini-service ───────────────────────────────────
function ensureServiceDeps(svcName) {
  const svcDir = path.join(cwd, 'mini-services', svcName)
  const pkgJsonPath = path.join(svcDir, 'package.json')
  const svcNodeModules = path.join(svcDir, 'node_modules')
  if (!fs.existsSync(pkgJsonPath)) return true
  const lockfile = path.join(svcNodeModules, '.package-lock.json')
  if (fs.existsSync(lockfile)) return true
  console.log(`  installing deps for ${svcName}...`)
  try {
    const result = spawnSync('npm', ['install', '--no-audit', '--no-fund', '--silent'], {
      cwd: svcDir, stdio: 'pipe', shell: isWindows, timeout: 60000,
    })
    if (result.status !== 0) {
      // Fallback: junction
      try {
        fs.symlinkSync(nodeModulesPath, svcNodeModules, isWindows ? 'junction' : 'dir')
        return true
      } catch { return false }
    }
    return true
  } catch { return false }
}

// ─── EBUSY-proof log stream ──────────────────────────────────────────
function createSafeLogStream(logFile) {
  try {
    const stream = fs.createWriteStream(logFile, { flags: 'a' })
    stream.on('error', () => {}) // prevent EBUSY crash
    return stream
  } catch {
    return { write: () => {}, pipe: () => {}, end: () => {}, on: () => {} }
  }
}

console.log('═══════════════════════════════════════════════════')
console.log('  Starting all 18 JARVIS mini-services...')
console.log(`  tsx: ${tsx.cmd} ${tsx.args.join(' ')}`)
console.log('═══════════════════════════════════════════════════\n')

// Pre-install all deps
console.log('  Pre-installing mini-service dependencies...')
for (const svc of SERVICES) {
  ensureServiceDeps(svc.name)
}
console.log('  Dependencies ready.\n')

const logsDir = path.join(cwd, 'logs')
try { fs.mkdirSync(logsDir, { recursive: true }) } catch {}

let started = 0
let failed = 0

for (const svc of SERVICES) {
  const servicePath = path.join(cwd, 'mini-services', svc.name, 'index.ts')
  if (!fs.existsSync(servicePath)) {
    console.log(`  SKIP  ${svc.name} (${svc.port}) — index.ts not found`)
    continue
  }

  const env = { ...process.env, NODE_PATH: nodeModulesPath }
  const logFile = path.join(logsDir, `${svc.name}.log`)
  const logStream = createSafeLogStream(logFile)

  const child = spawn(tsx.cmd, [...tsx.args, servicePath], {
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env,
    cwd,
    shell: false,
  })

  child.stdout?.pipe(logStream)
  child.stderr?.pipe(logStream)

  child.on('error', (err) => {
    console.log(`  FAIL  ${svc.name} (${svc.port}) — ${err.message}`)
    failed++
  })

  child.unref()

  const pidDir = path.join(cwd, '.service-pids')
  try { fs.mkdirSync(pidDir, { recursive: true }) } catch {}
  fs.writeFileSync(path.join(pidDir, `${svc.name}.pid`), String(child.pid))

  console.log(`  OK    ${svc.name} (${svc.port}) — PID ${child.pid} → logs/${svc.name}.log`)
  started++
}

console.log(`\n═══════════════════════════════════════════════════`)
console.log(`  ${started} services started, ${failed} failed`)
console.log(`  Starting dashboard on http://localhost:3000...`)
console.log(`═══════════════════════════════════════════════════\n`)

setTimeout(() => process.exit(0), 3000)
