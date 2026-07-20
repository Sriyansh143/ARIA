#!/usr/bin/env node
// =====================================================================
// download-benchmarks.mjs — Phase 33 WS2
// =====================================================================
// Downloads the real HumanEval and MBPP benchmark datasets as JSONL into
// eval/datasets/ so the eval-runner can score against the full suites
// instead of the small representative samples shipped in benchmarks.ts.
//
// Sources (public, canonical):
//   HumanEval : https://raw.githubusercontent.com/openai/human-eval/master/data/HumanEval.jsonl.gz
//   MBPP      : https://raw.githubusercontent.com/google-research/google-research/master/mbpp/mbpp.jsonl
//
// Usage:
//   node scripts/download-benchmarks.mjs            # download all
//   node scripts/download-benchmarks.mjs humaneval  # just one
//
// Exit codes: 0 = all requested datasets present, 1 = a download failed.
// The script is idempotent: it skips files that already exist and validate.
// =====================================================================

import { createWriteStream, existsSync, mkdirSync, statSync, readFileSync } from 'node:fs'
import { createGunzip } from 'node:zlib'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT_DIR = path.resolve(__dirname, '..', 'eval', 'datasets')

const SOURCES = {
  humaneval: {
    url: 'https://raw.githubusercontent.com/openai/human-eval/master/data/HumanEval.jsonl.gz',
    file: 'humaneval.jsonl',
    gzip: true,
    minLines: 100,   // full HumanEval has 164 problems
  },
  mbpp: {
    url: 'https://raw.githubusercontent.com/google-research/google-research/master/mbpp/mbpp.jsonl',
    file: 'mbpp.jsonl',
    gzip: false,
    minLines: 900,   // full MBPP has ~974 problems
  },
}

function countLines(file) {
  try {
    const txt = readFileSync(file, 'utf-8').trim()
    return txt ? txt.split('\n').length : 0
  } catch {
    return 0
  }
}

async function download(id) {
  const src = SOURCES[id]
  if (!src) {
    console.error(`✗ unknown benchmark "${id}" (known: ${Object.keys(SOURCES).join(', ')})`)
    return false
  }

  mkdirSync(OUT_DIR, { recursive: true })
  const dest = path.join(OUT_DIR, src.file)

  // Idempotent: skip if a valid file already exists.
  if (existsSync(dest) && countLines(dest) >= src.minLines) {
    console.log(`• ${id}: already present (${countLines(dest)} lines) — skipping`)
    return true
  }

  console.log(`↓ ${id}: ${src.url}`)
  try {
    const res = await fetch(src.url, { redirect: 'follow' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const nodeStream = Readable.fromWeb(res.body)
    const out = createWriteStream(dest)
    if (src.gzip) {
      await pipeline(nodeStream, createGunzip(), out)
    } else {
      await pipeline(nodeStream, out)
    }
    const lines = countLines(dest)
    const bytes = statSync(dest).size
    if (lines < src.minLines) {
      throw new Error(`only ${lines} lines (expected >= ${src.minLines}); file may be truncated`)
    }
    console.log(`✓ ${id}: ${lines} tasks, ${(bytes / 1024).toFixed(1)} KB → ${path.relative(process.cwd(), dest)}`)
    return true
  } catch (err) {
    console.error(`✗ ${id}: download failed — ${err.message}`)
    console.error(`  You can retry later; the eval-runner falls back to the built-in sample suite until then.`)
    return false
  }
}

;(async () => {
  const requested = process.argv.slice(2).length
    ? process.argv.slice(2)
    : Object.keys(SOURCES)

  console.log(`\nJARVIS benchmark downloader → ${path.relative(process.cwd(), OUT_DIR)}\n`)

  let ok = true
  for (const id of requested) {
    // eslint-disable-next-line no-await-in-loop
    const r = await download(id)
    ok = ok && r
  }

  console.log('')
  if (!ok) {
    console.error('One or more datasets failed to download.')
    process.exit(1)
  }
  console.log('All requested datasets are present.')
  process.exit(0)
})()
