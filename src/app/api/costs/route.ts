import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { toIso, type LlmCall, type Agent } from "@/lib/types";
import {
  agentCostBreakdown,
  spendPerDay,
  projectedMonthlySpend,
  costTotals,
} from "@/lib/agent-costs";

export const dynamic = "force-dynamic";

/**
 * GET /api/costs
 *
 * Returns the per-agent cost rollup + per-day spend series + 30-day
 * projection. Reads `LlmCall` rows from the DB and feeds them through the
 * pure `agent-costs.ts` module — no math in this route, just plumbing.
 *
 * Query params:
 *   ?days=N   — number of days for the spend series (default 7, max 90)
 *
 * Response shape:
 *   {
 *     totals:   CostTotals,
 *     byAgent:  Record<agentId, AgentCostRow>,
 *     agents:   { id, name, role }[]      // for the UI to label byAgent
 *     series:   DailySpend[],             // per-day cost (oldest first)
 *     projectedMonthlySpend: number,
 *     days:     number,
 *     now:      string                    // ISO ts of the snapshot
 *   }
 */
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const daysParam = Number.parseInt(url.searchParams.get("days") ?? "7", 10);
  const days = Number.isFinite(daysParam) && daysParam > 0 && daysParam <= 90 ? daysParam : 7;

  try {
    // Pull LlmCall rows. Cap at 10k to avoid unbounded scans on a
    // long-running install — the rollup is O(n) so this is plenty.
    const [rows, agents] = await Promise.all([
      db.llmCall.findMany({
        orderBy: { createdAt: "desc" },
        take: 10_000,
      }),
      db.agent.findMany({ select: { id: true, name: true, role: true } }),
    ]);

    // Map DB rows to the LlmCall domain type.
    const calls: LlmCall[] = rows.map((r) => ({
      id: r.id,
      agentId: r.agentId,
      provider: r.provider as LlmCall["provider"],
      model: r.model,
      prompt: r.prompt,
      completion: r.completion,
      tokensIn: r.tokensIn,
      tokensOut: r.tokensOut,
      latencyMs: r.latencyMs,
      status: r.status as LlmCall["status"],
      fallback: r.fallback,
      error: r.error,
      createdAt: toIso(r.createdAt)!,
    }));

    const agentRoster: Pick<Agent, "id" | "name">[] = agents.map((a) => ({
      id: a.id,
      name: a.name,
    }));

    const now = new Date();
    const byAgent = agentCostBreakdown(calls);
    const series = spendPerDay(calls, days, now);
    const projected = projectedMonthlySpend(calls, now);
    const totals = costTotals(calls);

    return NextResponse.json({
      totals,
      byAgent,
      agents: agentRoster,
      series,
      projectedMonthlySpend: projected,
      days,
      now: now.toISOString(),
    });
  } catch (err) {
    console.error("[api/costs] failed:", err);
    return NextResponse.json(
      {
        error: "failed to compute cost breakdown",
        detail: err instanceof Error ? err.message : "unknown",
      },
      { status: 500 },
    );
  }
}
