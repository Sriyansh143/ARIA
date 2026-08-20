import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import {
  INDUSTRY_PLAYBOOKS,
  getPlaybook,
  type IndustryPlaybook,
} from "@/lib/industry-playbooks";

export const dynamic = "force-dynamic";

/**
 * GET /api/industry-playbooks — list all 12 industry playbooks (metadata only).
 * Excludes the full operationalPlaybook text for compactness.
 */
export async function GET() {
  try {
    const playbooks = INDUSTRY_PLAYBOOKS.map((p) => ({
      id: p.id,
      name: p.name,
      icon: p.icon,
      revenueModels: p.revenueModels,
      keyMetrics: p.keyMetrics,
      riskFactors: p.riskFactors,
      complianceRequirements: p.complianceRequirements,
      agentFocus: p.agentFocus,
      operationalPlaybookPreview: p.operationalPlaybook.slice(0, 160),
    }));
    return NextResponse.json({ playbooks, count: playbooks.length });
  } catch (err) {
    logger.error("api.industry-playbooks.list.failed", { error: String(err) });
    return NextResponse.json(
      { error: "failed to list industry playbooks" },
      { status: 500 },
    );
  }
}

/**
 * POST /api/industry-playbooks — fetch a single full playbook by id.
 * Body: { id: string }
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as { id?: string };
    if (!body.id) {
      return NextResponse.json(
        { error: "id is required" },
        { status: 400 },
      );
    }
    const playbook: IndustryPlaybook | undefined = getPlaybook(body.id);
    if (!playbook) {
      return NextResponse.json(
        { error: `unknown playbook: ${body.id}` },
        { status: 404 },
      );
    }
    return NextResponse.json({ playbook });
  } catch (err) {
    logger.error("api.industry-playbooks.get.failed", { error: String(err) });
    return NextResponse.json(
      { error: "failed to get industry playbook" },
      { status: 500 },
    );
  }
}
