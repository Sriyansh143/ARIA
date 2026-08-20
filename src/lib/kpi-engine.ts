/**
 * src/lib/kpi-engine.ts — KPI snapshots.
 *
 * Server-only. Captures a point-in-time snapshot of the 6 headline KPIs
 * (revenue, tasks, agents, payments, leads, customers) into the
 * KpiSnapshot table. Supports a 7-day series and a 24h delta summary.
 */

import type { KpiSnapshot } from "@prisma/client";
import { db } from "./db";
import { logger } from "./logger";

export interface KpiSummary {
  latest: KpiSnapshot | null;
  deltas: { metric: string; value: number; delta: number }[];
}

// ─── captureSnapshot ────────────────────────────────────────────────

export async function captureSnapshot(): Promise<{ id: string }> {
  try {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const [
      revenueAgg,
      tasksDone,
      agentsActive,
      payments,
      leads,
      customers,
    ] = await Promise.all([
      db.revenueEvent.aggregate({
        where: { createdAt: { gte: todayStart } },
        _sum: { amount: true },
      }),
      db.task.count({ where: { status: "completed" } }),
      db.agent.count({
        where: { status: { not: "offline" } },
      }),
      db.revenueEvent.count({
        where: {
          createdAt: { gte: todayStart },
          // v47 fix 5: Was source:"subscription" (always 0 for crypto/UPI orders).
          // Now matches the source field that crypto-checkout.ts:215 + upi-payments.ts
          // actually use when creating RevenueEvent rows. Include "subscription"
          // for forward-compat if Stripe is ever re-enabled.
          source: { in: ["services", "subscription"] },
        },
      }),
      db.deal.count({ where: { stage: "lead" } }),
      db.deal.count({ where: { stage: "won" } }),
    ]);

    const row = await db.kpiSnapshot.create({
      data: {
        revenue: revenueAgg._sum.amount ?? 0,
        tasksDone,
        agentsActive,
        payments,
        leads,
        customers,
        payload: JSON.stringify({
          capturedAt: now.toISOString(),
          source: "kpi-engine.captureSnapshot",
        }),
      },
    });

    logger.success("kpi-engine.captured", { id: row.id });
    return { id: row.id };
  } catch (err) {
    logger.error("kpi-engine.capture.failed", { error: String(err) });
    throw err;
  }
}

// ─── getKpiSeries ───────────────────────────────────────────────────

export async function getKpiSeries(days = 7): Promise<KpiSnapshot[]> {
  try {
    const since = new Date();
    since.setDate(since.getDate() - days);
    return await db.kpiSnapshot.findMany({
      where: { createdAt: { gte: since } },
      orderBy: { createdAt: "asc" },
      take: Math.min(Math.max(days, 1), 90) * 4, // allow up to 4 snapshots/day
    });
  } catch (err) {
    logger.error("kpi-engine.series.failed", { error: String(err) });
    return [];
  }
}

// ─── getKpiSummary ──────────────────────────────────────────────────

export async function getKpiSummary(): Promise<KpiSummary> {
  try {
    const snapshots = await db.kpiSnapshot.findMany({
      orderBy: { createdAt: "desc" },
      take: 2,
    });
    const latest = snapshots[0] ?? null;
    const prev = snapshots[1] ?? null;

    const deltas: { metric: string; value: number; delta: number }[] = [];
    if (latest && prev) {
      deltas.push(
        { metric: "revenue", value: latest.revenue, delta: latest.revenue - prev.revenue },
        { metric: "tasks", value: latest.tasksDone, delta: latest.tasksDone - prev.tasksDone },
        { metric: "agents", value: latest.agentsActive, delta: latest.agentsActive - prev.agentsActive }
      );
    } else if (latest) {
      deltas.push(
        { metric: "revenue", value: latest.revenue, delta: 0 },
        { metric: "tasks", value: latest.tasksDone, delta: 0 },
        { metric: "agents", value: latest.agentsActive, delta: 0 }
      );
    }

    return { latest, deltas };
  } catch (err) {
    logger.error("kpi-engine.summary.failed", { error: String(err) });
    return { latest: null, deltas: [] };
  }
}
