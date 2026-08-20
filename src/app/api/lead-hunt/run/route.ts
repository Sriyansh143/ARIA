/**
 * GET /api/lead-hunt/run — v71 Phase 21 (RULE-69)
 *
 * Manually trigger the daily-lead-hunt pipeline (normally runs via cron
 * at 6 AM daily). Owner-only. Useful for testing + on-demand lead hunts.
 *
 * Returns a summary: { discovered, pursued, investigated, skipped, errors }.
 */
import { NextResponse } from "next/server";
import { requireAuthOrResponse } from "@/lib/auth";
import { runDailyLeadHunt } from "@/lib/lead-hunter";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function POST() {
  const auth = await requireAuthOrResponse("POST", "/api/lead-hunt/run");
  if (auth instanceof NextResponse) return auth;

  try {
    const result = await runDailyLeadHunt();
    logger.info("api.lead-hunt.run.complete", { ...result });
    return NextResponse.json({
      ok: true,
      ...result,
      message: `Hunt complete: ${result.discovered} discovered, ${result.pursued} pursued, ${result.investigated} investigating, ${result.skipped} skipped, ${result.errors} errors`,
    });
  } catch (err) {
    logger.error("api.lead-hunt.run.failed", { error: String(err) });
    return NextResponse.json(
      { ok: false, error: String(err).slice(0, 200) },
      { status: 500 },
    );
  }
}

/**
 * GET /api/lead-hunt/run — return the latest lead hunt metrics + funnel.
 *
 * Returns the discovered → qualified → contacted → replied → closed
 * funnel for the last 7 days.
 */
export async function GET() {
  const auth = await requireAuthOrResponse("GET", "/api/lead-hunt/run");
  if (auth instanceof NextResponse) return auth;

  try {
    const { db } = await import("@/lib/db");
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const leads = await db.lead.findMany({
      where: { discoveredAt: { gte: sevenDaysAgo } },
      select: {
        id: true,
        source: true,
        platform: true,
        username: true,
        displayName: true,
        postContent: true,
        postUrl: true,
        profileUrl: true,
        likes: true,
        replies: true,
        followerCount: true,
        accountAgeDays: true,
        topMatchedService: true,
        qualificationVerdict: true,
        qualificationScore: true,
        qualificationReasoning: true,
        outreachStatus: true,
        outreachChannel: true,
        discoveredAt: true,
        qualifiedAt: true,
        contactedAt: true,
      },
      orderBy: { discoveredAt: "desc" },
      take: 200,
    });

    // Build the funnel.
    const funnel = {
      discovered: leads.length,
      qualified: leads.filter((l) => l.qualificationVerdict === "pursue").length,
      investigated: leads.filter((l) => l.qualificationVerdict === "investigate").length,
      skipped: leads.filter((l) => l.qualificationVerdict === "skip").length,
      contacted: leads.filter((l) => ["sent", "replied", "converted"].includes(l.outreachStatus)).length,
      replied: leads.filter((l) => ["replied", "converted"].includes(l.outreachStatus)).length,
      converted: leads.filter((l) => l.outreachStatus === "converted").length,
    };

    // Platform breakdown.
    const byPlatform: Record<string, number> = {};
    for (const l of leads) byPlatform[l.platform] = (byPlatform[l.platform] ?? 0) + 1;

    // Top matched services.
    const byService: Record<string, number> = {};
    for (const l of leads) {
      if (l.topMatchedService) byService[l.topMatchedService] = (byService[l.topMatchedService] ?? 0) + 1;
    }

    return NextResponse.json({
      ok: true,
      period: "7d",
      funnel,
      byPlatform,
      byService,
      leads,
    });
  } catch (err) {
    logger.error("api.lead-hunt.metrics.failed", { error: String(err) });
    return NextResponse.json(
      { ok: false, error: "Failed to fetch lead hunt metrics" },
      { status: 500 },
    );
  }
}
