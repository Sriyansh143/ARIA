import { NextRequest, NextResponse } from 'next/server';
import { getApproval, resolveApproval } from '@/lib/approval-escalation';
import { logAudit } from '@/lib/audit-log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET — single approval by id.
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }
    const approval = await getApproval(id);
    if (!approval) {
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }
    return NextResponse.json({ approval });
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to fetch approval: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    );
  }
}

// POST — resolve (approve / reject) an approval.
// Body: { decision: 'approved' | 'rejected', decidedBy?, decisionNote? }
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }
    const body = (await req.json().catch(() => ({}))) as {
      decision?: 'approved' | 'rejected';
      decidedBy?: string;
      decisionNote?: string;
    };

    if (body.decision !== 'approved' && body.decision !== 'rejected') {
      return NextResponse.json(
        { ok: false, error: "decision must be 'approved' or 'rejected'" },
        { status: 400 },
      );
    }

    const result = await resolveApproval(id, {
      decision: body.decision,
      decidedBy: body.decidedBy ?? 'operator',
      decisionNote: body.decisionNote,
    });

    if (!result.ok || !result.approval) {
      // Differentiate "already resolved" / "not found" from real failures.
      const isConflict = result.error?.includes('already') || result.error?.includes('not found');
      return NextResponse.json(
        { ok: false, error: result.error ?? 'resolve failed' },
        { status: isConflict ? 409 : 500 },
      );
    }

    await logAudit({
      actor: result.approval.decidedBy ?? 'operator',
      action: `approval.${body.decision}`,
      target: `approval:${id}`,
      req,
      meta: {
        title: result.approval.title,
        category: result.approval.category,
      },
    });

    return NextResponse.json({ ok: true, approval: result.approval });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: `Failed to resolve approval: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    );
  }
}
