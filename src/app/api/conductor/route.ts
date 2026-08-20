import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { conductorRespond } from "@/lib/llm-client";
import { processQuery } from "@/lib/smart-routing";
import { emit } from "@/lib/event-bus";
import { toIso, LOG_LEVELS } from "@/lib/types";
import { requireOwner } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * POST /api/conductor
 *
 * v47 fix 3: This route is NO LONGER public. It incurs real LLM costs via
 * processQuery() → conductorRespond() → routeLLM(). Now requires owner auth.
 * The proxy.ts PUBLIC_API_PREFIXES no longer includes /api/conductor.
 *
 * Sends a message to the Conductor AI assistant with smart routing.
 * The query is routed to the best-suited agent (keyword match → LLM
 * classification → Conductor fallback), then that agent responds.
 *
 * Body: { message: string }
 * Response: { response: string, latencyMs: number, routing: {...} }
 */
export async function POST(req: NextRequest) {
  // v47 fix 3: Require owner auth — this route incurs LLM costs.
  try {
    await requireOwner();
  } catch (authErr) {
    const msg = authErr instanceof Error ? authErr.message : "auth failed";
    const status = msg.includes("Unauthorized") ? 401 : 403;
    return NextResponse.json({ error: msg }, { status });
  }

  let body: { message?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const message = body.message?.trim();
  if (!message) {
    return NextResponse.json({ error: "message is required" }, { status: 400 });
  }

  // Gather live dashboard context.
  const [agents, tasks, revenueEvents, alerts] = await Promise.all([
    db.agent.findMany(),
    db.task.findMany({ where: { status: "running" } }),
    db.revenueEvent.findMany(),
    db.systemAlert.findMany({ where: { ack: false } }),
  ]);

  const activeAgents = agents.filter((a) => a.status !== "idle" && a.status !== "offline").length;
  const totalRevenue = revenueEvents.reduce((s, r) => s + r.amount, 0);
  const unackedAlerts = alerts.filter((a) => a.severity === "error" || a.severity === "critical").length;

  const startTime = Date.now();

  try {
    // Use smart routing to find the best agent + generate response.
    const result = await processQuery(message, {
      agentCount: agents.length,
      activeAgents,
      totalRevenue,
      unackedAlerts,
    });

    const latencyMs = Date.now() - startTime;

    // Emit a system log event about the routing.
    emit({
      type: "system",
      ts: toIso(new Date())!,
      message: `Query routed to ${result.routing.agent} (${result.routing.method}, ${result.routing.confidence * 100}% confidence) in ${latencyMs}ms`,
      level: "info" as (typeof LOG_LEVELS)[number],
    });

    return NextResponse.json({
      response: result.response,
      latencyMs,
      routing: result.routing,
      context: {
        agents: agents.length,
        activeAgents,
        runningTasks: tasks.length,
        totalRevenue,
        unackedAlerts,
      },
    });
  } catch (err) {
    const latencyMs = Date.now() - startTime;
    console.error("[api/conductor] failed:", err);
    return NextResponse.json(
      {
        error: "conductor failed to respond",
        latencyMs,
        fallback: `[Conductor error — ${err instanceof Error ? err.message.slice(0, 100) : "unknown error"}. The fleet is still operational.]`,
      },
      { status: 500 }
    );
  }
}
