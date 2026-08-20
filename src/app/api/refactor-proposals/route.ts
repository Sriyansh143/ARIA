/**
 * /api/refactor-proposals — v73 Phase 23 (RULE-72)
 *
 * GET  — list all refactor proposals (filter by status).
 * POST — manually trigger a refactor for a specific file (owner-only).
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuthOrResponse } from "@/lib/auth";
import { db } from "@/lib/db";
import { detectFailingModules, draftAndProposeRefactor } from "@/lib/self-evolution/refactor-engine";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requireAuthOrResponse("GET", "/api/refactor-proposals");
  if (auth instanceof NextResponse) return auth;

  try {
    const status = req.nextUrl.searchParams.get("status") ?? undefined;
    const proposals = await db.refactorProposal.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        targetFile: true,
        failureRate: true,
        failureCount: true,
        reason: true,
        testResults: true,
        buildSucceeded: true,
        status: true,
        approvedAt: true,
        approvedBy: true,
        mergedAt: true,
        createdAt: true,
      },
    });
    return NextResponse.json({ ok: true, count: proposals.length, proposals });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err).slice(0, 100) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAuthOrResponse("POST", "/api/refactor-proposals");
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await req.json().catch(() => ({}));
    const { action } = body;

    if (action === "scan") {
      // Manually trigger the failure-detection scan.
      const detections = await detectFailingModules();
      return NextResponse.json({ ok: true, detections, count: detections.length });
    } else if (action === "draft" && body.targetFile) {
      // Draft a refactor for a specific file (manual trigger).
      const detections = await detectFailingModules();
      const match = detections.find((d) => d.targetFile === body.targetFile);
      if (!match) {
        return NextResponse.json({ ok: false, error: `No failing module detected for ${body.targetFile}.` }, { status: 404 });
      }
      const proposalId = await draftAndProposeRefactor(match);
      return NextResponse.json({ ok: !!proposalId, proposalId });
    }

    return NextResponse.json({ ok: false, error: "Unknown action. Use { action: 'scan' } or { action: 'draft', targetFile: '...' }" }, { status: 400 });
  } catch (err) {
    logger.error("api.refactor-proposals.failed", { error: String(err) });
    return NextResponse.json({ ok: false, error: String(err).slice(0, 100) }, { status: 500 });
  }
}
