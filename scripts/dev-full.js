#!/usr/bin/env node
// =====================================================================
// dev-full.js -- 1-click: start fleets + dashboard together.
// =====================================================================
// Runs `npm run fleets` and `npm run dev` in parallel.
// Ctrl+C kills both.
//
// Usage: node scripts/dev-full.js
// Or:    npm run dev:full
// =====================================================================

const { spawn } = require('child_process')
const { resolve } = require('path')
const { existsSync, rmSync } = require('fs')

const ROOT = resolve(__dirname, '..')
const isWindows = process.platform === 'win32'

console.log('')
console.log('================================================================')
console.log('  JARVIS 1-Click Dev Mode -- Fleets + Dashboard')
console.log('================================================================')
console.log('')

// Clear .next cache to fix hydration mismatch (stale build cache)
const nextDir = resolve(ROOT, '.next')
if (existsSync(nextDir)) {
  console.log('[setup] Clearing .next build cache (fixes hydration mismatch)...')
  try { rmSync(nextDir, { recursive: true, force: true }) } catch {}
}

// Start fleets
console.log('[1/2] Starting agent fleets...')
const fleets = spawn(isWindows ? 'npm.cmd' : 'npm', ['run', 'fleets'], {
  cwd: ROOT,
  stdio: 'inherit',
  shell: isWindows,
})

// Wait 2s then start dashboard
setTimeout(() => {
  console.log('')
  console.log('[2/2] Starting Next.js dashboard...')
  const dev = spawn(isWindows ? 'npm.cmd' : 'npm', ['run', 'dev'], {
    cwd: ROOT,
    stdio: 'inherit',
    shell: isWindows,
  })

  dev.on('exit', (code) => {
    console.log(`[dev-full] Dashboard exited with code ${code}`)
    if (fleets.pid) fleets.kill('SIGTERM')
    process.exit(code || 0)
  })
}, 2000)

fleets.on('exit', (code) => {
  console.log(`[dev-full] Fleets exited with code ${code}`)
})

// Ctrl+C handler -- kill both
process.on('SIGINT', () => {
  console.log('\n[dev-full] Shutting down all services...')
  if (fleets.pid) fleets.kill('SIGTERM')
  process.exit(0)
})

process.on('SIGTERM', () => {
  if (fleets.pid) fleets.kill('SIGTERM')
  process.exit(0)
})
