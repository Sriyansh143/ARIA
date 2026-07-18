import { NextRequest, NextResponse } from 'next/server';
import { readSandboxed } from '@/lib/fs-sandbox';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const { path } = await req.json().catch(() => ({})) as { path?: string };
  if (!path) return NextResponse.json({ error: 'path required' }, { status: 400 });
  try {
    const content = await readSandboxed(path);
    return NextResponse.json({ content, path });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'read failed' }, { status: 400 });
  }
}
