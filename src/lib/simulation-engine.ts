/**
 * src/lib/simulation-engine.ts — v63 Phase 13 (Built-In Simulation Engine)
 *
 * A real MNC runs "war games," "customer journey tests," and "sales call
 * simulations" regularly to identify weaknesses before they hit real
 * customers. This module is the app's built-in Simulation Engine that
 * runs continuously as part of autonomous operations.
 *
 * NOT a one-time test script. This is a production module that:
 *   1. Runs simulation scenarios against the REAL app code paths
 *   2. Captures pass/fail + rules violated + lessons learned
 *   3. Stores results in AgentLog + KnowledgeBaseEntry
 *   4. Generates comprehensive readiness reports
 *   5. Exposes metrics for the dashboard
 *
 * Runs via:
 *   - weekly-simulation cron (Sunday 3 AM)
 *   - POST /api/simulations/run (manual trigger)
 *   - Dashboard /dashboard/simulations
 */

import "server-only";
import { db } from "./db";
import { logger } from "./logger";
import { emit } from "./event-bus";
import {
  type SimulationScenario,
  type SimulationResult,
  type SimulationSuiteResult,
  SIMULATION_SUITES,
} from "./simulation-scenarios";

// ─── Core: Run a single simulation ───────────────────────────────────

export async function runSimulation(scenario: SimulationScenario): Promise<SimulationResult> {
  const startTime = Date.now();
  logger.info("simulation-engine.run.start", { id: scenario.id, name: scenario.name });

  const result: SimulationResult = {
    id: scenario.id,
    name: scenario.name,
    type: scenario.type,
    passed: false,
    rulesViolated: [],
    lessonsLearned: [],
    executionTimeMs: 0,
    error: undefined,
    details: {},
  };

  try {
    // Setup: prepare the context for this scenario.
    if (scenario.setup) {
      await scenario.setup();
    }

    // Execute: run the scenario's test logic.
    const execResult = await scenario.execute();

    // Evaluate success criteria.
    const criteriaResults = scenario.successCriteria.map((criterion) => ({
      criterion,
      met: execResult.criteriaMet?.[criterion] ?? false,
    }));
    const allCriteriaMet = criteriaResults.every((c) => c.met);

    result.passed = allCriteriaMet && !execResult.error;
    result.rulesViolated = execResult.rulesViolated ?? [];
    result.lessonsLearned = execResult.lessonsLearned ?? [];
    result.details = {
      criteriaResults,
      output: execResult.output?.slice(0, 500),
    };
    if (execResult.error) {
      result.error = execResult.error;
    }
  } catch (err) {
    result.passed = false;
    result.error = String(err).slice(0, 300);
    result.lessonsLearned.push(`Exception during simulation: ${result.error}`);
  } finally {
    result.executionTimeMs = Date.now() - startTime;
  }

  // Store the result in AgentLog for audit + future learning.
  try {
    await db.agentLog.create({
      data: {
        level: result.passed ? "info" : "warn",
        message: `Simulation ${result.passed ? "PASS" : "FAIL"}: ${scenario.name} (${result.executionTimeMs}ms)`,
        meta: JSON.stringify({
          type: "simulation",
          scenarioId: scenario.id,
          scenarioType: scenario.type,
          passed: result.passed,
          rulesViolated: result.rulesViolated,
          lessonsLearned: result.lessonsLearned,
          executionTimeMs: result.executionTimeMs,
          error: result.error,
          details: result.details,
        }),
      },
    });
  } catch {
    // best-effort
  }

  // v69 Phase 19 BLOCKER 10: When a simulation FAILS (score < 70 — i.e.
  // any case where passed === false), log the individual failure to the
  // KnowledgeBaseEntry table with tags ["simulation-failure", "lesson-learned"].
  // This makes individual failures searchable + retrievable for the
  // rules-auditor cron (which reviews KB entries when proposing improvements).
  if (!result.passed) {
    try {
      await db.knowledgeBaseEntry.create({
        data: {
          title: `Simulation Failure: ${scenario.name}`.slice(0, 200),
          category: "simulation-failure",
          content: JSON.stringify({
            scenarioId: scenario.id,
            scenarioName: scenario.name,
            scenarioType: scenario.type,
            suite: "unknown", // populated by suite caller if known
            passed: false,
            rulesViolated: result.rulesViolated,
            lessonsLearned: result.lessonsLearned,
            error: result.error,
            details: result.details,
            executionTimeMs: result.executionTimeMs,
            failedAt: new Date().toISOString(),
          }, null, 2),
          source: "simulation-engine",
          tags: JSON.stringify(["simulation-failure", "lesson-learned", scenario.type]),
          coreLogic: `Scenario ${scenario.id} failed. ${result.error ?? "No error message."} Rules violated: ${result.rulesViolated.join(", ") || "none"}. Lessons: ${result.lessonsLearned.join("; ") || "none"}.`,
          systemPromptTemplate: null,
          toolsRequired: JSON.stringify([]),
          repoUrl: null,
          filePath: null,
        },
      });
      logger.info("simulation-engine.failure-logged-to-kb", {
        scenarioId: scenario.id,
        tags: ["simulation-failure", "lesson-learned"],
      });
    } catch (kbErr) {
      // best-effort — don't fail the simulation run if KB is unavailable.
      logger.warn("simulation-engine.kb-log-failed", {
        scenarioId: scenario.id,
        error: String(kbErr).slice(0, 80),
      });
    }
  }

  logger.info("simulation-engine.run.complete", {
    id: scenario.id,
    passed: result.passed,
    timeMs: result.executionTimeMs,
  });

  return result;
}

// ─── Run a suite of simulations ──────────────────────────────────────

export async function runSimulationSuite(
  suiteName: string,
): Promise<SimulationSuiteResult> {
  const scenarios = SIMULATION_SUITES[suiteName];
  if (!scenarios) {
    throw new Error(`Unknown simulation suite: ${suiteName}`);
  }

  logger.info("simulation-engine.suite.start", { suite: suiteName, count: scenarios.length });

  const results: SimulationResult[] = [];
  for (const scenario of scenarios) {
    const result = await runSimulation(scenario);
    results.push(result);
  }

  const passed = results.filter((r) => r.passed).length;
  const failed = results.length - passed;
  const passRate = results.length > 0 ? (passed / results.length) * 100 : 0;
  const avgExecutionTime =
    results.length > 0
      ? results.reduce((sum, r) => sum + r.executionTimeMs, 0) / results.length
      : 0;

  // Collect common failure patterns.
  const failurePatterns: Record<string, number> = {};
  for (const r of results.filter((r) => !r.passed)) {
    const pattern = r.error ?? "unknown failure";
    failurePatterns[pattern] = (failurePatterns[pattern] ?? 0) + 1;
  }

  const suiteResult: SimulationSuiteResult = {
    suiteName,
    totalScenarios: results.length,
    passed,
    failed,
    passRate,
    avgExecutionTimeMs: avgExecutionTime,
    commonFailurePatterns: Object.entries(failurePatterns)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([pattern, count]) => ({ pattern, count })),
    results,
  };

  emit({
    type: "system",
    ts: new Date().toISOString(),
    message: `🧪 Simulation suite "${suiteName}" complete: ${passed}/${results.length} passed (${passRate.toFixed(1)}%)`,
    level: passRate >= 95 ? "success" : "warn",
  });

  return suiteResult;
}

// ─── Generate a comprehensive readiness report ───────────────────────

export async function generateSimulationReport(): Promise<{
  overallPassRate: number;
  suiteBreakdown: Array<{ suite: string; passRate: number; total: number; passed: number }>;
  topFailures: Array<{ pattern: string; count: number }>;
  suggestedImprovements: string[];
  totalScenarios: number;
  totalTimeMs: number;
}> {
  // Run all 4 suites.
  const suiteNames = Object.keys(SIMULATION_SUITES);
  const suiteResults: SimulationSuiteResult[] = [];

  for (const name of suiteNames) {
    const result = await runSimulationSuite(name);
    suiteResults.push(result);
  }

  const totalScenarios = suiteResults.reduce((s, r) => s + r.totalScenarios, 0);
  const totalPassed = suiteResults.reduce((s, r) => s + r.passed, 0);
  const totalTimeMs = suiteResults.reduce((s, r) => s + r.avgExecutionTimeMs * r.totalScenarios, 0);
  const overallPassRate = totalScenarios > 0 ? (totalPassed / totalScenarios) * 100 : 0;

  // Collect top failures across all suites.
  const allFailures: Record<string, number> = {};
  for (const suite of suiteResults) {
    for (const failure of suite.commonFailurePatterns) {
      allFailures[failure.pattern] = (allFailures[failure.pattern] ?? 0) + failure.count;
    }
  }
  const topFailures = Object.entries(allFailures)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([pattern, count]) => ({ pattern, count }));

  // Generate suggested improvements based on failures.
  const suggestedImprovements: string[] = [];
  for (const failure of topFailures) {
    if (/payment/i.test(failure.pattern)) {
      suggestedImprovements.push("Review payment verification logic — payment-related simulations are failing.");
    }
    if (/timeout/i.test(failure.pattern)) {
      suggestedImprovements.push("Investigate timeout handling — external API calls may need longer timeouts or better fallbacks.");
    }
    if (/rule/i.test(failure.pattern)) {
      suggestedImprovements.push("Constitution rule violations detected — review the rules-auditor proposals.");
    }
    if (/approval/i.test(failure.pattern)) {
      suggestedImprovements.push("Approval flow issues — check the Telegram bot + approval-reminder cron.");
    }
  }
  if (suggestedImprovements.length === 0 && overallPassRate >= 95) {
    suggestedImprovements.push("All simulations passing at >95% — no improvements needed. Maintain current quality.");
  }

  const report = {
    overallPassRate,
    suiteBreakdown: suiteResults.map((s) => ({
      suite: s.suiteName,
      passRate: s.passRate,
      total: s.totalScenarios,
      passed: s.passed,
    })),
    topFailures,
    suggestedImprovements,
    totalScenarios,
    totalTimeMs,
  };

  // Store the report in KnowledgeBaseEntry for learning + trend analysis.
  try {
    await db.knowledgeBaseEntry.create({
      data: {
        title: `Simulation Report — ${new Date().toISOString().slice(0, 10)}`,
        category: "simulation_report",
        content: JSON.stringify(report, null, 2),
        source: "simulation-engine",
        tags: JSON.stringify(["simulation-report", "weekly", "auto-generated"]),
        coreLogic: `Overall pass rate: ${overallPassRate.toFixed(1)}% (${totalPassed}/${totalScenarios}). Top failure: ${topFailures[0]?.pattern ?? "none"}.`,
        systemPromptTemplate: null,
        toolsRequired: JSON.stringify([]),
        repoUrl: null,
        filePath: null,
      },
    });
  } catch {
    // best-effort
  }

  return report;
}

// ─── Get real-time metrics for the dashboard ─────────────────────────

export async function getSimulationMetrics(): Promise<{
  totalSimulations7d: number;
  totalSimulations30d: number;
  passRate7d: number;
  passRate30d: number;
  lastRunAt: string | null;
  topFailureCategories: Array<{ category: string; count: number }>;
  suiteBreakdown: Array<{ suite: string; passRate: number; total: number }>;
}> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  // Query AgentLog for simulation entries.
  const logs7d = await db.agentLog.findMany({
    where: {
      meta: { contains: '"type":"simulation"' },
      createdAt: { gte: sevenDaysAgo },
    },
    select: { meta: true, createdAt: true },
  });

  const logs30d = await db.agentLog.findMany({
    where: {
      meta: { contains: '"type":"simulation"' },
      createdAt: { gte: thirtyDaysAgo },
    },
    select: { meta: true, createdAt: true },
  });

  const parseSim = (meta: string | null) => {
    try {
      const parsed = JSON.parse(meta ?? "{}");
      return {
        passed: parsed.passed ?? false,
        type: parsed.scenarioType ?? "unknown",
      };
    } catch {
      return { passed: false, type: "unknown" };
    }
  };

  const sims7d = logs7d.map((l) => parseSim(l.meta));
  const sims30d = logs30d.map((l) => parseSim(l.meta));

  const passRate7d = sims7d.length > 0 ? (sims7d.filter((s) => s.passed).length / sims7d.length) * 100 : 0;
  const passRate30d = sims30d.length > 0 ? (sims30d.filter((s) => s.passed).length / sims30d.length) * 100 : 0;

  // Top failure categories.
  const failureCats: Record<string, number> = {};
  for (const s of sims7d.filter((s) => !s.passed)) {
    failureCats[s.type] = (failureCats[s.type] ?? 0) + 1;
  }
  const topFailureCategories = Object.entries(failureCats)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3)
    .map(([category, count]) => ({ category, count }));

  // Suite breakdown (from available suites).
  const suiteBreakdown = Object.keys(SIMULATION_SUITES).map((suite) => {
    const suiteSims = sims7d.filter((s) => s.type === suite || s.type.startsWith(suite.split("-")[0]));
    const passRate = suiteSims.length > 0 ? (suiteSims.filter((s) => s.passed).length / suiteSims.length) * 100 : 0;
    return { suite, passRate, total: suiteSims.length };
  });

  const lastRunAt = logs7d.length > 0 ? logs7d[0].createdAt.toISOString() : null;

  return {
    totalSimulations7d: sims7d.length,
    totalSimulations30d: sims30d.length,
    passRate7d,
    passRate30d,
    lastRunAt,
    topFailureCategories,
    suiteBreakdown,
  };
}
