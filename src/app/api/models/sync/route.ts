import { NextRequest, NextResponse } from 'next/server';
import { syncProviderModels, syncAll, getModelStatusSummary, getActivityLog } from '@/lib/model-sync';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/models/sync — returns the current status summary + activity log.
// Used by the ModelsTab banner (polled every 30s). Does NOT trigger a sync.
export async function GET() {
  try {
    const [summary, activity] = await Promise.all([getModelStatusSummary(), Promise.resolve(getActivityLog(20))]);
    return NextResponse.json({ ok: true, summary, activity });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

// POST /api/models/sync
// Body: { providerKey?: string }
//   - If providerKey given: sync just that provider (or 'local' for Ollama).
//   - Otherwise: run syncAll() (every provider with a key + Ollama + sample health-check).
export async function POST(req: NextRequest) {
  let body: { providerKey?: string } = {};
  try {
    body = await req.json();
  } catch {
    // empty body is fine — sync all
  }

  try {
    if (body.providerKey && body.providerKey !== 'all') {
      if (body.providerKey === 'local') {
        const { detectLocalModels } = await import('@/lib/model-sync');
        const local = await detectLocalModels();
        const summary = await getModelStatusSummary();
        return NextResponse.json({ ok: !local.error, local, summary, activity: getActivityLog(20) });
      }
      const result = await syncProviderModels(body.providerKey);
      const summary = await getModelStatusSummary();
      return NextResponse.json({ ok: !result.error, result, summary, activity: getActivityLog(20) });
    }
    const report = await syncAll();
    const summary = await getModelStatusSummary();
    return NextResponse.json({ ok: true, report, summary, activity: getActivityLog(20) });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
