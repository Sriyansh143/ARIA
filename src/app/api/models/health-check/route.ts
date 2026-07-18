import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { healthCheckModel, getActivityLog } from '@/lib/model-sync';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  let body: { modelId?: string; providerKey?: string } = {};
  try { body = await req.json(); } catch { /* ignore */ }

  try {
    if (body.modelId) {
      let providerKey = body.providerKey;
      if (!providerKey) {
        const m = await db.model.findFirst({ where: { modelId: body.modelId } });
        if (!m) return NextResponse.json({ ok: false, error: 'Model not found' }, { status: 404 });
        providerKey = m.providerKey;
      }
      const result = await healthCheckModel(body.modelId, providerKey);
      return NextResponse.json({ ok: true, results: [result], activity: getActivityLog(20) });
    }

    // Get providers that HAVE API keys stored
    const providersWithKeys = await db.provider.findMany({
      where: { apiKeyEnc: { not: null }, enabled: true },
      select: { key: true },
    });
    const providerKeys = providersWithKeys.map(p => p.key);

    // Get models from providers that have keys (test source='seed' too, not just 'provider')
    const testableModels = await db.model.findMany({
      where: {
        status: 'active',
        providerKey: { in: providerKeys },
      },
      take: 100, // test up to 100 models
    });

    // Sample 15 random models from the testable set
    const sample = testableModels.sort(() => Math.random() - 0.5).slice(0, 15);

    // Run health checks in parallel (batch of 5 at a time to avoid rate limits)
    const results = [];
    const batchSize = 5;
    for (let i = 0; i < sample.length; i += batchSize) {
      const batch = sample.slice(i, i + batchSize);
      const batchResults = await Promise.allSettled(
        batch.map(m => healthCheckModel(m.modelId, m.providerKey))
      );
      for (const r of batchResults) {
        if (r.status === 'fulfilled') results.push(r.value);
      }
    }

    // Update model statuses in DB
    for (const r of results) {
      if (r.status !== 'unknown') {
        await db.model.updateMany({
          where: { modelId: r.modelId, providerKey: r.providerKey },
          data: { status: r.status, lastChecked: new Date() },
        }).catch(() => {});
      }
    }

    return NextResponse.json({ ok: true, results, activity: getActivityLog(20) });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'unknown' }, { status: 500 });
  }
}
