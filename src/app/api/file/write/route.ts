import { NextRequest, NextResponse } from 'next/server';
import { writeSandboxed } from '@/lib/fs-sandbox';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const { path, content } = await req.json().catch(() => ({})) as { path?: string; content?: string };
  if (!path || content === undefined) return NextResponse.json({ error: 'path and content required' }, { status: 400 });
  try {
    await writeSandboxed(path, content);
    return NextResponse.json({ ok: true, path, size: content.length });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'write failed' }, { status: 400 });
  }
}
