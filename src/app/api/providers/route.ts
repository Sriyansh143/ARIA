import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  const providers = await db.provider.findMany({ orderBy: { name: 'asc' } });
  // Sanitize: NEVER expose the encrypted API key material in a GET response.
  // Only return a boolean `hasKey` flag. (Task ID 12 / PARALLEL-D)
  const safe = providers.map((p) => ({
    id: p.id,
    key: p.key,
    name: p.name,
    model: p.model,
    enabled: p.enabled,
    latency: p.latency,
    tokens: p.tokens,
    hasKey: !!(p.apiKeyEnc && p.apiKeyIv && p.apiKeyTag),
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  }));
  return NextResponse.json({ providers: safe });
}
