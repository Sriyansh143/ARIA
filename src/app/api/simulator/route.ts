import { NextRequest, NextResponse } from "next/server";
import {
  SCENARIOS,
  listSimulationRuns,
  runSimulation,
  type SimulationScenario,
} from "@/lib/simulator";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * GET /api/simulator
 *
 * Lists recent simulation runs (newest first). Does NOT load iteration
 * rows — use GET /api/simulator/[id] for full run details.
 *
 * Query params:
 *   ?limit=20    cap (max 100, default 20)
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const limit = Math.min(
    parseInt(url.searchParams.get("limit") ?? "20", 10) || 20,
    100,
  );

  const runs = await listSimulationRuns(limit);
  return NextResponse.json({
    runs,
    count: runs.length,
    scenarios: Object.values(SCENARIOS).map((s) => ({
      slug: s.slug,
      title: s.title,
      description: s.description,
    })),
  });
}

/**
 * POST /api/simulator
 *
 * Starts a new simulation run. Runs SYNCHRONOUSLY by default — for
 * long scenarios (100 iterations × real LLM) prefer `iterations <= 10`
 * OR set `async=true` to spawn a fire-and-forget run that updates the
 * DB incrementally (poll GET /api/simulator/[id] for progress).
 *
 * Body:
 *   {
 *     scenario:  SimulationScenario,  // required — slug from SCENARIOS
 *     iterations?: number,            // default 100 (cap 1000)
 *     inputs?:    Record<string, unknown>,  // overrides scenario defaults
 *     async?:     boolean             // default false (sync)
 *   }
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    scenario?: string;
    iterations?: number;
    inputs?: Record<string, unknown>;
    async?: boolean;
  };

  if (!body.scenario || !(body.scenario in SCENARIOS)) {
    return NextResponse.json(
      {
        error: "scenario is required and must be one of the known slugs",
        validSlugs: Object.keys(SCENARIOS),
      },
      { status: 400 },
    );
  }

  const scenario = body.scenario as SimulationScenario;
  const iterations = Math.max(
    1,
    Math.min(parseInt(String(body.iterations ?? "100"), 10) || 100, 1000),
  );
  const inputs = body.inputs && typeof body.inputs === "object" ? body.inputs : {};
  const isAsync = body.async === true;

  logger.info("api.simulator.start", { scenario, iterations, async: isAsync });

  if (isAsync) {
    // Fire-and-forget — return immediately with the run id once the row
    // is created. The caller polls /api/simulator/[id] for status.
    // We use a top-level promise (no await) so the response is sent first.
    void runSimulation(scenario, iterations, inputs)
      .then((result) => {
        logger.success("api.simulator.async.done", {
          runId: result.runId,
          bestScore: result.bestScore.toFixed(2),
        });
      })
      .catch((err) => {
        logger.error("api.simulator.async.fail", { scenario, error: String(err) });
      });

    return NextResponse.json(
      {
        status: "started",
        scenario,
        iterations,
        message: "Simulation running in background. Poll GET /api/simulator/[id] for status.",
        scenarios: Object.values(SCENARIOS).map((s) => ({ slug: s.slug, title: s.title })),
      },
      { status: 202 },
    );
  }

  // Synchronous run — return the full result.
  try {
    const result = await runSimulation(scenario, iterations, inputs);
    return NextResponse.json({ result }, { status: 201 });
  } catch (err) {
    logger.error("api.simulator.sync.fail", { scenario, error: String(err) });
    return NextResponse.json(
      { error: "Simulation failed", detail: String(err) },
      { status: 500 },
    );
  }
}
