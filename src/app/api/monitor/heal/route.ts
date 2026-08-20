import { NextRequest, NextResponse } from "next/server";
import { selfHeal } from "@/lib/monitor";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * POST /api/monitor/heal
 *
 * Triggers a manual self-heal attempt on a specific agent.
 *
 * Body:
 *   { agentId: string }   // required — the Agent.id to heal
 *
 * Returns:
 *   { healed: boolean, action: string, agentId: string }
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { agentId?: string };

  if (!body.agentId || typeof body.agentId !== "string") {
    return NextResponse.json(
      { error: "agentId is required" },
      { status: 400 },
    );
  }

  try {
    const result = await selfHeal(body.agentId);
    logger.info("api.monitor.heal", {
      agentId: result.agentId,
      healed: result.healed,
      action: result.action.slice(0, 120),
    });
    return NextResponse.json(result);
  } catch (err) {
    logger.error("api.monitor.heal.fail", {
      agentId: body.agentId,
      error: String(err),
    });
    return NextResponse.json(
      {
        healed: false,
        action: `heal failed: ${String(err).slice(0, 200)}`,
        agentId: body.agentId,
      },
      { status: 500 },
    );
  }
}
