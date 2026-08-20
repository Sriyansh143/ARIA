/**
 * src/lib/pre-publish-gate.ts — v65 Phase 15 (Pre-Publish Quality Gate)
 *
 * RULE-51: NOTHING SHIPS UNTESTED.
 *
 * When a new service is approved by the operator, it must pass a quality
 * test BEFORE it becomes visible to customers (status: "launched").
 *
 * Flow:
 *   1. Operator approves a ServiceOpportunity (status: "pending_approval")
 *   2. This gate runs IMMEDIATELY (not waiting for cron)
 *   3. Calls the service-simulator to generate test deliverables
 *   4. Runs the quality supervisor (trajectory validation) on the output
 *   5. If score >= 70: set status: "launched" — visible to customers
 *   6. If score < 70: keep status: "draft", create improvement task, notify owner
 */

import "server-only";
import { db } from "./db";
import { logger } from "./logger";
import { emit } from "./event-bus";

const QUALITY_THRESHOLD = 70;

export interface PrePublishResult {
  passed: boolean;
  score: number;
  verdict: "pass" | "needs_review" | "fail";
  details: string;
  serviceId: string;
  serviceName: string;
}

/**
 * Run the pre-publish quality gate on a ServiceOpportunity.
 * Called immediately after operator approval.
 */
export async function runPrePublishGate(opportunityId: string): Promise<PrePublishResult> {
  const opp = await db.serviceOpportunity.findUnique({ where: { id: opportunityId } });
  if (!opp) {
    return {
      passed: false,
      score: 0,
      verdict: "fail",
      details: "Service opportunity not found",
      serviceId: opportunityId,
      serviceName: "unknown",
    };
  }

  logger.info("pre-publish-gate.start", { id: opportunityId, name: opp.name });

  // Mark as "testing" while the gate runs.
  await db.serviceOpportunity.update({
    where: { id: opportunityId },
    data: { status: "testing" },
  });

  try {
    // Parse the service spec from the research JSON.
    const research = JSON.parse(opp.research || "{}");
    const spec = research.spec || {};
    const serviceName = opp.name || spec.name || "Unnamed Service";
    const builderPrompt = spec.builderPrompt || opp.description || "Generate the service deliverable.";
    const deliverables: string[] = spec.deliverables || ["deliverable.txt"];
    const priceCents = Math.round(Number(opp.estimatedPrice || 0) * 100);

    // Run the service simulator (generates test deliverables + scores them).
    const { simulateService } = await import("./expansion/service-simulator");
    const simResult = await simulateService(opportunityId, {
      name: serviceName,
      builderPrompt,
      deliverables,
      priceCents,
    });

    const score = Math.round(simResult.avgScore);
    const passed = score >= QUALITY_THRESHOLD;

    const result: PrePublishResult = {
      passed,
      score,
      verdict: simResult.verdict,
      details: `Quality gate ${passed ? "PASSED" : "FAILED"}: score ${score}/${100} (threshold: ${QUALITY_THRESHOLD}). ${simResult.verdict}.`,
      serviceId: opportunityId,
      serviceName,
    };

    if (passed) {
      // Publish: set status to "launched" — now visible to customers.
      await db.serviceOpportunity.update({
        where: { id: opportunityId },
        data: {
          status: "launched",
          compositeScore: score,
        },
      });

      emit({
        type: "system",
        ts: new Date().toISOString(),
        message: `✅ Service "${serviceName}" PASSED quality gate (score: ${score}/100) — now published + visible to customers.`,
        level: "success",
      });

      logger.info("pre-publish-gate.passed", { id: opportunityId, name: serviceName, score });
    } else {
      // Hold: keep as "draft" — NOT visible to customers.
      await db.serviceOpportunity.update({
        where: { id: opportunityId },
        data: {
          status: "draft",
          compositeScore: score,
        },
      });

      // Create an improvement task.
      await db.task.create({
        data: {
          title: `Improve service quality: ${serviceName} (score: ${score}/100)`,
          description: `Service "${serviceName}" scored ${score}/100 in the pre-publish quality gate (threshold: ${QUALITY_THRESHOLD}). Improve the builder prompt, deliverables, or spec until the score is >= ${QUALITY_THRESHOLD}.`,
          kind: "review",
          status: "pending",
          priority: "high",
        },
      }).catch(() => {});

      // Notify owner via Telegram.
      try {
        const { sendTelegramMessage } = await import("./telegram-notifier");
        await sendTelegramMessage(
          `⚠️ *Service Quality Gate FAILED*\n\n` +
          `*Service:* ${serviceName}\n` +
          `*Score:* ${score}/100 (threshold: ${QUALITY_THRESHOLD})\n` +
          `*Verdict:* ${simResult.verdict}\n\n` +
          `The service is held from publication until quality improves. An improvement task has been created.`,
        );
      } catch { /* best-effort */ }

      emit({
        type: "system",
        ts: new Date().toISOString(),
        message: `⚠️ Service "${serviceName}" FAILED quality gate (score: ${score}/100) — held from publication. Improvement task created.`,
        level: "warn",
      });

      logger.warn("pre-publish-gate.failed", { id: opportunityId, name: serviceName, score, threshold: QUALITY_THRESHOLD });
    }

    return result;
  } catch (err) {
    // On error, hold the service as "draft" (fail-closed).
    await db.serviceOpportunity.update({
      where: { id: opportunityId },
      data: { status: "draft" },
    }).catch(() => {});

    logger.error("pre-publish-gate.error", { id: opportunityId, error: String(err) });

    return {
      passed: false,
      score: 0,
      verdict: "fail",
      details: `Quality gate error: ${String(err).slice(0, 200)}`,
      serviceId: opportunityId,
      serviceName: opp.name,
    };
  }
}
