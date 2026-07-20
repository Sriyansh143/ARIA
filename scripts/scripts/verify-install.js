#!/usr/bin/env node
// =====================================================================
// verify-install.js — Alias / wrapper for verify-70-features.js
// =====================================================================
// Many older READMEs / docs / chat transcripts instruct the operator to
// run `node scripts/verify-install.js`. That script never existed — the
// real verifier is `scripts/verify-70-features.js`. This thin wrapper
// makes the old command work so users following outdated instructions
// don't see `MODULE_NOT_FOUND`.
//
// Usage:
//   node scripts/verify-install.js        # → runs verify-70-features.js
//   npm run verify                         # → same (added to package.json)
// =====================================================================

const { spawn } = require('child_process')
const path = require('path')

const realScript = path.join(__dirname, 'verify-70-features.js')

const child = spawn(process.execPath, [realScript, ...process.argv.slice(2)], {
  stdio: 'inherit',
  windowsHide: false,
})

child.on('error', (err) => {
  console.error('[verify-install] Failed to spawn verify-70-features.js:', err.message)
  console.error('                         Real script path was:', realScript)
  process.exit(1)
})

child.on('exit', (code) => {
  process.exit(code ?? 1)
})
