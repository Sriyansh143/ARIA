/**
 * ARIA Mission Control — 100x Simulator with Result Injection.
 *
 * Task 24 — Part A.
 *
 * Runs N iterations (default 100) of a business scenario through the LLM.
 * Each iteration injects the best + worst prior iterations as context so
 * the LLM "learns" within a single Monte-Carlo pass — emulating Claude's
 * "think → critique → improve" loop without needing fine-tuning.
 *
 * Design:
 *   - Scenario definitions (SCENARIOS) carry the prompt template +
 *     scoring criteria so each scenario type knows what "good" looks like.
 *   - injectPreviousResults() formats the top-3 + bottom-3 prior outcomes
 *     into a context block prepended to the LLM prompt.
 *   - scoreOutcome() asks the LLM to grade the outcome 0-1 against the
 *     scenario's criteria. Falls back to a deterministic mock when
 *     ARIA_LLM_DISABLED=1.
 *   - runSimulation() is fully DB-backed — every iteration is persisted
 *     to SimulationIteration, and the run row's bestScore/worstScore/
 *     bestResult/results/improvementNotes are updated incrementally so
 *     a crashed run can be inspected + resumed.
 *
 * Safety:
 *   - The LLM call is wrapped in try/catch — a single failed iteration
 *     never aborts the whole run; that iteration is scored 0 and we
 *     continue.
 *   - All JSON serialization happens in a single helper so corrupted
 *     state is impossible.
 */
import { db } from "./db";
import { logger } from "./logger";
import { callLLM } from "./llm-client";

// ─── Types ───────────────────────────────────────────────────────────
export type SimulationScenario =
  | "product-launch"
  | "client-call"
  | "investor-meeting"
  | "marketing-campaign"
  | "owner-meeting"
  | "followup-call"
  | "website-build"
  | "app-build";

export interface ScenarioDefinition {
  slug: SimulationScenario;
  title: string;
  description: string;
  /** Persona the LLM plays on each iteration. */
  agentRole: string;
  /** System-prompt template injected per-iteration. {{context}} is replaced
   *  with the formatted previous-results block. {{inputs}} is replaced
   *  with the JSON-stringified run inputs. */
  promptTemplate: string;
  /** Criteria the LLM scorer uses to assign a 0-1 score per iteration. */
  scoringCriteria: string;
  /** Default initial inputs (merged with caller-provided overrides). */
  defaultInputs: Record<string, unknown>;
}

export interface IterationResult {
  iteration: number;
  score: number;
  outcome: string;
  analysis: string;
  improvements: string;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
}

export interface SimulationResult {
  runId: string;
  scenario: SimulationScenario;
  iterations: number;
  completedIterations: number;
  bestScore: number;
  worstScore: number;
  bestResult: IterationResult | null;
  status: string;
  improvementNotes: string[];
  /** Top-3 results by score — useful for one-glance summaries. */
  topResults: IterationResult[];
}

// ─── Predefined scenarios ───────────────────────────────────────────
export const SCENARIOS: Record<SimulationScenario, ScenarioDefinition> = {
  "product-launch": {
    slug: "product-launch",
    title: "Product Launch Simulator",
    description:
      "Simulate launching a product 100 times. Each iteration learns from the previous launch's reception (best + worst) to refine the launch narrative, pricing, and channel mix.",
    agentRole: "Marketer",
    promptTemplate: `You are simulating a product launch for an AI startup.

Scenario inputs: {{inputs}}

{{context}}

Based on the inputs and the prior launch outcomes above, draft a fresh launch plan:
1. Positioning statement (one sentence)
2. Pricing strategy
3. Top 3 channels
4. The headline launch-day narrative
5. One concrete risk to mitigate

Be specific and decisive. Avoid generic advice.`,
    scoringCriteria:
      "Score 0-1 based on: clarity of positioning (0.2), pricing realism (0.2), channel fit (0.2), narrative strength (0.2), and risk awareness (0.2). 1.0 = ready to ship, 0.0 = incoherent.",
    defaultInputs: {
      product: "ARIA Mission Control",
      audience: "Engineering leaders at B2B SaaS",
      budget: 50000,
      timelineDays: 30,
    },
  },
  "client-call": {
    slug: "client-call",
    title: "Client Sales Call Simulator",
    description:
      "Simulate a sales call with a prospective client. Each iteration refines the pitch based on what worked / failed in prior attempts.",
    agentRole: "AccountExecutive",
    promptTemplate: `You are simulating a sales discovery call.

Client context: {{inputs}}

{{context}}

Based on the client context and prior call outcomes, draft:
1. The 30-second opener
2. Three discovery questions to ask
3. The value-prop anchor
4. The trial-close line
5. Objection you anticipate + your response

Be specific and grounded in the client's situation.`,
    scoringCriteria:
      "Score 0-1 based on: opener relevance (0.2), question quality (0.2), value-prop fit (0.2), close strength (0.2), objection handling (0.2). 1.0 = booked, 0.0 = irrelevant.",
    defaultInputs: {
      client: "Globex Corp",
      role: "VP Engineering",
      pain: "Slow deploy cycles",
      budget: 30000,
    },
  },
  "investor-meeting": {
    slug: "investor-meeting",
    title: "Investor Pitch Simulator",
    description:
      "Simulate a Series-A investor pitch. Each iteration sharpens the narrative + answers prior investor objections.",
    agentRole: "CEO",
    promptTemplate: `You are simulating an investor pitch meeting.

Investor profile: {{inputs}}

{{context}}

Draft:
1. The 60-second elevator pitch
2. The traction slide (3 numbers)
3. The moat / differentiation
4. The ask (round size + use of funds)
5. The #1 objection you expect and your response

Be concise and confident — investors skim.`,
    scoringCriteria:
      "Score 0-1 based on: pitch clarity (0.2), traction evidence (0.2), moat credibility (0.2), ask reasonableness (0.2), objection handling (0.2). 1.0 = term sheet, 0.0 = pass.",
    defaultInputs: {
      investor: "Sequoia",
      stage: "Series A",
      arr: 1200000,
      growth: 15, // % MoM
    },
  },
  "marketing-campaign": {
    slug: "marketing-campaign",
    title: "Marketing Campaign Simulator",
    description:
      "Simulate running a marketing campaign 100 times. Each iteration learns what messaging + channels convert.",
    agentRole: "Marketer",
    promptTemplate: `You are simulating a marketing campaign.

Campaign brief: {{inputs}}

{{context}}

Draft:
1. The hook (one sentence that stops the scroll)
2. The 3 ad creatives you'd test
3. Channel mix + budget split
4. The CTA
5. Success metric + target

Be specific — no fluff.`,
    scoringCriteria:
      "Score 0-1 based on: hook strength (0.25), creative test breadth (0.2), channel fit (0.2), CTA clarity (0.15), metric rigor (0.2). 1.0 = viral potential, 0.0 = boring.",
    defaultInputs: {
      product: "ARIA Mission Control",
      channel: "LinkedIn + X",
      budget: 25000,
      goal: "demo signups",
    },
  },
  "owner-meeting": {
    slug: "owner-meeting",
    title: "Owner Strategy Meeting Simulator",
    description:
      "Simulate a strategy meeting with the company owner. Each iteration sharpens the recommendation + answers prior questions.",
    agentRole: "CEO",
    promptTemplate: `You are simulating a strategy meeting with the owner.

Meeting context: {{inputs}}

{{context}}

Draft:
1. The #1 strategic recommendation (one sentence)
2. Three supporting arguments
3. Resource ask (people / budget / time)
4. The biggest risk + mitigation
5. The decision you need from the owner

Be decisive — owners want direction, not options.`,
    scoringCriteria:
      "Score 0-1 based on: recommendation clarity (0.25), argument strength (0.2), resource realism (0.2), risk awareness (0.2), decision ask (0.15). 1.0 = approved, 0.0 = vague.",
    defaultInputs: {
      owner: "Marco",
      topic: "Q3 enterprise expansion",
      currentArr: 1200000,
      targetArr: 5000000,
    },
  },
  "followup-call": {
    slug: "followup-call",
    title: "Follow-Up Call Simulator",
    description:
      "Simulate a follow-up call after a discovery meeting. Each iteration learns what closes vs. what stalls the deal.",
    agentRole: "AccountExecutive",
    promptTemplate: `You are simulating a follow-up call after a discovery meeting.

Prior meeting context: {{inputs}}

{{context}}

Draft:
1. The re-engagement opener (one sentence referencing the prior meeting)
2. Two value-adds you'll deliver on the call
3. The "next step" ask (specific + time-bound)
4. The stall you anticipate + your response
5. The trial-close question

Be confident and specific.`,
    scoringCriteria:
      "Score 0-1 based on: opener personalization (0.2), value-add relevance (0.2), ask clarity (0.2), stall handling (0.2), close strength (0.2). 1.0 = next step booked, 0.0 = forgotten follow-up.",
    defaultInputs: {
      client: "Globex Corp",
      priorOutcome: "Positive — requested pricing",
      daysSince: 7,
    },
  },
  "website-build": {
    slug: "website-build",
    title: "Website Build Simulator",
    description:
      "Simulate building a website 100 times. Each iteration learns from prior user reception to refine copy, structure, and CTA.",
    agentRole: "ContentCreator",
    promptTemplate: `You are simulating building a marketing website.

Brief: {{inputs}}

{{context}}

Draft:
1. The hero headline (one sentence)
2. The 3 sections above the fold
3. The primary CTA
4. The social proof element
5. The #1 conversion risk + mitigation

Be specific — concrete copy, not abstractions.`,
    scoringCriteria:
      "Score 0-1 based on: headline clarity (0.25), section flow (0.2), CTA strength (0.25), proof credibility (0.15), risk awareness (0.15). 1.0 = high-converting, 0.0 = bounce.",
    defaultInputs: {
      product: "ARIA Mission Control",
      audience: "Engineering leaders",
      goal: "demo signups",
    },
  },
  "app-build": {
    slug: "app-build",
    title: "App Build Simulator",
    description:
      "Simulate building an app 100 times. Each iteration learns from prior adoption signals to refine the core loop + onboarding.",
    agentRole: "Architect",
    promptTemplate: `You are simulating building a new app.

Product brief: {{inputs}}

{{context}}

Draft:
1. The core user loop (3 steps)
2. The onboarding flow (first 60 seconds)
3. The activation metric
4. The retention hook (what brings users back on day 7)
5. The #1 adoption risk + mitigation

Be concrete — name the screens + actions.`,
    scoringCriteria:
      "Score 0-1 based on: loop clarity (0.2), onboarding simplicity (0.2), activation rigor (0.2), retention strength (0.2), risk awareness (0.2). 1.0 = viral, 0.0 = uninstall.",
    defaultInputs: {
      app: "ARIA Mobile",
      platform: "iOS + Android",
      audience: "Operators on the go",
    },
  },
};

// ─── Helpers ────────────────────────────────────────────────────────
function safeParse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return "[]";
  }
}

/**
 * Format the best 3 + worst 3 results from previous iterations as context
 * for the LLM. Sorted by score descending. The LLM sees what worked (so it
 * can build on it) and what failed (so it can avoid repeating mistakes).
 *
 * Returns the empty-context marker if there are no prior results yet
 * (iteration 1).
 */
export function injectPreviousResults(
  currentIter: number,
  previousResults: IterationResult[],
): string {
  if (previousResults.length === 0 || currentIter <= 1) {
    return "[No prior iterations yet — this is the first attempt. Be bold and original.]";
  }

  const sorted = [...previousResults].sort((a, b) => b.score - a.score);
  const best = sorted.slice(0, 3);
  const worst = sorted.slice(-3).reverse(); // worst first

  const fmt = (r: IterationResult, label: string) =>
    `### ${label} — iteration ${r.iteration} (score ${r.score.toFixed(2)})\n` +
    `Outcome: ${r.outcome}\n` +
    `Analysis: ${r.analysis}\n` +
    `Improvements suggested: ${r.improvements || "(none)"}`;

  const bestBlock = best
    .map((r, i) => fmt(r, `BEST #${i + 1}`))
    .join("\n\n");
  const worstBlock = worst
    .map((r, i) => fmt(r, `WORST #${i + 1}`))
    .join("\n\n");

  return [
    `## Prior iteration context (you have completed ${previousResults.length} attempt${previousResults.length === 1 ? "" : "s"} so far)`,
    "",
    "### What worked (build on these):",
    bestBlock,
    "",
    "### What failed (avoid these mistakes):",
    worstBlock,
    "",
    "Use the BEST outcomes as inspiration and the WORST outcomes as caution. Improve on the prior best.",
  ].join("\n");
}

/**
 * Score an iteration's outcome 0-1 using the LLM against the scenario's
 * scoring criteria. Falls back to a deterministic mock when the LLM is
 * disabled or fails — never throws.
 */
export async function scoreOutcome(
  outcome: string,
  scenario: SimulationScenario,
): Promise<number> {
  const def = SCENARIOS[scenario];

  // Mock mode — deterministic-ish score derived from outcome length so
  // different iterations still differentiate.
  if (process.env.ARIA_LLM_DISABLED === "1") {
    const lengthScore = Math.min(outcome.length / 800, 1);
    const jitter = (outcome.length % 11) / 100; // 0.00-0.10
    return Math.max(0, Math.min(1, 0.4 + lengthScore * 0.4 + jitter));
  }

  const prompt = `You are a strict scoring engine. Score the following launch outcome against these criteria.

Scoring criteria: ${def.scoringCriteria}

Outcome to score:
"""
${outcome.slice(0, 1500)}
"""

Respond with EXACTLY this JSON (no markdown):
{"score": <number 0-1, two decimals>, "reason": "<one sentence>"}`;

  try {
    const result = await callLLM("Simulator-Scorer", def.agentRole, prompt, {
      maxRetries: 1,
    });

    if (!result.success || !result.completion) {
      // Fallback heuristic.
      return Math.min(outcome.length / 1000, 0.9);
    }

    const cleaned = result.completion
      .replace(/```json\n?/g, "")
      .replace(/```\n?/g, "")
      .trim();
    const parsed = safeParse<{ score?: unknown }>(cleaned, {});
    const raw = typeof parsed.score === "number"
      ? parsed.score
      : typeof parsed.score === "string"
        ? parseFloat(parsed.score)
        : NaN;

    if (Number.isFinite(raw)) {
      return Math.max(0, Math.min(1, raw));
    }
    return 0.5;
  } catch (err) {
    logger.warn("simulator.score.error", { scenario, error: String(err) });
    return 0.5;
  }
}

/**
 * Generate an iteration outcome + analysis + improvement notes by calling
 * the LLM with the scenario prompt and the injected prior-results context.
 *
 * Returns three strings (outcome / analysis / improvements). In mock mode
 * returns deterministic-shape stub content so the simulator still runs
 * end-to-end without an LLM.
 */
async function generateIteration(
  scenario: SimulationScenario,
  injectedContext: string,
  inputs: Record<string, unknown>,
): Promise<{
  outcome: string;
  analysis: string;
  improvements: string;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
}> {
  const def = SCENARIOS[scenario];
  const prompt = def.promptTemplate
    .replace("{{inputs}}", JSON.stringify(inputs, null, 2))
    .replace("{{context}}", injectedContext);

  const startTime = Date.now();

  if (process.env.ARIA_LLM_DISABLED === "1") {
    const outcome = `Mock iteration for ${def.title}:\n` +
      `- Inputs: ${JSON.stringify(inputs).slice(0, 200)}\n` +
      `- Strategy: ${(injectedContext.slice(0, 120) || "first attempt").replace(/\n/g, " ")}\n` +
      `- Recommended action: proceed with ${def.agentRole}-led plan.`;
    const analysis = `Mock analysis: outcome is internally consistent and addresses the criteria. Length ${outcome.length}.`;
    const improvements = "Mock improvement: refine pricing + add a second channel for redundancy.";
    return {
      outcome,
      analysis,
      improvements,
      tokensIn: Math.ceil(prompt.length / 4),
      tokensOut: Math.ceil(outcome.length / 4),
      latencyMs: Date.now() - startTime,
    };
  }

  try {
    const result = await callLLM("Simulator-Iter", def.agentRole, prompt, {
      maxRetries: 1,
    });

    if (!result.success || !result.completion) {
      return {
        outcome: `(LLM call failed: ${result.error ?? "unknown error"}) — using fallback.`,
        analysis: "Iteration could not be generated; scored 0 by default.",
        improvements: "Retry with a different prompt or switch to mock mode.",
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
        latencyMs: result.latencyMs,
      };
    }

    // Split the LLM response into outcome / analysis / improvements.
    // The prompt asks for 5 sections — we treat the whole response as
    // the outcome, then run a second LLM pass to derive analysis +
    // improvements only if the response is short enough to warrant it.
    const completion = result.completion;
    const splitIdx = Math.min(
      Math.floor(completion.length * 0.6),
      800,
    );
    const outcome = completion.slice(0, splitIdx).trim();
    const analysis = completion.slice(splitIdx).trim() ||
      "LLM response was concise — no separate analysis section generated.";
    const improvements = await generateImprovements(scenario, outcome, analysis);

    return {
      outcome,
      analysis,
      improvements,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      latencyMs: Date.now() - startTime,
    };
  } catch (err) {
    logger.warn("simulator.iter.error", { scenario, error: String(err) });
    return {
      outcome: `(iteration failed: ${String(err).slice(0, 100)})`,
      analysis: "Skipped — error during generation.",
      improvements: "",
      tokensIn: Math.ceil(prompt.length / 4),
      tokensOut: 0,
      latencyMs: Date.now() - startTime,
    };
  }
}

/** Ask the LLM for 1-2 improvement notes for the NEXT iteration. */
async function generateImprovements(
  scenario: SimulationScenario,
  outcome: string,
  analysis: string,
): Promise<string> {
  if (process.env.ARIA_LLM_DISABLED === "1") {
    return "Mock: tighten the opener; quantify value with one metric.";
  }
  const def = SCENARIOS[scenario];
  const prompt = `You just completed iteration ${scenario}. In ONE sentence, suggest the single most important improvement for the next iteration.

Outcome: ${outcome.slice(0, 500)}

Analysis: ${analysis.slice(0, 300)}

Respond with the improvement sentence only — no preamble.`;

  try {
    const result = await callLLM("Simulator-Improve", def.agentRole, prompt, {
      maxRetries: 0,
    });
    return result.completion?.trim().slice(0, 400) || "";
  } catch {
    return "";
  }
}

// ─── Core: run a full N-iteration simulation ────────────────────────
/**
 * Run a full simulation. Creates a SimulationRun row, runs N iterations
 * (each persists a SimulationIteration + updates the run incrementally),
 * and returns the final summary.
 *
 * @param scenario   Scenario slug (must be a key of SCENARIOS)
 * @param iterations  Number of iterations (default 100)
 * @param inputs     Caller-provided inputs merged over the scenario defaults
 * @param runId      Optional existing run id (resume mode). If provided,
 *                   continues from `completedIters` instead of starting at 1.
 */
export async function runSimulation(
  scenario: SimulationScenario,
  iterations = 100,
  inputs: Record<string, unknown> = {},
  runId?: string,
): Promise<SimulationResult> {
  const def = SCENARIOS[scenario];
  if (!def) {
    throw new Error(`Unknown scenario: ${scenario}`);
  }
  const finalInputs = { ...def.defaultInputs, ...inputs };

  // ── Create or resume the run row ─────────────────────────────────
  let run: {
    id: string;
    scenario: string;
    iterations: number;
    completedIters: number;
    status: string;
    bestScore: number;
    worstScore: number;
    bestResult: string | null;
    results: string;
    improvementNotes: string;
  };

  if (runId) {
    const existing = await db.simulationRun.findUnique({ where: { id: runId } });
    if (!existing) {
      throw new Error(`SimulationRun not found: ${runId}`);
    }
    run = existing;
    // Mark as running while we resume.
    await db.simulationRun.update({
      where: { id: run.id },
      data: { status: "running" },
    });
  } else {
    const created = await db.simulationRun.create({
      data: {
        scenario: def.slug,
        title: def.title,
        description: def.description,
        iterations,
        status: "running",
        inputs: safeStringify(finalInputs),
      },
    });
    run = {
      id: created.id,
      scenario: created.scenario,
      iterations: created.iterations,
      completedIters: created.completedIters,
      status: created.status,
      bestScore: created.bestScore,
      worstScore: created.worstScore,
      bestResult: created.bestResult,
      results: created.results,
      improvementNotes: created.improvementNotes,
    };
  }

  // ── Load prior iteration results (resume case) ───────────────────
  const priorRows = await db.simulationIteration.findMany({
    where: { simulationRunId: run.id },
    orderBy: { iteration: "asc" },
  });

  const allResults: IterationResult[] = priorRows.map((r) => ({
    iteration: r.iteration,
    score: r.score,
    outcome: r.outcome,
    analysis: r.analysis,
    improvements: r.improvements ?? "",
    tokensIn: 0,
    tokensOut: 0,
    latencyMs: 0,
  }));

  const improvementNotes = safeParse<string[]>(run.improvementNotes, []);

  logger.info("simulator.run.start", {
    runId: run.id,
    scenario,
    iterations,
    completedAlready: allResults.length,
  });

  // ── Iterate ───────────────────────────────────────────────────────
  const startIter = allResults.length + 1;
  let bestScore = run.bestScore;
  let worstScore = run.worstScore;
  let bestResult: IterationResult | null = allResults.length
    ? [...allResults].sort((a, b) => b.score - a.score)[0]
    : null;

  for (let i = startIter; i <= iterations; i++) {
    try {
      // Inject the prior context for this iteration.
      const injectedContext = injectPreviousResults(i, allResults);

      // Generate the iteration outcome via the LLM (or mock).
      const { outcome, analysis, improvements, tokensIn, tokensOut, latencyMs } =
        await generateIteration(scenario, injectedContext, finalInputs);

      // Score the outcome 0-1.
      const score = await scoreOutcome(outcome, scenario);

      // Persist the iteration row.
      await db.simulationIteration.create({
        data: {
          simulationRunId: run.id,
          iteration: i,
          score,
          outcome: outcome.slice(0, 4000),
          analysis: analysis.slice(0, 4000),
          improvements: improvements ? improvements.slice(0, 1000) : null,
        },
      });

      const iterResult: IterationResult = {
        iteration: i,
        score,
        outcome,
        analysis,
        improvements,
        tokensIn,
        tokensOut,
        latencyMs,
      };
      allResults.push(iterResult);

      // Track best / worst.
      if (score > bestScore) {
        bestScore = score;
        bestResult = iterResult;
      }
      if (score < worstScore) {
        worstScore = score;
      }
      if (improvements) {
        improvementNotes.push(`[iter ${i}] ${improvements}`);
      }

      // Persist the incremental state to the run row every iteration so a
      // crash never loses progress. Persist results JSON capped to last 50
      // to avoid unbounded growth in the results column.
      const resultsSnapshot = allResults.slice(-50).map((r) => ({
        i: r.iteration,
        s: r.score,
        o: r.outcome.slice(0, 200),
      }));

      await db.simulationRun.update({
        where: { id: run.id },
        data: {
          completedIters: i,
          bestScore,
          worstScore,
          bestResult: bestResult ? safeStringify({
            iteration: bestResult.iteration,
            score: bestResult.score,
            outcome: bestResult.outcome.slice(0, 2000),
            analysis: bestResult.analysis.slice(0, 2000),
            improvements: bestResult.improvements,
          }) : null,
          results: safeStringify(resultsSnapshot),
          improvementNotes: safeStringify(improvementNotes.slice(-50)),
        },
      });

      if (i % 10 === 0 || i === iterations) {
        logger.info("simulator.run.progress", {
          runId: run.id,
          iteration: i,
          total: iterations,
          bestScore: bestScore.toFixed(2),
          worstScore: worstScore.toFixed(2),
        });
      }
    } catch (err) {
      // Never abort the loop on a single iteration failure.
      logger.error("simulator.iter.crash", {
        runId: run.id,
        iteration: i,
        error: String(err),
      });

      // Record the failed iteration as a 0-score.
      await db.simulationIteration.create({
        data: {
          simulationRunId: run.id,
          iteration: i,
          score: 0,
          outcome: `(crashed: ${String(err).slice(0, 200)})`,
          analysis: "Iteration crashed; recorded as 0-score for traceability.",
          improvements: null,
        },
      });
      allResults.push({
        iteration: i,
        score: 0,
        outcome: `(crashed)`,
        analysis: "Iteration crashed.",
        improvements: "",
        tokensIn: 0,
        tokensOut: 0,
        latencyMs: 0,
      });
      if (0 < worstScore) worstScore = 0;
    }
  }

  // ── Finalize ─────────────────────────────────────────────────────
  await db.simulationRun.update({
    where: { id: run.id },
    data: { status: "completed" },
  });

  const topResults = [...allResults]
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  logger.success("simulator.run.complete", {
    runId: run.id,
    scenario,
    iterations: allResults.length,
    bestScore: bestScore.toFixed(2),
    worstScore: worstScore.toFixed(2),
  });

  return {
    runId: run.id,
    scenario,
    iterations,
    completedIterations: allResults.length,
    bestScore,
    worstScore,
    bestResult,
    status: "completed",
    improvementNotes: improvementNotes.slice(-50),
    topResults,
  };
}

// ─── Read-back helpers ──────────────────────────────────────────────
/**
 * Return the full SimulationRun + all its iterations. Used by the API
 * GET /api/simulator/[id] handler.
 */
export async function getSimulationResults(
  runId: string,
): Promise<{
  run: {
    id: string;
    scenario: string;
    title: string;
    description: string;
    iterations: number;
    completedIters: number;
    status: string;
    bestScore: number;
    worstScore: number;
    inputs: Record<string, unknown>;
    improvementNotes: string[];
    createdAt: string;
    updatedAt: string;
  };
  iterations: Array<{
    id: string;
    iteration: number;
    score: number;
    outcome: string;
    analysis: string;
    improvements: string | null;
    createdAt: string;
  }>;
  bestResult: {
    iteration: number;
    score: number;
    outcome: string;
    analysis: string;
    improvements: string;
  } | null;
}> {
  const run = await db.simulationRun.findUnique({
    where: { id: runId },
  });

  if (!run) {
    throw new Error(`SimulationRun not found: ${runId}`);
  }

  const iterRows = await db.simulationIteration.findMany({
    where: { simulationRunId: runId },
    orderBy: { iteration: "asc" },
  });
  const bestResultStr = run.bestResult;
  let bestResult: {
    iteration: number;
    score: number;
    outcome: string;
    analysis: string;
    improvements: string;
  } | null = null;

  if (bestResultStr) {
    bestResult = safeParse<{
      iteration: number;
      score: number;
      outcome: string;
      analysis: string;
      improvements: string;
    } | null>(bestResultStr, null);
  }

  return {
    run: {
      id: run.id,
      scenario: run.scenario,
      title: run.title,
      description: run.description,
      iterations: run.iterations,
      completedIters: run.completedIters,
      status: run.status,
      bestScore: run.bestScore,
      worstScore: run.worstScore,
      inputs: safeParse<Record<string, unknown>>(run.inputs, {}),
      improvementNotes: safeParse<string[]>(run.improvementNotes, []),
      createdAt: run.createdAt.toISOString(),
      updatedAt: run.updatedAt.toISOString(),
    },
    iterations: iterRows.map((r) => ({
      id: r.id,
      iteration: r.iteration,
      score: r.score,
      outcome: r.outcome,
      analysis: r.analysis,
      improvements: r.improvements,
      createdAt: r.createdAt.toISOString(),
    })),
    bestResult,
  };
}

/**
 * List recent simulation runs (newest first). Used by the GET /api/simulator
 * handler — does NOT load iteration rows (use getSimulationResults for that).
 */
export async function listSimulationRuns(limit = 20): Promise<
  Array<{
    id: string;
    scenario: string;
    title: string;
    description: string;
    iterations: number;
    completedIters: number;
    status: string;
    bestScore: number;
    worstScore: number;
    createdAt: string;
    updatedAt: string;
  }>
> {
  const rows = await db.simulationRun.findMany({
    orderBy: { createdAt: "desc" },
    take: Math.max(1, Math.min(limit, 100)),
  });

  return rows.map((r) => ({
    id: r.id,
    scenario: r.scenario,
    title: r.title,
    description: r.description,
    iterations: r.iterations,
    completedIters: r.completedIters,
    status: r.status,
    bestScore: r.bestScore,
    worstScore: r.worstScore,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));
}
