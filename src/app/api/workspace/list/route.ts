import { NextRequest, NextResponse } from 'next/server';
import { listSandboxed, getWorkspaceRoot } from '@/lib/fs-sandbox';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const { path } = await req.json().catch(() => ({})) as { path?: string };
  try {
    const result = await listSandboxed(path || '.');
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'list failed' }, { status: 400 });
  }
}

export async function GET() {
  return NextResponse.json({ root: getWorkspaceRoot() });
}
