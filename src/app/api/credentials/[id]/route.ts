import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import {
  encryptPassword,
  decryptPassword,
  maskPassword,
} from '@/lib/credential-vault';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface CredentialRow {
  id: string;
  platform: string;
  platformUrl: string | null;
  username: string;
  passwordMasked: string;
  passwordRevealed?: string; // only present when ?reveal=1
  notes: string | null;
  methodKey: string | null;
  status: string;
  registeredAt: string;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

function serialize(c: {
  id: string;
  platform: string;
  platformUrl: string | null;
  username: string;
  passwordEnc: string;
  passwordIv: string;
  passwordTag: string;
  notes: string | null;
  methodKey: string | null;
  status: string;
  registeredAt: Date;
  lastUsedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}, reveal: boolean): CredentialRow {
  let plain = '';
  try {
    plain = decryptPassword(c.passwordEnc, c.passwordIv, c.passwordTag);
  } catch {
    plain = '';
  }
  const out: CredentialRow = {
    id: c.id,
    platform: c.platform,
    platformUrl: c.platformUrl,
    username: c.username,
    passwordMasked: maskPassword(plain),
    notes: c.notes,
    methodKey: c.methodKey,
    status: c.status,
    registeredAt: c.registeredAt.toISOString(),
    lastUsedAt: c.lastUsedAt ? c.lastUsedAt.toISOString() : null,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
  if (reveal) out.passwordRevealed = plain;
  return out;
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const url = req.nextUrl;
  const reveal = url.searchParams.get('reveal') === '1';
  const row = await db.platformCredential.findUnique({ where: { id } });
  if (!row) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ credential: serialize(row, reveal) });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const existing = await db.platformCredential.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const data: Record<string, unknown> = {};
  for (const k of ['platform', 'platformUrl', 'username', 'notes', 'methodKey', 'status']) {
    if (k in body) {
      const v = (body as Record<string, unknown>)[k];
      data[k] = v === undefined ? null : v;
    }
  }

  // Re-encrypt if password is changing.
  if (typeof body.password === 'string' && body.password.length > 0) {
    const enc = encryptPassword(body.password as string);
    data.passwordEnc = enc.encrypted;
    data.passwordIv = enc.iv;
    data.passwordTag = enc.tag;
  }

  const updated = await db.platformCredential.update({ where: { id }, data });
  return NextResponse.json({ credential: serialize(updated, false) });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const action = String(body.action || '');

  const existing = await db.platformCredential.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: 'not found' }, { status: 404 });

  if (action === 'touch') {
    const updated = await db.platformCredential.update({
      where: { id },
      data: { lastUsedAt: new Date() },
    });
    return NextResponse.json({ credential: serialize(updated, false) });
  }

  return NextResponse.json({ error: `unknown action: ${action}` }, { status: 400 });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  await db.platformCredential.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
