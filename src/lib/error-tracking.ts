/**
 * src/lib/error-tracking.ts — $0 DB error logger + Sentry-ready hook (v42)
 *
 * Captures unhandled promise rejections, uncaught exceptions, and
 * error.tsx boundary errors to the ErrorLog Prisma model.
 *
 * If SENTRY_DSN is set, also forwards to Sentry (optional layer).
 * Otherwise, stays $0 — all errors visible in the dashboard via /api/errors.
 *
 * Global handlers are installed once at boot (in instrumentation-node.ts).
 */

import "server-only"

import { db } from "./db"
import { logger } from "./logger"

export interface ErrorContext {
  url?: string
  userAgent?: string
  userId?: string
  route?: string
  [key: string]: unknown
}

/**
 * Capture an error to the ErrorLog table.
 * Also forwards to Sentry if SENTRY_DSN is set.
 */
export async function captureError(
  error: Error | string,
  context: ErrorContext = {},
  severity: "error" | "warning" | "fatal" = "error",
): Promise<string | null> {
  try {
    const message = typeof error === "string" ? error : error.message
    const stack = typeof error === "string" ? null : error.stack ?? null

    // Insert into DB
    const log = await db.errorLog.create({
      data: {
        message: message.slice(0, 2000),
        stack: stack?.slice(0, 8000) ?? null,
        url: context.url?.slice(0, 500) ?? null,
        userAgent: context.userAgent?.slice(0, 500) ?? null,
        severity,
        context: JSON.stringify(context).slice(0, 4000),
      },
    })

    // Forward to Sentry if configured (optional, non-blocking)
    if (process.env.SENTRY_DSN) {
      try {
        await forwardToSentry(error, context, severity)
      } catch {
        // Sentry failure is non-fatal — the DB log is the source of truth
      }
    }

    logger.debug("error-tracking.captured", {
      errorId: log.id,
      message: message.slice(0, 100),
      severity,
    })

    return log.id
  } catch (err) {
    // If the error tracker fails, log to console (don't infinite-loop)
    console.error("[error-tracking] failed to capture:", err)
    return null
  }
}

/**
 * Forward an error to Sentry via the Sentry SDK (if installed).
 * This is a no-op if SENTRY_DSN is not set.
 */
async function forwardToSentry(
  error: Error | string,
  context: ErrorContext,
  severity: string,
): Promise<void> {
  if (!process.env.SENTRY_DSN) return

  try {
    // v60 fix: variable specifier so Turbopack doesn't try to resolve at build time.
    // Sentry SDK is optional (only installed if operator wants it).
    const moduleName = "@sentry/node";
    // @ts-ignore — Sentry is an optional dep, types may not exist
    const Sentry = await import(/* webpackIgnore: true */ moduleName).catch(() => null)
    if (!Sentry) return

    if (typeof error === "string") {
      Sentry.captureMessage(error, severity as any)
    } else {
      Sentry.captureException(error, { extra: context })
    }
  } catch {
    // silent
  }
}

/**
 * Install global error handlers (call once at boot).
 * Captures unhandledRejection + uncaughtException.
 */
export function installGlobalErrorHandlers(): void {
  // Guard against double-install
  if (globalThis.__ariaErrorHandlersInstalled) return
  globalThis.__ariaErrorHandlersInstalled = true

  process.on("unhandledRejection", (reason) => {
    const err = reason instanceof Error ? reason : new Error(String(reason))
    void captureError(err, { source: "unhandledRejection" }, "error")
  })

  process.on("uncaughtException", (err) => {
    void captureError(err, { source: "uncaughtException" }, "fatal")
    // Note: we don't re-throw or exit — the process continues running.
    // The self-heal supervisor will restart if the process dies.
  })

  logger.info("error-tracking.installed", {
    sentryEnabled: Boolean(process.env.SENTRY_DSN),
  })
}

/**
 * Get recent errors for the dashboard.
 */
export async function getRecentErrors(limit: number = 50) {
  return db.errorLog.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
  })
}

/**
 * Get error stats for the dashboard.
 */
export async function getErrorStats() {
  const [total, unresolved, fatal, last24h] = await Promise.all([
    db.errorLog.count(),
    db.errorLog.count({ where: { resolved: false } }),
    db.errorLog.count({ where: { severity: "fatal" } }),
    db.errorLog.count({
      where: { createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
    }),
  ])

  return { total, unresolved, fatal, last24h }
}

// Global flag for handler installation
declare global {
  var __ariaErrorHandlersInstalled: boolean | undefined
}
