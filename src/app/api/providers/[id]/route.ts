import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { encryptPassword } from '@/lib/credential-vault';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/providers/[id] — provider detail. NEVER includes API key material
// (only a boolean `hasKey`).
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const p = await db.provider.findUnique({ where: { id } });
  if (!p) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({
    provider: {
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
    },
  });
}

// PATCH /api/providers/[id] — update provider fields. Accepts:
//   { name?, model?, enabled?, latency?, tokens?, apiKey? }
// `apiKey` (plaintext) is encrypted via credential-vault before storage and
// NEVER appears in any response. Other fields are stored as-is.
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const data: Record<string, unknown> = {};
  for (const k of ['name', 'model', 'enabled', 'latency', 'tokens']) {
    if (k in body) data[k] = body[k];
  }

  // Handle API key — encrypt if non-empty, clear if explicitly null.
  if ('apiKey' in body) {
    const apiKey = body.apiKey;
    if (typeof apiKey === 'string' && apiKey.length > 0) {
      try {
        const enc = encryptPassword(apiKey);
        data.apiKeyEnc = enc.encrypted;
        data.apiKeyIv = enc.iv;
        data.apiKeyTag = enc.tag;
      } catch (err) {
        return NextResponse.json(
          { ok: false, error: `Key encryption failed: ${err instanceof Error ? err.message : String(err)}` },
          { status: 500 },
        );
      }
    } else if (apiKey === null) {
      // Explicitly clear the key.
      data.apiKeyEnc = null;
      data.apiKeyIv = null;
      data.apiKeyTag = null;
    }
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'No updatable fields supplied' }, { status: 400 });
  }

  try {
    const updated = await db.provider.update({ where: { id }, data });
    return NextResponse.json({
      ok: true,
      provider: {
        id: updated.id,
        key: updated.key,
        name: updated.name,
        model: updated.model,
        enabled: updated.enabled,
        latency: updated.latency,
        tokens: updated.tokens,
        hasKey: !!(updated.apiKeyEnc && updated.apiKeyIv && updated.apiKeyTag),
        updatedAt: updated.updatedAt,
      },
    });
  } catch {
    return NextResponse.json({ error: 'Provider not found or update failed' }, { status: 404 });
  }
}
