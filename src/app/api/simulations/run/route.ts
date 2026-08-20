/**
 * POST /api/simulations/run — v63 Phase 13
 * Trigger a simulation suite manually (owner on-demand).
 * Body: { suite: "customer-purchase" | "owner-commands" | "edge-cases" | "tough-questions" | "all" }
 */
export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { runSimulationSuite, generateSimulationReport } from "@/lib/simulation-engine";
import { logger } from "@/lib/logger";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const suite = body.suite ?? "all";

    if (suite === "all") {
      const report = await generateSimulationReport();
      return NextResponse.json({ ok: true, report });
    }

    const result = await runSimulationSuite(suite);
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    logger.error("api.simulations.run.failed", { error: String(err) });
    return NextResponse.json({ error: "failed to run simulations" }, { status: 500 });
  }
}
