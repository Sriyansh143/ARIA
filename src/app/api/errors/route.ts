import { NextRequest, NextResponse } from "next/server"
import { logger } from "@/lib/logger"
import { captureError, getRecentErrors, getErrorStats } from "@/lib/error-tracking"
import { requirePermissionResponse } from "@/lib/auth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * POST /api/errors — capture a client-side error to ErrorLog.
 *
 * Called by error.tsx (the Next.js error boundary). Public (no auth)
 * because errors happen before login. Rate-limited by proxy.ts.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const message = String(body.message || "unknown error")
    const stack = body.stack ? String(body.stack) : undefined
    const digest = body.digest ? String(body.digest) : undefined
    const url = body.url ? String(body.url) : undefined
    const userAgent = body.userAgent ? String(body.userAgent) : undefined
    const severity = (body.severity === "fatal" || body.severity === "warning") ? body.severity : "error"

    const errorId = await captureError(
      new Error(message),
      { url, userAgent, digest, source: body.source || "client" },
      severity,
    )

    if (body.silent !== true) {
      logger.warn("api.errors.captured", { errorId, message: message.slice(0, 100), severity })
    }

    return NextResponse.json({ ok: true, errorId })
  } catch (err) {
    logger.error("api.errors.capture-failed", { error: String(err) })
    return NextResponse.json({ error: "failed to capture" }, { status: 500 })
  }
}

/**
 * GET /api/errors — list recent errors (owner-only).
 * Query: ?stats=true for just the summary stats.
 */
export async function GET(req: NextRequest) {
  const [user, errorResponse] = await requirePermissionResponse("GET", "/api/errors")
  if (errorResponse) return errorResponse

  try {
    const url = new URL(req.url)
    const statsOnly = url.searchParams.get("stats") === "true"
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "50"), 200)

    if (statsOnly) {
      const stats = await getErrorStats()
      return NextResponse.json(stats)
    }

    const errors = await getRecentErrors(limit)
    const stats = await getErrorStats()
    return NextResponse.json({ errors, stats })
  } catch (err) {
    logger.error("api.errors.list.failed", { error: String(err) })
    return NextResponse.json({ error: "failed to list errors" }, { status: 500 })
  }
}
