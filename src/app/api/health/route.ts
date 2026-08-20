import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * GET /api/health — public liveness + readiness probe (v42 enhanced).
 *
 * v42: Now checks 3 subsystems:
 *   1. Database connectivity (db.agent.count())
 *   2. LLM router status (circuit breaker state)
 *   3. Email service status (Resend configured?)
 *
 * Returns 200 + {status:"ok"} when all healthy.
 * Returns 503 + {status:"degraded"} when DB is down.
 * Returns 200 + {status:"degraded", warnings:[...]} when non-critical subsystems are down.
 */

export async function GET() {
  let dbOk = false;
  let dbLatencyMs = 0;
  try {
    const t0 = Date.now();
    await db.agent.count();
    dbLatencyMs = Date.now() - t0;
    dbOk = true;
  } catch (err) {
    logger.error("health.db.unreachable", { error: String(err) });
    dbOk = false;
  }

  // Best-effort self-heal status
  let selfHeal: { started: boolean; bootstrapped: boolean; healCount: number; lastHealAt: number | null } | null = null;
  try {
    const { getSelfHealStatus } = await import("@/lib/self-heal");
    selfHeal = getSelfHealStatus();
  } catch {
    selfHeal = null;
  }

  // v42: LLM router status
  let llmRouter: { status: string; circuitBreakers: unknown[] } = { status: "unknown", circuitBreakers: [] };
  try {
    const { getRouterStatus } = await import("@/lib/llm-router");
    const status = getRouterStatus();
    const trippedBreakers = status.circuitBreakers.filter((b: any) => b.tripped);
    llmRouter = {
      status: trippedBreakers.length === 0 ? "ok" : "degraded",
      circuitBreakers: status.circuitBreakers,
    };
  } catch {
    llmRouter = { status: "unavailable", circuitBreakers: [] };
  }

  // v42: Email service status
  let emailService: { status: string; provider: string | null } = { status: "unconfigured", provider: null };
  try {
    const { isEmailConfigured } = await import("@/lib/email-service");
    const configured = isEmailConfigured();
    emailService = {
      status: configured ? "ok" : "unconfigured",
      provider: configured ? "resend" : null,
    };
  } catch {
    emailService = { status: "unavailable", provider: null };
  }

  // v42: Error tracking stats
  let errorStats: { total: number; unresolved: number; last24h: number } | null = null;
  try {
    const { getErrorStats } = await import("@/lib/error-tracking");
    errorStats = await getErrorStats();
  } catch {
    errorStats = null;
  }

  // DB failure = hard 503
  if (!dbOk) {
    return NextResponse.json(
      {
        status: "degraded",
        db: "disconnected",
        llmRouter,
        emailService,
        selfHeal,
        errorStats,
        ts: new Date().toISOString(),
      },
      { status: 503 }
    );
  }

  // Collect warnings for non-critical issues
  const warnings: string[] = [];
  if (llmRouter.status === "degraded") {
    const tripped = (llmRouter.circuitBreakers as any[]).filter((b) => b.tripped);
    warnings.push(`LLM circuit breaker tripped: ${tripped.map((b) => b.complexity).join(", ")}`);
  }
  if (emailService.status === "unconfigured") {
    warnings.push("Email service not configured (RESEND_API_KEY missing) — customer notifications will fall back to NotificationLog only");
  }
  if (errorStats && errorStats.unresolved > 10) {
    warnings.push(`${errorStats.unresolved} unresolved errors in ErrorLog`);
  }

  return NextResponse.json({
    status: warnings.length === 0 ? "ok" : "degraded",
    db: "connected",
    dbLatencyMs,
    llmRouter,
    emailService,
    selfHeal,
    errorStats,
    warnings,
    ts: new Date().toISOString(),
  });
}
