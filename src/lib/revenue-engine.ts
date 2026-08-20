/**
 * src/lib/revenue-engine.ts — 6-stage revenue pipeline.
 *
 * Server-only. Implements the v25 FIND → QUALIFY → PLAN → EXECUTE →
 * TRACK → OPTIMIZE cycle:
 *
 *   FIND      : list EarningOpportunity rows in status="discovered"
 *   QUALIFY   : run Monte Carlo feasibility; mark "qualified" if GO
 *   PLAN      : create a Task for each qualified opportunity
 *   EXECUTE   : flip the task to in_progress + opportunity to "executing"
 *   TRACK     : count RevenueEvent rows created today
 *   OPTIMIZE  : noop log (placeholder for future optimizers)
 *
 * Each stage is independently try/caught — partial failure still
 * advances the cycle.
 */

import { db } from "./db";
import { logger } from "./logger";
import { runMonteCarlo } from "./feasibility";

export interface RevenueStage {
  name: string;
  count: number;
  value: number;
}

export interface RevenueCycleResult {
  found: number;
  qualified: number;
  planned: number;
  executed: number;
  tracked: number;
  optimized: number;
}

// ─── runRevenueCycle ────────────────────────────────────────────────

export async function runRevenueCycle(): Promise<RevenueCycleResult> {
  const result: RevenueCycleResult = {
    found: 0,
    qualified: 0,
    planned: 0,
    executed: 0,
    tracked: 0,
    optimized: 0,
  };

  // ── FIND ──────────────────────────────────────────────────────────
  let discovered: Awaited<ReturnType<typeof db.earningOpportunity.findMany>> = [];
  try {
    discovered = await db.earningOpportunity.findMany({
      where: { status: "discovered" },
      take: 50,
    });
    result.found = discovered.length;
  } catch (err) {
    logger.error("revenue-engine.find.failed", { error: String(err) });
  }

  // ── QUALIFY ───────────────────────────────────────────────────────
  const qualifiedIds: string[] = [];
  try {
    for (const opp of discovered) {
      const variance = opp.estimatedRevenue * (1 - opp.feasibilityScore) * 0.6 + 1;
      const mc = runMonteCarlo({
        baseEstimate: opp.estimatedRevenue,
        variance,
        iterations: 500,
      });
      if (mc.goHaltPivot === "GO") {
        await db.earningOpportunity.update({
          where: { id: opp.id },
          data: { status: "qualified", feasibilityScore: mc.confidence },
        });
        qualifiedIds.push(opp.id);
        result.qualified++;
      }
    }
  } catch (err) {
    logger.error("revenue-engine.qualify.failed", { error: String(err) });
  }

  // ── PLAN ──────────────────────────────────────────────────────────
  try {
    for (const id of qualifiedIds) {
      const opp = await db.earningOpportunity.findUnique({ where: { id } });
      if (!opp) continue;
      const task = await db.task.create({
        data: {
          title: `Execute: ${opp.title}`,
          description: opp.description ?? `Pursue ${opp.source} opportunity valued at $${opp.estimatedRevenue}`,
          status: "pending",
          priority: "high",
          kind: "work",
        },
      });
      await db.earningOpportunity.update({
        where: { id },
        data: { taskId: task.id, status: "pipeline" },
      });
      result.planned++;
    }
  } catch (err) {
    logger.error("revenue-engine.plan.failed", { error: String(err) });
  }

  // ── EXECUTE ───────────────────────────────────────────────────────
  // v45 fix I1: EXECUTE now actually triggers downstream work, not just a status flip.
  // For opportunities with source="lead-finder", ensure a follow_up Task exists so the
  // OutreachExecutor cron will pick it up. For source="services" (crypto/UPI orders),
  // trigger approveOrder() if the order is in paid_verified state.
  try {
    const pipeline = await db.earningOpportunity.findMany({
      where: { status: "pipeline" },
      take: 20,
    });
    for (const opp of pipeline) {
      if (!opp.taskId) continue;
      await db.task.update({
        where: { id: opp.taskId },
        data: { status: "running", startedAt: new Date() },
      });
      await db.earningOpportunity.update({
        where: { id: opp.id },
        data: { status: "executing" },
      });

      // v45: Trigger downstream work based on opportunity source.
      try {
        if (opp.source === "lead-finder") {
          // Ensure a follow_up Task exists for the OutreachExecutor to pick up.
          // (The task may already exist from the approve route — check first.)
          const existingFollowUp = await db.task.findFirst({
            where: {
              kind: "follow_up",
              status: "pending",
            },
          });
          // Look up if any EarningOpportunity is linked to this task
          // ( taskId is set on the opportunity, not the task)
          const linkedOpp = existingFollowUp
            ? await db.earningOpportunity.findFirst({
                where: { taskId: existingFollowUp.id },
              })
            : null;
          if (!linkedOpp || linkedOpp.id !== opp.id) {
            // No follow_up task yet — create one
            const followUpTask = await db.task.create({
              data: {
                title: `Outreach: ${opp.title}`,
                description: `Send personalized outreach email for opportunity: ${opp.title}`,
                kind: "follow_up",
                status: "pending",
                priority: "medium",
              },
            });
            await db.earningOpportunity.update({
              where: { id: opp.id },
              data: { taskId: followUpTask.id },
            });
            logger.info("revenue-engine.execute.created-follow-up", {
              opportunityId: opp.id,
              taskId: followUpTask.id,
            });
          }
        } else if (opp.source === "services" || opp.source === "upi") {
          // For service orders in paid_verified state, trigger approveOrder.
          // The opportunity description should contain the orderId.
          const orderIdMatch = opp.description?.match(/Order[^\w]+([a-z0-9]{20,})/i);
          if (orderIdMatch) {
            const orderId = orderIdMatch[1];
            const order = await db.serviceOrder.findUnique({ where: { id: orderId } });
            if (order && order.status === "paid_verified" && !order.ownerApproved) {
              const { approveOrder } = await import("./services/crypto-checkout");
              await approveOrder(orderId);
              logger.info("revenue-engine.execute.triggered-build", {
                opportunityId: opp.id,
                orderId,
              });
            }
          }
        }
      } catch (triggerErr) {
        // Don't fail the whole EXECUTE stage if one trigger fails
        logger.warn("revenue-engine.execute.trigger-failed", {
          opportunityId: opp.id,
          error: String(triggerErr).slice(0, 100),
        });
      }

      result.executed++;
    }
  } catch (err) {
    logger.error("revenue-engine.execute.failed", { error: String(err) });
  }

  // ── TRACK ─────────────────────────────────────────────────────────
  try {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const events = await db.revenueEvent.findMany({
      where: { createdAt: { gte: todayStart } },
    });
    result.tracked = events.length;
  } catch (err) {
    logger.error("revenue-engine.track.failed", { error: String(err) });
  }

  // ── OPTIMIZE ──────────────────────────────────────────────────────
  // v45 fix I2: OPTIMIZE now does real work — analyzes reply/booking rates per
  // industry + stores recommendations as a MemoryItem for the LeadFinder to read.
  try {
    const contacted = await db.earningOpportunity.count({
      where: { source: "lead-finder", status: { in: ["contacted", "replied", "booked", "closed"] } },
    });
    const replied = await db.earningOpportunity.count({
      where: { source: "lead-finder", status: { in: ["replied", "booked"] } },
    });
    const booked = await db.earningOpportunity.count({
      where: { source: "lead-finder", status: "booked" },
    });
    const closedLost = await db.earningOpportunity.count({
      where: { source: "lead-finder", status: "closed" },
    });

    const replyRate = contacted > 0 ? (replied / contacted) * 100 : 0;
    const bookingRate = replied > 0 ? (booked / replied) * 100 : 0;

    // Compute today's actual revenue from RevenueEvent (v45 phantom-revenue fix)
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayRevenue = await db.revenueEvent.aggregate({
      where: { createdAt: { gte: todayStart } },
      _sum: { amount: true },
    });

    // Store the optimization analysis as a MemoryItem the LeadFinder can read.
    const optimization = {
      analyzedAt: new Date().toISOString(),
      metrics: {
        contacted,
        replied,
        booked,
        closedLost,
        replyRate: Math.round(replyRate * 10) / 10,
        bookingRate: Math.round(bookingRate * 10) / 10,
        todayRevenue: todayRevenue._sum.amount ?? 0,
      },
      recommendations: [] as string[],
    };

    if (replyRate < 5 && contacted > 10) {
      optimization.recommendations.push(
        "Reply rate <5% — LeadFinder may be producing low-quality leads. Consider tightening the confidenceScore threshold from 50 to 65.",
      );
    }
    if (bookingRate < 20 && replied > 5) {
      optimization.recommendations.push(
        "Booking rate <20% — outreach emails may not be compelling. Review the LLM prompt + booking URL.",
      );
    }
    if (closedLost > contacted * 0.5) {
      optimization.recommendations.push(
        ">50% leads closed-lost — the targeting criteria may be wrong. Review the LeadFinder search queries.",
      );
    }
    if (todayRevenue._sum.amount && todayRevenue._sum.amount > 0) {
      optimization.recommendations.push(
        `Revenue today: $${todayRevenue._sum.amount.toFixed(2)}. Keep monitoring.`,
      );
    }

    // Persist as a MemoryItem (the LeadFinder's scoreLead prompt can read this)
    try {
      await db.memoryItem.upsert({
        where: { key: "revenue-optimization-latest" },
        create: {
          key: "revenue-optimization-latest",
          scope: "optimization",
          value: JSON.stringify(optimization),
          tags: JSON.stringify(["revenue", "optimization", "lead-finder"]),
          strength: 0.8,
        },
        update: {
          value: JSON.stringify(optimization),
          updatedAt: new Date(),
        },
      });
    } catch {
      // non-fatal
    }

    result.optimized = result.executed;
    logger.info("revenue-engine.optimize.complete", {
      replyRate: optimization.metrics.replyRate,
      bookingRate: optimization.metrics.bookingRate,
      todayRevenue: optimization.metrics.todayRevenue,
      recommendations: optimization.recommendations.length,
    });
  } catch (err) {
    logger.error("revenue-engine.optimize.failed", { error: String(err) });
  }

  logger.success("revenue-engine.cycle.complete", result as unknown as Record<string, unknown>);
  return result;
}

// ─── getRevenuePipeline ─────────────────────────────────────────────

export async function getRevenuePipeline(): Promise<{
  stages: RevenueStage[];
}> {
  try {
    const [discovered, qualified, pipeline, executing, todayRevenue, total] = await Promise.all([
      db.earningOpportunity.count({ where: { status: "discovered" } }),
      db.earningOpportunity.count({ where: { status: "qualified" } }),
      db.earningOpportunity.count({ where: { status: "pipeline" } }),
      db.earningOpportunity.count({ where: { status: "executing" } }),
      db.revenueEvent.aggregate({
        where: {
          createdAt: {
            gte: new Date(new Date().setHours(0, 0, 0, 0)),
          },
        },
        _sum: { amount: true },
      }),
      db.revenueEvent.aggregate({ _sum: { amount: true } }),
    ]);

    return {
      stages: [
        { name: "FIND", count: discovered, value: 0 },
        { name: "QUALIFY", count: qualified, value: 0 },
        { name: "PLAN", count: pipeline, value: 0 },
        { name: "EXECUTE", count: executing, value: 0 },
        {
          name: "TRACK",
          count: todayRevenue._sum.amount ? 1 : 0,
          value: todayRevenue._sum.amount ?? 0,
        },
        {
          name: "OPTIMIZE",
          count: 0,
          value: total._sum.amount ?? 0,
        },
      ],
    };
  } catch (err) {
    logger.error("revenue-engine.pipeline.failed", { error: String(err) });
    return {
      stages: [
        { name: "FIND", count: 0, value: 0 },
        { name: "QUALIFY", count: 0, value: 0 },
        { name: "PLAN", count: 0, value: 0 },
        { name: "EXECUTE", count: 0, value: 0 },
        { name: "TRACK", count: 0, value: 0 },
        { name: "OPTIMIZE", count: 0, value: 0 },
      ],
    };
  }
}
