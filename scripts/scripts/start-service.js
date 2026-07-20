// =====================================================================
// start-service.js — Universal mini-service launcher with port conflict
// detection. If a port is already in use, it tries the next port.
// =====================================================================
// Usage: node scripts/start-service.js <service-name>
// Example: node scripts/start-service.js system-monitor
//
// This wraps each mini-service's index.ts with:
//   1. Port conflict detection (try port, if EADDRINUSE, try port+1)
//   2. Auto-restart on crash (up to 3 retries with 2s delay)
//   3. Process tracking (writes PID to .service-pids/ for cleanup)
// =====================================================================

const { createServer } = require('http')
const { spawn, execSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const serviceName = process.argv[2]
if (!serviceName) {
  console.error('Usage: node scripts/start-service.js <service-name>')
  process.exit(1)
}

const servicePath = path.join(__dirname, '..', 'mini-services', serviceName, 'index.ts')
if (!fs.existsSync(servicePath)) {
  console.error(`[start-service] Service not found: ${serviceName} (${servicePath})`)
  process.exit(1)
}

// ─── Check if a port is in use ───────────────────────────────────────
function isPortInUse(port) {
  return new Promise((resolve) => {
    const tester = createServer()
    tester.once('error', () => resolve(true))
    tester.once('listening', () => {
      tester.close()
      resolve(false)
    })
    tester.listen(port)
  })
}

// ─── Find a free port starting from the default ──────────────────────
async function findFreePort(defaultPort, maxAttempts = 5) {
  for (let i = 0; i < maxAttempts; i++) {
    const port = defaultPort + i
    const inUse = await isPortInUse(port)
    if (!inUse) return port
    console.warn(`[start-service] Port ${port} in use, trying ${port + 1}...`)
  }
  return defaultPort // give up, let the service fail with the original error
}

// ─── Start the service ───────────────────────────────────────────────
async function start() {
  // Read the default port from the service's index.ts
  const src = fs.readFileSync(servicePath, 'utf8')
  const portMatch = src.match(/(?:PORT|_PORT)\s*=\s*(?:Number\(process\.env\.\w+\)\s*\|\|\s*)?(\d{4})/)
  const defaultPort = portMatch ? parseInt(portMatch[1]) : 3000

  // Find a free port
  const freePort = await findFreePort(defaultPort)
  if (freePort !== defaultPort) {
    console.log(`[start-service] Using port ${freePort} instead of ${defaultPort} (port conflict)`)
  }

  // Set the port as an env var so the service picks it up
  const envVar = src.match(/process\.env\.(\w+_PORT)/)?.[1] || 'PORT'
  process.env[envVar] = String(freePort)

  // Start the service with tsx
  let retries = 0
  const maxRetries = 3

  function launch() {
    console.log(`[start-service] Starting ${serviceName} on port ${freePort}...`)
    const child = spawn('npx', ['tsx', servicePath], {
      stdio: 'inherit',
      env: { ...process.env, [envVar]: String(freePort) },
      cwd: path.dirname(servicePath),
    })

    child.on('exit', (code) => {
      if (code !== 0 && retries < maxRetries) {
        retries++
        console.warn(`[start-service] ${serviceName} crashed (exit ${code}), retry ${retries}/${maxRetries} in 2s...`)
        setTimeout(launch, 2000)
      } else if (code !== 0) {
        console.error(`[start-service] ${serviceName} failed after ${maxRetries} retries`)
        process.exit(code)
      }
    })

    child.on('error', (err) => {
      console.error(`[start-service] ${serviceName} error:`, err.message)
      if (retries < maxRetries) {
        retries++
        setTimeout(launch, 2000)
      }
    })

    // Write PID for cleanup
    const pidDir = path.join(__dirname, '..', '.service-pids')
    try { fs.mkdirSync(pidDir, { recursive: true }) } catch {}
    fs.writeFileSync(path.join(pidDir, `${serviceName}.pid`), String(child.pid))
  }

  launch()
}

start().catch(console.error)
