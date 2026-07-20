// scripts/check-node-version.js — Preflight Node.js version check.
//
// FEAT-3: JARVIS Mission Control requires Node.js >= 20.0.0 (see the
// `engines` field in package.json). Older Node versions crash with cryptic
// errors (e.g. missing structuredClone, missing fetch, ESM/CJS quirks) that
// are hard to debug. This script gives a clear, actionable error message
// instead.
//
// Wired into the `predev`, `prebuild`, and `prestart` npm hooks, AND called
// at the very top of scripts/ensure-env.js so it runs before anything else
// (including prisma generate, which itself can fail on old Node).
//
// Exits with code 1 if the running Node is too old.

const REQUIRED_MAJOR = 20
const REQUIRED_LABEL = `>=${REQUIRED_MAJOR}.0.0`

function parseNodeVersion(v) {
  // process.version looks like 'v18.19.0' or 'v20.5.1' (or 'v22.0.0-nightly...').
  const match = /^v?(\d+)\./.exec(v)
  if (!match) return null
  return parseInt(match[1], 10)
}

const currentMajor = parseNodeVersion(process.version)
const currentVersion = process.version

if (currentMajor === null) {
  // Couldn't parse — let it through (don't block on a parse failure) but warn.
  console.warn('[check-node-version] Could not parse process.version=' +
    `"${currentVersion}". Skipping version check.`)
  process.exit(0)
}

if (currentMajor < REQUIRED_MAJOR) {
  console.error('')
  console.error('╔══════════════════════════════════════════════════════════════════╗')
  console.error('║  JARVIS Mission Control — Node.js version too old              ║')
  console.error('╚══════════════════════════════════════════════════════════════════╝')
  console.error('')
  console.error(`  Your Node.js version:  ${currentVersion}`)
  console.error(`  Required version:      ${REQUIRED_LABEL}`)
  console.error('')
  console.error('  JARVIS uses features (structuredClone, global fetch, stable')
  console.error('  ESM, native WebStreams, ...) that only land in Node 20+.')
  console.error('  Continuing on an older version will fail with cryptic errors.')
  console.error('')
  console.error('  How to fix:')
  console.error('')
  console.error('    1) Download Node.js ' + REQUIRED_MAJOR + '+ from https://nodejs.org/')
  console.error('')
  console.error('    2) Or use nvm (Node Version Manager) to switch versions:')
  console.error('         nvm install ' + REQUIRED_MAJOR)
  console.error('         nvm use ' + REQUIRED_MAJOR)
  console.error('         node --version    # should print v' + REQUIRED_MAJOR + '.*')
  console.error('')
  console.error('    3) Then re-run the command you just tried.')
  console.error('')
  process.exit(1)
}

// Pass — print a tiny confirmation on stderr so it doesn't clutter piping.
if (process.env.JARVIS_QUIET_NODE_CHECK !== '1') {
  console.error(`[check-node-version] OK — Node ${currentVersion} satisfies ${REQUIRED_LABEL}`)
}
process.exit(0)
