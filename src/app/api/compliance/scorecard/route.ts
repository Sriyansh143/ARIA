/**
 * GET /api/compliance/scorecard — v74 Phase 24 (RULE-76)
 *
 * Returns the live Constitution compliance scorecard.
 * Triggers a fresh audit on each request (or returns the most recent cached
 * one if the query param ?cached=1 is provided).
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuthOrResponse } from "@/lib/auth";
import { auditCompliance } from "@/lib/compliance-auditor";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requireAuthOrResponse("GET", "/api/compliance/scorecard");
  if (auth instanceof NextResponse) return auth;

  try {
    const cached = req.nextUrl.searchParams.get("cached") === "1";
    if (cached) {
      // Return the most recent ComplianceFinding rows grouped by ruleId.
      const recent = await db.complianceFinding.findMany({
        orderBy: { checkedAt: "desc" },
        take: 100,
      });
      // Group by ruleId (keep the most recent for each).
      const byRule = new Map<string, typeof recent[0]>();
      for (const f of recent) {
        if (!byRule.has(f.ruleId)) byRule.set(f.ruleId, f);
      }
      const findings = [...byRule.values()];
      const passed = findings.filter((f) => f.status === "pass").length;
      const failed = findings.filter((f) => f.status === "fail").length;
      const warnings = findings.filter((f) => f.status === "warning").length;
      const scorePercent = findings.length > 0 ? Math.round((passed / findings.length) * 100) : 0;
      return NextResponse.json({
        ok: true,
        scorecard: {
          totalRules: findings.length,
          passed, failed, warnings,
          scorePercent,
          findings: findings.map((f) => ({
            ruleId: f.ruleId, ruleName: f.ruleName,
            status: f.status, evidence: f.evidence,
            checkType: f.checkType, notes: f.notes,
          })),
          generatedAt: findings[0]?.checkedAt?.toISOString() ?? new Date().toISOString(),
        },
      });
    }

    // Fresh audit.
    const scorecard = await auditCompliance();
    return NextResponse.json({ ok: true, scorecard });
  } catch (err) {
    logger.error("api.compliance.scorecard.failed", { error: String(err) });
    return NextResponse.json({ ok: false, error: String(err).slice(0, 200) }, { status: 500 });
  }
}
