import { NextRequest, NextResponse } from 'next/server';
import { escalatePendingApprovals } from '@/lib/approval-escalation';
import { logAudit } from '@/lib/audit-log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST — manually trigger an escalation sweep (for testing / cron runs).
// Body: { manual?: boolean }
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}) as { manual?: boolean });
    const result = await escalatePendingApprovals();

    await logAudit({
      actor: 'operator',
      action: 'approval.escalate.manual',
      target: 'approval-sweep',
      req,
      meta: {
        manual: body.manual ?? true,
        escalated: result.escalated,
        expired: result.expired,
        details: result.details,
        error: result.error ?? null,
      },
    });

    return NextResponse.json({
      ok: result.ok,
      escalated: result.escalated,
      expired: result.expired,
      details: result.details,
      error: result.error,
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        escalated: 0,
        expired: 0,
        details: [],
        error: `Escalation trigger failed: ${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 500 },
    );
  }
}

// GET — convenience: GET also triggers a sweep (so it can be hit from a
// browser or simple curl). Returns the same shape as POST.
export async function GET(req: NextRequest) {
  try {
    const result = await escalatePendingApprovals();
    await logAudit({
      actor: 'operator',
      action: 'approval.escalate.manual',
      target: 'approval-sweep',
      req,
      meta: {
        manual: true,
        via: 'GET',
        escalated: result.escalated,
        expired: result.expired,
        details: result.details,
        error: result.error ?? null,
      },
    });
    return NextResponse.json({
      ok: result.ok,
      escalated: result.escalated,
      expired: result.expired,
      details: result.details,
      error: result.error,
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        escalated: 0,
        expired: 0,
        details: [],
        error: `Escalation trigger failed: ${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 500 },
    );
  }
}
