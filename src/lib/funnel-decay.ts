/**
 * ARIA Mission Control — Lead staleness math + attention triage.
 *
 * Ported from FounderOS-DEMO/lib/funnel-decay.ts, adapted for ARIA's Deal
 * model. The original was generic over a `DecayInput` row type with explicit
 * `touches[]` and `likelihood` fields. ARIA's `Deal` has `stage`, `probability`,
 * `updatedAt`, and `createdAt` — so we read staleness off `updatedAt` (the
 * Prisma `@updatedAt` field that ticks on every stage change) and use
 * `probability` (0-100) as the win-likelihood signal.
 *
 * Pure math: no Zod, no DB, no React, no IO. Hand it any `Deal[]` (Prisma
 * rows, API payloads, or mock data — they all satisfy the structural shape)
 * and it returns disjoint buckets + queues.
 *
 * Bucket boundaries (the task spec's thresholds):
 *   fresh  : <24h since last activity       — respond fast
 *   warm   : 24–72h                          — still in motion
 *   cold   : 3–7d                            — needs re-engagement
 *   frozen : >7d                             — at risk of decay
 *
 * Triage queues (the FounderOS disjoint-queue pattern, lifted verbatim):
 *   pushNow : fresh + hot probability — push while momentum lasts.
 *             Sorted freshest-first (movement is when a push closes).
 *   saveNow : cold or frozen (not yet won/lost) — rescue before archive.
 *             Sorted by probability desc (rescue should buy the most).
 *
 * Won and lost deals are exempt from both queues — a closed deal is not a
 * follow-up failure. They still appear in the staleness classification for
 * reporting, but `triageLeads` filters them out.
 */
import type { Deal } from "@/lib/types";

const MS_PER_DAY = 86_400_000;
const MS_PER_HOUR = 3_600_000;

/** Bucket thresholds in hours since `updatedAt`. Tunable but exported. */
export const STALENESS_THRESHOLDS = {
  freshMaxHours: 24,
  warmMaxHours: 72,
  coldMaxHours: 7 * 24, // 168h
} as const;

export type StalenessBucket = "fresh" | "warm" | "cold" | "frozen";

export type StalenessClassification = Record<StalenessBucket, Deal[]>;

/** Closed deal stages — these skip the triage queues entirely. */
const CLOSED_STAGES: ReadonlySet<string> = new Set(["won", "lost"]);

/**
 * Hours since the deal's last activity, never negative. Reads `updatedAt`
 * (Prisma's auto-tick on every stage change). Falls back to `createdAt` when
 * `updatedAt` is somehow missing — a deal nobody has touched is still aging
 * from the moment it arrived.
 *
 * Throws on unparseable dates — the worst failure mode for staleness math is
 * a deal that silently reads as healthy forever. Better to fail loudly.
 */
export function hoursSinceLastActivity(deal: Deal, now: Date = new Date()): number {
  const lastAt = deal.updatedAt ?? deal.createdAt;
  const then = new Date(lastAt).getTime();
  if (Number.isNaN(then)) {
    throw new TypeError(
      `funnel-decay: unparseable date on deal ${deal.id}: ${JSON.stringify(lastAt)}`,
    );
  }
  return Math.max(0, (now.getTime() - then) / MS_PER_HOUR);
}

/** Classify a single deal into a staleness bucket. */
export function classifyDeal(deal: Deal, now: Date = new Date()): StalenessBucket {
  const h = hoursSinceLastActivity(deal, now);
  if (h < STALENESS_THRESHOLDS.freshMaxHours) return "fresh";
  if (h < STALENESS_THRESHOLDS.warmMaxHours) return "warm";
  if (h < STALENESS_THRESHOLDS.coldMaxHours) return "cold";
  return "frozen";
}

/**
 * Bucket every deal by staleness. Order within each bucket is preserved
 * (stable partition). Closed deals (won/lost) are still classified —
 * reporting cares about every row — but see `triageLeads` for the active
 * funnel.
 */
export function classifyLeadStaleness(deals: Deal[], now: Date = new Date()): StalenessClassification {
  const out: StalenessClassification = { fresh: [], warm: [], cold: [], frozen: [] };
  for (const deal of deals) {
    out[classifyDeal(deal, now)].push(deal);
  }
  return out;
}

/** Probability threshold at or above which a fresh deal is "hot" enough to push. */
export const PUSH_PROBABILITY = 50;

/** Max entries per triage queue — keeps the rail glanceable. */
export const ATTENTION_CAP = 8;

/**
 * The two questions worth answering, derived from the same staleness read:
 *
 *   pushNow — fresh AND probability ≥ PUSH_PROBABILITY AND not closed.
 *             Sorted freshest-movement first (momentum is when a push closes,
 *             not probability). Capped at ATTENTION_CAP.
 *
 *   saveNow — cold OR frozen AND not closed. Sorted by probability desc
 *             (a rescue costs real effort and should buy the most). Capped.
 *
 * Disjoint by construction: pushNow requires fresh; saveNow requires cold or
 * frozen. Warm deals fall through to neither — they're still in motion and
 * don't need attention yet. Won/lost are excluded from both.
 */
export function triageLeads(
  deals: Deal[],
  now: Date = new Date(),
): { pushNow: Deal[]; saveNow: Deal[] } {
  const active = deals.filter((d) => !CLOSED_STAGES.has(d.stage));

  const pushNow = active
    .filter((d) => {
      const bucket = classifyDeal(d, now);
      return bucket === "fresh" && d.probability >= PUSH_PROBABILITY;
    })
    .sort((a, b) => {
      // Freshest first — most recent updatedAt wins.
      const aT = new Date(a.updatedAt).getTime();
      const bT = new Date(b.updatedAt).getTime();
      return bT - aT || b.probability - a.probability;
    })
    .slice(0, ATTENTION_CAP);

  const saveNow = active
    .filter((d) => {
      const bucket = classifyDeal(d, now);
      return bucket === "cold" || bucket === "frozen";
    })
    .sort((a, b) => b.probability - a.probability || new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime())
    .slice(0, ATTENTION_CAP);

  return { pushNow, saveNow };
}

/**
 * The single stalest non-closed deal (the one quiet longest). Returns null
 * when the input is empty or every deal is closed. Useful for the Alerts
 * Ticker's "oldest untouched lead" pulse row.
 */
export function stalestLead(deals: Deal[], now: Date = new Date()): Deal | null {
  const active = deals.filter((d) => !CLOSED_STAGES.has(d.stage));
  if (active.length === 0) return null;
  let worst = active[0];
  let worstHours = hoursSinceLastActivity(worst, now);
  for (let i = 1; i < active.length; i++) {
    const h = hoursSinceLastActivity(active[i], now);
    if (h > worstHours) {
      worst = active[i];
      worstHours = h;
    }
  }
  return worst;
}

// ─── Convenience: days-since for the ticker/UI ────────────────────────
/** Days since last activity, floored, never negative. */
export function daysSinceLastActivity(deal: Deal, now: Date = new Date()): number {
  return Math.floor(hoursSinceLastActivity(deal, now) * MS_PER_HOUR / MS_PER_DAY);
}

/** Human label for a bucket — used by the funnel UI + alert text. */
export function bucketLabel(bucket: StalenessBucket): string {
  switch (bucket) {
    case "fresh": return "Fresh (<24h)";
    case "warm": return "Warm (24–72h)";
    case "cold": return "Cold (3–7d)";
    case "frozen": return "Frozen (>7d)";
  }
}
