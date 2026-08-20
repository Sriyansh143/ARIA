import { NextRequest, NextResponse } from "next/server";
import { getSimulationResults } from "@/lib/simulator";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * GET /api/simulator/[id]/result
 *
 * Returns ONLY the best iteration result for a simulation run.
 * Use this endpoint for one-glance "what was the winning strategy"
 * lookups without pulling the full iteration list.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  try {
    const data = await getSimulationResults(id);

    // The run.bestResult field may be null if no iteration completed.
    // As a fallback, query the highest-scoring SimulationIteration row.
    let bestResult = data.bestResult;
    if (!bestResult) {
      const topIter = await db.simulationIteration.findFirst({
        where: { simulationRunId: id },
        orderBy: { score: "desc" },
      });
      if (topIter) {
        bestResult = {
          iteration: topIter.iteration,
          score: topIter.score,
          outcome: topIter.outcome,
          analysis: topIter.analysis,
          improvements: topIter.improvements ?? "",
        };
      }
    }

    return NextResponse.json({
      runId: data.run.id,
      scenario: data.run.scenario,
      title: data.run.title,
      status: data.run.status,
      completedIterations: data.run.completedIters,
      totalIterations: data.run.iterations,
      bestScore: data.run.bestScore,
      worstScore: data.run.worstScore,
      bestResult,
    });
  } catch (err) {
    const msg = String(err);
    if (msg.includes("not found")) {
      return NextResponse.json({ error: "not found", id }, { status: 404 });
    }
    logger.error("api.simulator.result.fail", { id, error: msg });
    return NextResponse.json({ error: "failed", detail: msg }, { status: 500 });
  }
}
