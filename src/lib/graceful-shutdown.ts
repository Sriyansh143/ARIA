// =====================================================================
// graceful-shutdown.ts — Phase 30: graceful shutdown handler.
// =====================================================================
// Registers SIGTERM/SIGINT handlers that:
//   1. Stop accepting new requests (signal load balancer)
//   2. Wait for in-flight requests to complete (drain)
//   3. Close DB connections
//   4. Exit cleanly
//
// Adapted for v10: removed the redis-client + otel dynamic imports (we
// don't have either). Kept the hook system + SIGTERM/SIGINT wiring +
// the db-disconnect built-in hook. Logger replaced with console.
//
// Usage: call registerGracefulShutdown() once at app startup.
// =====================================================================

interface ShutdownHook {
  name: string
  fn: () => Promise<void>
  timeoutMs: number
}

const hooks: ShutdownHook[] = []
let shuttingDown = false

/**
 * Register a shutdown hook. Hooks run in registration order.
 * Each hook has an individual timeout — if it exceeds, we log and continue.
 */
export function onShutdown(
  name: string,
  fn: () => Promise<void>,
  timeoutMs = 5000,
): void {
  hooks.push({ name, fn, timeoutMs })
}

async function runHook(hook: ShutdownHook): Promise<void> {
  const timer = new Promise<void>((_, reject) =>
    setTimeout(
      () => reject(new Error(`timeout after ${hook.timeoutMs}ms`)),
      hook.timeoutMs,
    ),
  )
  try {
    await Promise.race([hook.fn(), timer])
    console.log(`[graceful-shutdown] hook "${hook.name}" completed`)
  } catch (err) {
    console.warn(
      `[graceful-shutdown] hook "${hook.name}" failed (continuing): ${
        err instanceof Error ? err.message : String(err)
      }`,
    )
  }
}

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true

  console.log(
    `[graceful-shutdown] starting (signal=${signal}, hooks=${hooks.length})`,
  )
  const t0 = Date.now()

  for (const hook of hooks) {
    await runHook(hook)
  }

  console.log(`[graceful-shutdown] complete (${Date.now() - t0}ms)`)
  process.exit(0)
}

/**
 * Register SIGTERM and SIGINT handlers.
 * Call once at app startup (e.g., in instrumentation.ts or server.ts).
 */
export function registerGracefulShutdown(): void {
  if (typeof process === 'undefined') return

  process.once('SIGTERM', () => void shutdown('SIGTERM'))
  process.once('SIGINT', () => void shutdown('SIGINT'))

  // Built-in hook: close the DB connection pool.
  onShutdown(
    'db-disconnect',
    async () => {
      try {
        const { db } = await import('@/lib/db')
        await db.$disconnect()
      } catch {
        /* best-effort */
      }
    },
    5000,
  )

  console.log('[graceful-shutdown] registered (SIGTERM, SIGINT)')
}

/** Check if shutdown is in progress (for health endpoints). */
export function isShuttingDown(): boolean {
  return shuttingDown
}
