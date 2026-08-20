import { NextRequest, NextResponse } from "next/server";
import { getSimulationResults } from "@/lib/simulator";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * GET /api/simulator/[id]
 *
 * Returns a single SimulationRun + ALL its iterations.
 * Used by the simulator detail panel to display the iteration-by-iteration
 * breakdown + the best result inline.
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
    return NextResponse.json(data);
  } catch (err) {
    const msg = String(err);
    if (msg.includes("not found")) {
      return NextResponse.json({ error: "not found", id }, { status: 404 });
    }
    logger.error("api.simulator.get.fail", { id, error: msg });
    return NextResponse.json({ error: "failed", detail: msg }, { status: 500 });
  }
}

/**
 * DELETE /api/simulator/[id]
 *
 * Soft-deletes a simulation run + its iterations. Used by the simulator
 * dashboard to clean up failed or stale runs.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  try {
    // Cascade delete iterations + the run row.
    await db.simulationIteration.deleteMany({ where: { simulationRunId: id } });
    await db.simulationRun.delete({ where: { id } });
    logger.info("api.simulator.delete", { id });
    return NextResponse.json({ deleted: true, id });
  } catch (err) {
    const msg = String(err);
    if (msg.includes("not found") || msg.includes("does not exist")) {
      return NextResponse.json({ error: "not found", id }, { status: 404 });
    }
    logger.error("api.simulator.delete.fail", { id, error: msg });
    return NextResponse.json({ error: "failed", detail: msg }, { status: 500 });
  }
}
