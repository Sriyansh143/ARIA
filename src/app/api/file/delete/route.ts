import { NextRequest, NextResponse } from 'next/server';
import { deleteSandboxed } from '@/lib/fs-sandbox';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const { path } = await req.json().catch(() => ({})) as { path?: string };
  if (!path) return NextResponse.json({ error: 'path required' }, { status: 400 });
  try {
    await deleteSandboxed(path);
    return NextResponse.json({ ok: true, path });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'delete failed' }, { status: 400 });
  }
}
