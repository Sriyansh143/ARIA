import { NextRequest, NextResponse } from "next/server";
import {
  checkAgentHealth,
  monitorApp,
  startMonitor,
  getMonitorStatus,
  getMonitoringAgentNames,
} from "@/lib/monitor";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * GET /api/monitor
 *
 * Returns the current app health. Always starts the monitor loop if
 * it's not running (idempotent — calling startMonitor() multiple times
 * is safe).
 *
 * Query params:
 *   ?full=1   include per-agent health details (default: summary only)
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const includeDetails = url.searchParams.get("full") === "1";

  // Ensure the monitor loop is running.
  startMonitor();

  // Run a fresh health check now.
  try {
    const health = await monitorApp();
    const monitorState = getMonitorStatus();
    const monitoringAgents = getMonitoringAgentNames();

    const response: Record<string, unknown> = {
      status: health.status,
      healthy: health.healthy,
      degraded: health.degraded,
      failed: health.failed,
      totalAgents: health.totalAgents,
      autoFixed: health.autoFixed,
      dbConnected: health.dbConnected,
      sseAlive: health.sseAlive,
      cronAlive: health.cronAlive,
      apiErrorsRecent: health.apiErrorsRecent,
      issues: health.issues,
      checkedAt: health.checkedAt,
      monitor: monitorState,
      monitoringAgents,
    };

    if (includeDetails) {
      response.details = health.details;
    }

    return NextResponse.json(response);
  } catch (err) {
    logger.error("api.monitor.get.fail", { error: String(err) });
    return NextResponse.json(
      {
        status: "failed",
        error: "monitor check failed",
        detail: String(err),
        monitor: getMonitorStatus(),
      },
      { status: 500 },
    );
  }
}

/**
 * POST /api/monitor
 *
 * Triggers a manual full health check (same as GET ?full=1) + starts
 * the monitor loop if not running. Useful for the operator to force
 * a fresh check after a deploy or incident.
 *
 * Body:
 *   { startLoop?: boolean }   // default true
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { startLoop?: boolean };
  const shouldStartLoop = body.startLoop !== false;

  if (shouldStartLoop) {
    startMonitor();
  }

  try {
    const health = await monitorApp();
    logger.info("api.monitor.manual-check", {
      status: health.status,
      autoFixed: health.autoFixed,
    });
    return NextResponse.json({
      triggered: true,
      startedLoop: shouldStartLoop,
      ...health,
      monitor: getMonitorStatus(),
    });
  } catch (err) {
    logger.error("api.monitor.post.fail", { error: String(err) });
    return NextResponse.json(
      { error: "manual check failed", detail: String(err) },
      { status: 500 },
    );
  }
}

// Re-export checkAgentHealth for downstream consumers.
void checkAgentHealth;
