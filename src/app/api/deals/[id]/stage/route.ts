import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { emit } from "@/lib/event-bus";
import { DEAL_STAGES, toIso, type Deal } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Local ISO-now helper (kept here so the route is self-contained). */
function nowIso(): string {
  return new Date().toISOString();
}

/** Serialize a raw DB deal row into the validated `Deal` contract. */
function serializeDeal(row: {
  id: string;
  title: string;
  value: number;
  currency: string;
  stage: string;
  probability: number;
  source: string;
  agentId: string | null;
  counterparty: string | null;
  expectedClose: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): Deal {
  return {
    id: row.id,
    title: row.title,
    value: row.value,
    currency: row.currency,
    stage: row.stage as Deal["stage"],
    probability: row.probability,
    source: row.source,
    agentId: row.agentId,
    counterparty: row.counterparty,
    expectedClose: toIso(row.expectedClose),
    createdAt: toIso(row.createdAt)!,
    updatedAt: toIso(row.updatedAt)!,
  };
}

/**
 * PATCH /api/deals/[id]/stage
 *
 * Body: { stage: string }
 *
 * Validates the stage is one of DEAL_STAGES, updates the deal, and emits:
 *   - a `system` event (info) announcing the move
 *   - a `deal.update` event so every connected client reflects the new
 *     stage immediately (the kanban re-renders from the store, no refetch)
 *
 * Returns the updated deal as a `Deal` on success.
 *   400 — invalid stage (not in DEAL_STAGES)
 *   404 — deal not found
 *   500 — unexpected error
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const body = (await req.json().catch(() => ({}))) as { stage?: string };
    const stage = body?.stage;

    if (!stage || !DEAL_STAGES.includes(stage as (typeof DEAL_STAGES)[number])) {
      return NextResponse.json(
        {
          error: `invalid stage; must be one of: ${DEAL_STAGES.join(", ")}`,
          received: stage ?? null,
        },
        { status: 400 }
      );
    }

    const existing = await db.deal.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "deal not found" }, { status: 404 });
    }

    const updated = await db.deal.update({
      where: { id },
      data: { stage },
    });

    const deal = serializeDeal(updated);

    // Announce the move on the live event stream.
    emit({
      type: "system",
      ts: nowIso(),
      message: `Deal ${deal.title} moved to ${stage}`,
      level: "info",
    });

    // Re-broadcast the updated deal so every connected client (including
    // the one that triggered the drag) reflects the new stage instantly.
    emit({
      type: "deal.update",
      ts: nowIso(),
      deal,
    });

    logger.info("api.deals.stage.updated", { dealId: id, stage });

    return NextResponse.json({ ok: true, deal });
  } catch (err) {
    logger.error("api.deals.stage.failed", {
      error: String(err),
    });
    return NextResponse.json(
      { error: "failed to update deal stage" },
      { status: 500 }
    );
  }
}
