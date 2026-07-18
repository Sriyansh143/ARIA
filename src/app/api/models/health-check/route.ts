import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { healthCheckModel, getActivityLog } from '@/lib/model-sync';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/models/health-check
// Body: { modelId?: string; providerKey?: string }
//   - If modelId given: health-check that single model (providerKey resolved
//     from DB if not supplied).
//   - Otherwise: health-check a random sample of 10 active provider-sourced
//     models + 5 local models.
export async function POST(req: NextRequest) {
  let body: { modelId?: string; providerKey?: string } = {};
  try {
    body = await req.json();
  } catch {
    // ignore
  }

  try {
    if (body.modelId) {
      let providerKey = body.providerKey;
      if (!providerKey) {
        const m = await db.model.findFirst({ where: { modelId: body.modelId } });
        if (!m) {
          return NextResponse.json({ ok: false, error: 'Model not found' }, { status: 404 });
        }
        providerKey = m.providerKey;
      }
      const result = await healthCheckModel(body.modelId, providerKey);
      return NextResponse.json({ ok: true, results: [result], activity: getActivityLog(20) });
    }

    const [providerModels, localModels] = await Promise.all([
      db.model.findMany({ where: { status: 'active', source: 'provider' }, take: 50 }),
      db.model.findMany({ where: { source: 'local' }, take: 20 }),
    ]);

    const providerSample = providerModels.sort(() => Math.random() - 0.5).slice(0, 10);
    const localSample = localModels.sort(() => Math.random() - 0.5).slice(0, 5);
    const sample = [...providerSample, ...localSample];

    const results = [];
    for (const m of sample) {
      results.push(await healthCheckModel(m.modelId, m.providerKey));
    }

    return NextResponse.json({
      ok: true,
      results,
      activity: getActivityLog(20),
      sampleSize: sample.length,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
