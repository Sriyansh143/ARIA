import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  const artifacts = await db.artifact.findMany({ orderBy: { createdAt: 'desc' }, take: 100 });
  return NextResponse.json({ artifacts });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { name, type, size, meta } = body;
  if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 });
  const artifact = await db.artifact.create({
    data: { name, type: type ?? 'file', size: size ?? 0, meta: JSON.stringify(meta ?? {}) },
  });
  return NextResponse.json({ artifact });
}
