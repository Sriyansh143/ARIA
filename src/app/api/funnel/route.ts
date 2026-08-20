import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { toIso, type Deal } from "@/lib/types";
import {
  classifyLeadStaleness,
  triageLeads,
  stalestLead,
  daysSinceLastActivity,
  bucketLabel,
  type StalenessBucket,
} from "@/lib/funnel-decay";

export const dynamic = "force-dynamic";

/**
 * GET /api/funnel
 *
 * Returns the lead-staleness classification + triage queues for ARIA's
 * deal pipeline. Reads `Deal` rows from the DB and feeds them through the
 * pure `funnel-decay.ts` module — no math in this route, just plumbing.
 *
 * Response shape:
 *   {
 *     buckets:   Record<StalenessBucket, Deal[]>,    // fresh/warm/cold/frozen
 *     counts:    Record<StalenessBucket, number>,
 *     triage:    { pushNow: Deal[]; saveNow: Deal[] },
 *     stalest:   Deal | null,                        // oldest untouched
 *     stageCounts: Record<stage, number>,            // pipeline distribution
 *     totalValue: number,                            // sum of all deal values
 *     now:        string                             // ISO ts of the snapshot
 *   }
 */
export async function GET(): Promise<Response> {
  try {
    const rows = await db.deal.findMany({
      orderBy: { updatedAt: "desc" },
    });

    // Map DB rows to the Deal domain type.
    const deals: Deal[] = rows.map((r) => ({
      id: r.id,
      title: r.title,
      value: r.value,
      currency: r.currency,
      stage: r.stage as Deal["stage"],
      probability: r.probability,
      source: r.source,
      agentId: r.agentId,
      counterparty: r.counterparty,
      expectedClose: toIso(r.expectedClose),
      createdAt: toIso(r.createdAt)!,
      updatedAt: toIso(r.updatedAt)!,
    }));

    const now = new Date();
    const buckets = classifyLeadStaleness(deals, now);
    const counts: Record<StalenessBucket, number> = {
      fresh: buckets.fresh.length,
      warm: buckets.warm.length,
      cold: buckets.cold.length,
      frozen: buckets.frozen.length,
    };
    const triage = triageLeads(deals, now);
    const stalest = stalestLead(deals, now);

    // Pipeline distribution + total value (for the funnel header).
    const stageCounts: Record<string, number> = {};
    let totalValue = 0;
    for (const d of deals) {
      stageCounts[d.stage] = (stageCounts[d.stage] ?? 0) + 1;
      totalValue += d.value;
    }

    // Augment the stalest deal with its age in days (for the UI to render
    // "oldest untouched lead: 12d").
    const stalestWithAge = stalest
      ? {
          ...stalest,
          daysSinceActivity: daysSinceLastActivity(stalest, now),
        }
      : null;

    return NextResponse.json({
      buckets,
      counts,
      bucketLabels: {
        fresh: bucketLabel("fresh"),
        warm: bucketLabel("warm"),
        cold: bucketLabel("cold"),
        frozen: bucketLabel("frozen"),
      },
      triage,
      stalest: stalestWithAge,
      stageCounts,
      totalValue,
      totalDeals: deals.length,
      now: now.toISOString(),
    });
  } catch (err) {
    console.error("[api/funnel] failed:", err);
    return NextResponse.json(
      {
        error: "failed to compute funnel triage",
        detail: err instanceof Error ? err.message : "unknown",
      },
      { status: 500 },
    );
  }
}
