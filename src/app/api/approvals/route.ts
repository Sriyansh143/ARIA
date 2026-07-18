import { NextRequest, NextResponse } from 'next/server';
import {
  createApproval,
  listApprovals,
  getApprovalStats,
  type ApprovalCategory,
  type ApprovalStatus,
} from '@/lib/approval-escalation';
import { logAudit } from '@/lib/audit-log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET — list approvals (with filters) + aggregated stats.
// Query params:
//   ?status=pending|approved|rejected|expired|superseded|all
//   ?category=app-change|payment-refund|...|all
//   ?limit=100
//   ?stats=1  (always returned, but can be omitted)
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const status = url.searchParams.get('status') ?? 'all';
    const category = url.searchParams.get('category') ?? 'all';
    const limitParam = url.searchParams.get('limit');
    const limit = limitParam ? Math.min(Math.max(parseInt(limitParam, 10) || 100, 1), 500) : 100;

    const [approvals, stats] = await Promise.all([
      listApprovals({ status: status as ApprovalStatus, category: category as ApprovalCategory, limit }),
      getApprovalStats(),
    ]);

    return NextResponse.json({
      approvals,
      count: approvals.length,
      filters: { status, category, limit },
      stats,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: `Failed to list approvals: ${err instanceof Error ? err.message : String(err)}`,
        approvals: [],
        count: 0,
        stats: null,
      },
      { status: 500 },
    );
  }
}

// POST — create a new approval request.
// Body: { title, description, category?, requestedBy?, payload?, timeoutMinutes? }
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      title?: string;
      description?: string;
      category?: ApprovalCategory | string;
      requestedBy?: string;
      payload?: Record<string, unknown> | null;
      timeoutMinutes?: number;
    };

    if (!body.title?.trim() || !body.description?.trim()) {
      return NextResponse.json(
        { ok: false, error: 'title and description are required' },
        { status: 400 },
      );
    }

    const result = await createApproval({
      title: body.title,
      description: body.description,
      category: body.category ?? 'other',
      requestedBy: body.requestedBy ?? 'operator',
      payload: body.payload ?? null,
      timeoutMinutes: body.timeoutMinutes,
    });

    if (!result.ok || !result.approval) {
      return NextResponse.json({ ok: false, error: result.error ?? 'create failed' }, { status: 500 });
    }

    await logAudit({
      actor: result.approval.requestedBy,
      action: 'approval.create',
      target: `approval:${result.approval.id}`,
      req,
      meta: {
        title: result.approval.title,
        category: result.approval.category,
      },
    });

    return NextResponse.json({ ok: true, approval: result.approval });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: `Failed to create approval: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    );
  }
}
