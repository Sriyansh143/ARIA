import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { getTraceStats, getRecentSpans } from "@/lib/tracing";

export const dynamic = "force-dynamic";

/**
 * GET /api/tracing — live trace spans + aggregate stats.
 *
 * Returns the in-memory ring buffer's stats (totalSpans, avgDurationMs,
 * slowestSpan) plus the last 50 spans (name, durationMs, attributes) so
 * the dashboard can render a "recent traces" panel. Spans are kept on
 * `globalThis` so they survive Next.js Fast-Refresh HMR.
 *
 * Auth: protected by the same middleware that guards every other
 * /api/* route (NextAuth session). No extra role check needed here —
 * any authenticated user can observe trace data (it carries no PII).
 */
export async function GET() {
  try {
    const stats = getTraceStats();
    const recent = getRecentSpans(50).map((s) => ({
      name: s.name,
      durationMs: s.durationMs,
      attributes: s.attributes,
      status: s.status,
      startedAt: s.startedAt,
      endedAt: s.endedAt,
    }));

    return NextResponse.json({
      stats,
      recent,
      count: recent.length,
      checkedAt: new Date().toISOString(),
    });
  } catch (err) {
    logger.error("api.tracing.get.error", { error: String(err) });
    return NextResponse.json(
      { error: "failed to read trace stats", detail: String(err) },
      { status: 500 }
    );
  }
}
