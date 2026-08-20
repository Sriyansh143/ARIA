import { NextRequest, NextResponse } from "next/server";
import { getRecent, getStats } from "@/lib/blackbox";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * GET /api/blackbox — recent flight recorder entries + stats.
 *
 * Query params:
 *   ?type=decision|token-spend|outbound|error|autonomous-action|approval|system|security
 *   ?severity=info|warn|error|critical
 *   ?limit=50 (max 200)
 *   ?since=<epoch-ms>
 */
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const type = url.searchParams.get("type") as
      | "decision"
      | "token-spend"
      | "outbound"
      | "error"
      | "autonomous-action"
      | "approval"
      | "system"
      | "security"
      | undefined;
    const severity = url.searchParams.get("severity") ?? undefined;
    const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50", 10) || 50, 200);
    const since = url.searchParams.get("since")
      ? parseInt(url.searchParams.get("since")!, 10)
      : undefined;

    const entries = getRecent({ type, severity, limit, since });
    const stats = getStats();

    return NextResponse.json({ entries, stats });
  } catch (err) {
    logger.error("api.blackbox.failed", { error: String(err) });
    return NextResponse.json({ error: "failed to get blackbox entries" }, { status: 500 });
  }
}
