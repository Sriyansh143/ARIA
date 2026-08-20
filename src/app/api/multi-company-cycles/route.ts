import { NextRequest, NextResponse } from "next/server";
import {
  runMultiCompanyCycle,
  getMultiCompanyStatus,
} from "@/lib/multi-company-cycles";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * GET /api/multi-company-cycles
 *
 * Returns a per-company summary of autonomous cycle activity from the
 * last 24 hours: company name, industry, last cycle timestamp, opps
 * found, deals created, revenue generated. All derived from real DB
 * rows (EarningOpportunity/Deal/RevenueEvent tagged with the industry
 * playbook id via the `source` field).
 */
export async function GET() {
  try {
    const status = await getMultiCompanyStatus();
    return NextResponse.json(status);
  } catch (err) {
    logger.error("api.multi-company-cycles.get.error", {
      error: String(err),
    });
    return NextResponse.json(
      { error: "failed to load multi-company status", detail: String(err) },
      { status: 500 },
    );
  }
}

/**
 * POST /api/multi-company-cycles
 *
 * Body: { force?: boolean }
 *
 * Runs `runMultiCompanyCycle()` — kicks off the autonomous 8-stage
 * lifecycle for EVERY active company in parallel. Each company's cycle
 * is independently try/caught so one failure doesn't abort others.
 *
 * ⚠️ LONG-RUNNING: 30-60s per company × N companies. May timeout in
 * environments with strict API timeouts. The response includes a `note`
 * field documenting this; in production, invoke from a background job.
 *
 * The `force` flag is accepted for forward-compat (currently a no-op —
 * cycles always run when POSTed) but reserved for future rate-limit
 * bypass use cases.
 */
export async function POST(req: NextRequest) {
  let body: { force?: boolean } = {};
  try {
    body = await req.json();
  } catch {
    // Body is optional — default to { force: false }.
    body = { force: false };
  }

  try {
    const result = await runMultiCompanyCycle();
    return NextResponse.json({
      ok: true,
      force: Boolean(body.force),
      ...result,
    });
  } catch (err) {
    logger.error("api.multi-company-cycles.post.error", {
      error: String(err),
    });
    return NextResponse.json(
      {
        ok: false,
        error: "multi-company cycle failed",
        detail: String(err),
      },
      { status: 500 },
    );
  }
}
