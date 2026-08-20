/**
 * GET /api/simulations/report — v63 Phase 13
 * Returns the latest simulation report from the KnowledgeBaseEntry table.
 */
export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

export async function GET() {
  try {
    const report = await db.knowledgeBaseEntry.findFirst({
      where: { tags: { contains: "simulation-report" } },
      orderBy: { createdAt: "desc" },
    });
    if (!report) {
      return NextResponse.json({ ok: false, error: "no simulation reports yet — run a simulation first" });
    }
    return NextResponse.json({
      ok: true,
      report: {
        id: report.id,
        title: report.title,
        createdAt: report.createdAt,
        content: JSON.parse(report.content),
      },
    });
  } catch (err) {
    logger.error("api.simulations.report.failed", { error: String(err) });
    return NextResponse.json({ error: "failed to get report" }, { status: 500 });
  }
}
