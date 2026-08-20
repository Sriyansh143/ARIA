import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/business-lifecycle/status — current lifecycle pipeline status.
 *
 * Returns counts of deals/tasks/revenue by stage, recent cycle results
 * (Notes titled "Deliverable:" or "Invoice:"), and the current
 * industry focus derived from the most recent EarningOpportunity source.
 */
export async function GET() {
  try {
    const [
      dealsByStage,
      tasksByStatus,
      revenueAgg,
      deliverableNotes,
      invoiceNotes,
      recentOpportunities,
      optMemories,
      recentApprovedTasks,
    ] = await Promise.all([
      db.deal.groupBy({ by: ["stage"], _count: true }),
      db.task.groupBy({ by: ["status"], _count: true }),
      db.revenueEvent.aggregate({ _sum: { amount: true }, _count: true }),
      db.note.findMany({
        where: { title: { startsWith: "Deliverable:" } },
        orderBy: { createdAt: "desc" },
        take: 10,
        select: { id: true, title: true, createdAt: true },
      }),
      db.note.findMany({
        where: { title: { startsWith: "Invoice:" } },
        orderBy: { createdAt: "desc" },
        take: 10,
        select: { id: true, title: true, body: true, createdAt: true },
      }),
      db.earningOpportunity.findMany({
        orderBy: { discoveredAt: "desc" },
        take: 20,
        select: { id: true, source: true, title: true, discoveredAt: true },
      }),
      db.memoryItem.count({ where: { scope: "optimization" } }),
      db.task.count({ where: { status: "completed" } }),
    ]);

    // Derive the current industry focus from the most recent opportunity
    // whose source begins with `industry:`.
    const recentIndustryOpp = recentOpportunities.find((o) =>
      o.source?.startsWith("industry:"),
    );
    const currentIndustryFocus = recentIndustryOpp?.source?.replace("industry:", "") ?? null;

    // Parse invoice notes into lightweight summaries.
    const recentCycles = [
      ...deliverableNotes.map((n) => ({
        kind: "deliverable" as const,
        id: n.id,
        title: n.title,
        createdAt: n.createdAt,
      })),
      ...invoiceNotes.map((n) => {
        let amount = 0;
        try {
          const parsed = JSON.parse(n.body ?? "{}");
          amount = typeof parsed.amount === "number" ? parsed.amount : 0;
        } catch {
          // ignore
        }
        return {
          kind: "invoice" as const,
          id: n.id,
          title: n.title,
          amount,
          createdAt: n.createdAt,
        };
      }),
    ].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, 12);

    // Aggregate deal stage counts into a friendly map.
    const deals: Record<string, number> = {};
    for (const row of dealsByStage) {
      deals[row.stage] = row._count;
    }
    const tasks: Record<string, number> = {};
    for (const row of tasksByStatus) {
      tasks[row.status] = row._count;
    }

    return NextResponse.json({
      deals,
      tasks,
      revenue: {
        total: revenueAgg._sum.amount ?? 0,
        events: revenueAgg._count,
      },
      recentCycles,
      currentIndustryFocus,
      optimizationMemories: optMemories,
      completedTasks: recentApprovedTasks,
    });
  } catch (err) {
    logger.error("api.business-lifecycle.status.failed", { error: String(err) });
    return NextResponse.json(
      { error: "failed to get lifecycle status" },
      { status: 500 },
    );
  }
}
