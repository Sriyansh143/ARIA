import { NextRequest, NextResponse } from 'next/server';
import { editSandboxed } from '@/lib/fs-sandbox';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const { path, oldString, newString } = await req.json().catch(() => ({})) as {
    path?: string; oldString?: string; newString?: string;
  };
  if (!path || !oldString || newString === undefined) {
    return NextResponse.json({ error: 'path, oldString, and newString required' }, { status: 400 });
  }
  try {
    await editSandboxed(path, oldString, newString);
    return NextResponse.json({ ok: true, path });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'edit failed' }, { status: 400 });
  }
}
