// /api/rollback — Snapshot + rollback management for destructive ops.
// Implements the user's permanent rule: "code once fixed should not be disturbed".
//
// GET  /api/rollback                  → list snapshots + stats
// GET  /api/rollback?id=<id>          → load one snapshot
// POST /api/rollback {action:'create', scope, payload, reason}  → create snapshot
// POST /api/rollback {action:'rollback', snapshotId}             → restore
// POST /api/rollback {action:'discard', id}                       → delete snapshot
import { NextRequest, NextResponse } from 'next/server';
import {
  createSnapshot,
  rollback,
  listSnapshots,
  loadSnapshot,
  discardSnapshot,
  snapshotStats,
  type SnapshotScope,
  type SnapshotPayload,
} from '@/lib/rollback-system';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get('id');
    if (id) {
      const snap = loadSnapshot(id);
      if (!snap) return NextResponse.json({ error: 'not found' }, { status: 404 });
      return NextResponse.json({ snapshot: snap });
    }
    const scopeParam = req.nextUrl.searchParams.get('scope') as SnapshotScope | null;
    const snaps = listSnapshots(scopeParam ?? undefined);
    const stats = snapshotStats();
    return NextResponse.json({ snapshots: snaps, stats, count: snaps.length });
  } catch (err) {
    return NextResponse.json(
      { error: 'failed', detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const action = typeof body.action === 'string' ? body.action : '';

    if (action === 'create') {
      const scope = (typeof body.scope === 'string' ? body.scope : 'mixed') as SnapshotScope;
      const validScopes: SnapshotScope[] = ['db', 'files', 'env', 'mixed'];
      if (!validScopes.includes(scope)) {
        return NextResponse.json({ error: `invalid scope. Must be one of: ${validScopes.join(', ')}` }, { status: 400 });
      }
      const payload: SnapshotPayload = {
        db: body.payload?.db,
        files: body.payload?.files,
        env: body.payload?.env,
      };
      const reason = typeof body.reason === 'string' ? body.reason : undefined;
      const snap = createSnapshot(scope, payload, reason);
      return NextResponse.json({ ok: true, snapshot: snap });
    }

    if (action === 'rollback') {
      const snapshotId = typeof body.snapshotId === 'string' ? body.snapshotId : '';
      if (!snapshotId) return NextResponse.json({ error: 'snapshotId required' }, { status: 400 });
      const result = rollback(snapshotId);
      return NextResponse.json({ ok: true, ...result });
    }

    if (action === 'discard') {
      const id = typeof body.id === 'string' ? body.id : '';
      if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
      const ok = discardSnapshot(id);
      return NextResponse.json({ ok, id });
    }

    return NextResponse.json({ error: 'unknown action. Use create|rollback|discard' }, { status: 400 });
  } catch (err) {
    return NextResponse.json(
      { error: 'failed', detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
