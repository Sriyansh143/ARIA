// =====================================================================
// fix-native-binaries.js — Repair corrupted Windows native binaries
// =====================================================================
// Symptoms this fixes:
//   1. "@next/swc-win32-x64-msvc.node is not a valid Win32 application"
//      → Turbopack can't start
//   2. "Cannot find module '../lightningcss.win32-x64-msvc.node'"
//      → Tailwind CSS v4 can't compile CSS (cascades into "Module not
//        found: Can't resolve 'framer-motion'" errors that look like
//        missing deps but are actually caused by lightningcss crashing)
//
// Root cause: npm sometimes installs the wrong arch's native binary, or
// the binary gets corrupted/truncated. This script:
//   1. Detects the current platform + arch
//   2. Force-reinstalls the correct @next/swc-* package
//   3. Force-reinstalls the correct lightningcss-* package
//   4. Verifies both binaries load correctly
//
// This runs automatically:
//   - After `npm install` (via postinstall → ensure-env.js)
//   - Before `npm run dev` (via predev → ensure-env.js)
//   - Before `start-jarvis-all.bat`
// =====================================================================

const { spawnSync } = require('child_process')
const { existsSync, rmSync, mkdirSync } = require('fs')
const { join } = require('path')

const cwd = process.cwd()
const isWindows = process.platform === 'win32'
const isLinux = process.platform === 'linux'
const isMac = process.platform === 'darwin'

// Determine the correct SWC + lightningcss package names
let swcPkg = null
let lightningcssPkg = null

if (isWindows) {
  if (process.arch === 'arm64') {
    swcPkg = '@next/swc-win32-arm64-msvc'
    lightningcssPkg = 'lightningcss-win32-arm64-msvc'
  } else {
    swcPkg = '@next/swc-win32-x64-msvc'
    lightningcssPkg = 'lightningcss-win32-x64-msvc'
  }
} else if (isLinux) {
  if (process.arch === 'arm64') {
    swcPkg = '@next/swc-linux-arm64-gnu'
    lightningcssPkg = 'lightningcss-linux-arm64-gnu'
  } else {
    swcPkg = '@next/swc-linux-x64-gnu'
    lightningcssPkg = 'lightningcss-linux-x64-gnu'
  }
} else if (isMac) {
  if (process.arch === 'arm64') {
    swcPkg = '@next/swc-darwin-arm64'
    lightningcssPkg = 'lightningcss-darwin-arm64'
  } else {
    swcPkg = '@next/swc-darwin-x64'
    lightningcssPkg = 'lightningcss-darwin-x64'
  }
}

if (!swcPkg) {
  console.log(`[fix-native] Unsupported platform: ${process.platform}/${process.arch}`)
  console.log('[fix-native] Skipping native binary repair.')
  process.exit(0)
}

console.log(`[fix-native] Platform: ${process.platform}/${process.arch}`)
console.log(`[fix-native] Required SWC package: ${swcPkg}`)
console.log(`[fix-native] Required lightningcss package: ${lightningcssPkg}`)

const nodeModulesPath = join(cwd, 'node_modules')
if (!existsSync(nodeModulesPath)) {
  console.log('[fix-native] node_modules not found - run npm install first')
  console.log('[fix-native] Skipping native binary repair.')
  process.exit(0)
}

// ─── Step 1: Test if SWC binary loads ────────────────────────────────
function swcWorks() {
  if (!existsSync(join(nodeModulesPath, swcPkg))) return false
  const testCode = `
    try {
      require('${swcPkg}');
      process.exit(0);
    } catch (err) {
      process.exit(1);
    }
  `
  const result = spawnSync('node', ['-e', testCode], { cwd, stdio: 'ignore' })
  return result.status === 0
}

// ─── Step 2: Test if lightningcss binary loads ───────────────────────
function lightningcssWorks() {
  if (!existsSync(join(nodeModulesPath, 'lightningcss'))) return false
  const testCode = `
    try {
      const lc = require('lightningcss');
      // Call a function to ensure the native binary actually loads
      lc.bundle({ filename: '-' });
      process.exit(0);
    } catch (err) {
      // bundle will fail on empty input, but if the binary is missing
      // we get "Cannot find module" instead. Check the error type.
      if (err && err.message && err.message.includes('Cannot find module')) {
        process.exit(1);
      }
      // Other errors mean the binary loaded fine (just bad input)
      process.exit(0);
    }
  `
  const result = spawnSync('node', ['-e', testCode], { cwd, stdio: 'ignore' })
  return result.status === 0
}

// ─── Step 3: Force reinstall a package ───────────────────────────────
function forceReinstall(pkgName) {
  console.log(`[fix-native] Force-installing ${pkgName}...`)
  // Remove existing corrupted package
  const pkgPath = join(nodeModulesPath, pkgName)
  if (existsSync(pkgPath)) {
    try { rmSync(pkgPath, { recursive: true, force: true }) } catch {}
  }
  // Force reinstall
  const result = spawnSync('npm', ['install', pkgName, '--force', '--no-save', '--silent'], {
    cwd,
    stdio: 'pipe',
    shell: isWindows,
    timeout: 120000, // 2 minutes max
  })
  return result.status === 0
}

// ─── Main: repair SWC + lightningcss ─────────────────────────────────
let allOk = true

console.log('')
console.log('[fix-native] Step 1: Checking SWC binary...')
if (swcWorks()) {
  console.log('[fix-native]   SWC binary loads OK')
} else {
  console.log('[fix-native]   SWC binary missing or broken - repairing...')
  if (forceReinstall(swcPkg)) {
    if (swcWorks()) {
      console.log('[fix-native]   SWC binary repaired')
    } else {
      console.log('[fix-native]   WARNING: SWC binary still broken after reinstall')
      console.log('[fix-native]   Turbopack will not work. Use: npm run dev:webpack')
      allOk = false
    }
  } else {
    console.log('[fix-native]   WARNING: SWC reinstall failed')
    console.log('[fix-native]   Use: npm run dev:webpack (bypasses SWC)')
    allOk = false
  }
}

console.log('')
console.log('[fix-native] Step 2: Checking lightningcss binary...')
if (lightningcssWorks()) {
  console.log('[fix-native]   lightningcss binary loads OK')
} else {
  console.log('[fix-native]   lightningcss binary missing or broken - repairing...')
  if (forceReinstall(lightningcssPkg)) {
    if (lightningcssWorks()) {
      console.log('[fix-native]   lightningcss binary repaired')
    } else {
      console.log('[fix-native]   WARNING: lightningcss binary still broken after reinstall')
      console.log('[fix-native]   Tailwind CSS v4 may fail. Try: npm install lightningcss --force')
      allOk = false
    }
  } else {
    console.log('[fix-native]   WARNING: lightningcss reinstall failed')
    console.log('[fix-native]   CSS compilation may fail. Try: npm install lightningcss --force')
    allOk = false
  }
}

console.log('')
if (allOk) {
  console.log('[fix-native] ✅ All native binaries working')
  console.log('[fix-native] Turbopack + Tailwind CSS v4 should work')
  console.log('[fix-native] Use: npm run dev (Turbopack, fast)')
} else {
  console.log('[fix-native] ⚠️  Some native binaries could not be repaired')
  console.log('[fix-native] Falling back to Webpack mode: npm run dev:webpack')
  console.log('[fix-native] (Webpack is slower but does not need SWC)')
  // Note: Webpack still needs lightningcss for Tailwind v4
  console.log('[fix-native] If CSS fails too, manually run: npm install lightningcss --force')
}
process.exit(0)
