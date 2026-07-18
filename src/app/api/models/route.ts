import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

// GET /api/models — list all models across providers.
export async function GET(req: NextRequest) {
  const provider = req.nextUrl.searchParams.get('provider');
  const tier = req.nextUrl.searchParams.get('tier');
  const where: Record<string, unknown> = {};
  if (provider && provider !== 'all') where.providerKey = provider;
  if (tier && tier !== 'all') where.tier = tier;
  const models = await db.model.findMany({
    where,
    orderBy: [{ providerKey: 'asc' }, { modelId: 'asc' }],
  });
  // Group by provider for the UI.
  const byProvider: Record<string, typeof models> = {};
  for (const m of models) {
    const key = m.providerKey;
    if (!byProvider[key]) byProvider[key] = [];
    byProvider[key].push(m);
  }
  return NextResponse.json({ models, byProvider, providers: Object.keys(byProvider).sort() });
}
