import { NextResponse } from 'next/server';
import { purgeBrokenModels, getActivityLog } from '@/lib/model-sync';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/models/purge
// Deletes all Model rows where status='broken'. Rate-limited models are
// PRESERVED (they're still functional, just throttled).
export async function POST() {
  try {
    const result = await purgeBrokenModels();
    return NextResponse.json({ ok: true, ...result, activity: getActivityLog(20) });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
