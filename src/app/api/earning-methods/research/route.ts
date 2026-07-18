// POST /api/earning-methods/research
// Manually triggers the LLM-powered earning-methods research engine.
// Returns the discovered methods + validation diagnostics.

import { NextResponse } from 'next/server';
import { researchNewEarningMethods } from '@/lib/earning-research';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    const result = await researchNewEarningMethods();

    return NextResponse.json({
      ok: true,
      discovered: result.discovered,
      skipped: result.skipped,
      rejected: result.rejected,
      latencyMs: result.latencyMs,
      methods: result.methods.map((m) => ({
        id: m.id,
        key: m.key,
        name: m.name,
        category: m.category,
        earningPotential: m.earningPotential,
        riskLevel: m.riskLevel,
        estimatedMonthly: m.estimatedMonthly,
        approved: m.approved,
        enabled: m.enabled,
      })),
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        discovered: 0,
        methods: [],
      },
      { status: 500 },
    );
  }
}
