#!/usr/bin/env node
// =====================================================================
// eval-runner.mjs — Phase 32 / Gap 3: CI-friendly eval harness CLI.
// =====================================================================
// Runs one or more benchmark suites against a running JARVIS instance via
// the /api/eval/run endpoint, prints a table, and exits non-zero if any
// suite regressed (for CI gating).
//
// Usage:
//   node scripts/eval-runner.mjs \
//     --base http://localhost:3000 \
//     --token "$JARVIS_API_KEY" \
//     --suites humaneval,mbpp,mt-bench \
//     --model gpt-4o-mini --provider openai --version v16
//
// Exit codes: 0 = all good, 1 = a suite regressed, 2 = a request failed.
// =====================================================================

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, arr) => {
    if (cur.startsWith('--')) acc.push([cur.slice(2), arr[i + 1]])
    return acc
  }, []),
)

const BASE = args.base || process.env.JARVIS_BASE || 'http://localhost:3000'
const TOKEN = args.token || process.env.JARVIS_API_KEY || ''
const SUITES = (args.suites || 'humaneval,mbpp').split(',').map((s) => s.trim())
const MODEL = args.model || 'gpt-4o-mini'
const PROVIDER = args.provider || 'openai'
const VERSION = args.version || 'dev'

async function runSuite(suite) {
  const res = await fetch(`${BASE}/api/eval/run`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
    },
    body: JSON.stringify({ suite, version: VERSION, model: MODEL, provider: PROVIDER }),
  })
  if (!res.ok) {
    console.error(`✗ ${suite}: HTTP ${res.status} ${await res.text()}`)
    return { suite, error: true }
  }
  return res.json()
}

;(async () => {
  console.log(`\nJARVIS eval-runner → ${BASE}`)
  console.log(`  model=${MODEL} provider=${PROVIDER} version=${VERSION}`)
  console.log(`  suites=${SUITES.join(', ')}\n`)

  let regressed = false
  let failed = false

  for (const suite of SUITES) {
    const out = await runSuite(suite)
    if (out.error) { failed = true; continue }
    const { run, regression } = out
    const delta = regression.scoreDelta >= 0 ? `+${regression.scoreDelta}` : `${regression.scoreDelta}`
    const flag = regression.regressed ? '⚠ REGRESSED' : '✓'
    console.log(
      `${flag} ${suite.padEnd(16)} score=${run.avgScore}/10  pass=${run.passed}/${run.total} (${run.passRate}%)  Δ=${delta}`,
    )
    if (regression.regressed) regressed = true
  }

  console.log('')
  if (failed) process.exit(2)
  if (regressed) { console.error('One or more suites regressed.'); process.exit(1) }
  console.log('All suites passed regression gate.')
  process.exit(0)
})()
