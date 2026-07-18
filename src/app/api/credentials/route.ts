import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import {
  encryptPassword,
  decryptPassword,
  isUsingProductionKey,
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
}): CredentialRow {
  let plain = '';
  try {
    plain = decryptPassword(c.passwordEnc, c.passwordIv, c.passwordTag);
  } catch {
    plain = '';
  }
  return {
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
}

export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const platform = url.searchParams.get('platform') || undefined;
  const methodKey = url.searchParams.get('methodKey') || undefined;
  const status = url.searchParams.get('status') || undefined;

  const where: Record<string, unknown> = {};
  if (platform) where.platform = platform;
  if (methodKey) where.methodKey = methodKey;
  if (status) where.status = status;

  const rows = await db.platformCredential.findMany({
    where,
    orderBy: { createdAt: 'desc' },
  });

  return NextResponse.json({
    credentials: rows.map(serialize),
    productionKey: isUsingProductionKey(),
    count: rows.length,
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { platform, platformUrl, username, password, notes, methodKey, status } = body as {
    platform?: string;
    platformUrl?: string;
    username?: string;
    password?: string;
    notes?: string;
    methodKey?: string;
    status?: string;
  };

  if (!platform || !username || !password) {
    return NextResponse.json(
      { error: 'platform, username, password required' },
      { status: 400 },
    );
  }

  const enc = encryptPassword(password);
  const created = await db.platformCredential.create({
    data: {
      platform,
      platformUrl: platformUrl || null,
      username,
      passwordEnc: enc.encrypted,
      passwordIv: enc.iv,
      passwordTag: enc.tag,
      notes: notes || null,
      methodKey: methodKey || null,
      status: status || 'active',
    },
  });

  return NextResponse.json({ credential: serialize(created) });
}
