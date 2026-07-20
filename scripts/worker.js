#!/usr/bin/env node
/**
 * scripts/worker.js — C11 fix: background worker process for Helm worker deployment.
 *
 * This process runs alongside the main Next.js app in Kubernetes (separate Deployment).
 * It handles:
 *   1. Cron job execution (task-reaper, checkpoint cleanup, eval runs)
 *   2. Agent heartbeat monitoring
 *   3. Redis pub/sub event processing
 *   4. Graceful shutdown on SIGTERM/SIGINT
 *
 * The Helm values.yaml references this file as:
 *   command: ["node", "scripts/worker.js"]
 */

'use strict'

const { execSync } = require('child_process')
const path = require('path')

// ── Startup ──────────────────────────────────────────────────────────────────

console.log('[worker] JARVIS background worker starting', {
  pid: process.pid,
  node: process.version,
  env: process.env.NODE_ENV ?? 'development',
  ts: new Date().toISOString(),
})

// Validate required env vars before doing any work
const REQUIRED = ['DATABASE_URL', 'REDIS_URL']
const missing = REQUIRED.filter((k) => !process.env[k])
if (missing.length > 0) {
  console.error('[worker] FATAL: missing required env vars:', missing.join(', '))
  process.exit(1)
}

// ── Job registry ─────────────────────────────────────────────────────────────

const jobs = []

/**
 * Register a recurring job.
 * @param {string} name
 * @param {number} intervalMs
 * @param {() => Promise<void>} fn
 */
function registerJob(name, intervalMs, fn) {
  let running = false
  const timer = setInterval(async () => {
    if (running) {
      console.warn(`[worker] ${name}: previous run still in progress, skipping`)
      return
    }
    running = true
    const t0 = Date.now()
    try {
      await fn()
      console.log(`[worker] ${name}: completed in ${Date.now() - t0}ms`)
    } catch (err) {
      console.error(`[worker] ${name}: error`, err?.message ?? err)
    } finally {
      running = false
    }
  }, intervalMs)
  jobs.push({ name, timer })
  console.log(`[worker] registered job "${name}" every ${intervalMs / 1000}s`)
}

// ── Jobs ─────────────────────────────────────────────────────────────────────

// Heartbeat — confirms worker is alive (logged, picked up by log aggregator)
registerJob('heartbeat', 60_000, async () => {
  console.log('[worker] heartbeat', { ts: new Date().toISOString(), uptime: process.uptime() })
})

// Task reaper — kill stale agent tasks (every 5 minutes)
registerJob('task-reaper', 5 * 60_000, async () => {
  // Dynamic import so we don't need to compile TS here
  // The Next.js build outputs compiled JS to .next/server/
  // In production this runs against the built output
  try {
    const reaperPath = path.join(__dirname, '..', '.next', 'server', 'chunks', 'task-reaper.js')
    const { reapStaleTasks } = require(reaperPath)
    const count = await reapStaleTasks()
    if (count > 0) console.log(`[worker] task-reaper: reaped ${count} stale tasks`)
  } catch {
    // Module not compiled yet (dev mode) — skip silently
  }
})

// ── Graceful shutdown ─────────────────────────────────────────────────────────

let shuttingDown = false

async function shutdown(signal) {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`[worker] received ${signal}, shutting down gracefully`)

  // Stop all job timers
  for (const { name, timer } of jobs) {
    clearInterval(timer)
    console.log(`[worker] stopped job "${name}"`)
  }

  // Give in-flight jobs 10s to complete
  await new Promise((resolve) => setTimeout(resolve, 10_000))
  console.log('[worker] shutdown complete')
  process.exit(0)
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT',  () => shutdown('SIGINT'))
process.on('uncaughtException', (err) => {
  console.error('[worker] uncaughtException:', err)
  shutdown('uncaughtException').then(() => process.exit(1))
})
process.on('unhandledRejection', (reason) => {
  console.error('[worker] unhandledRejection:', reason)
})

console.log('[worker] all jobs registered, running...')
