import { NextRequest, NextResponse } from 'next/server';
import { getGitDiff } from '@/lib/ide';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({})) as { projectId?: string; staged?: boolean };
    if (!body.projectId) {
      return NextResponse.json({ error: 'projectId required' }, { status: 400 });
    }
    const diff = await getGitDiff(body.projectId, { staged: body.staged });
    return NextResponse.json({ diff });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'git diff failed' }, { status: 500 });
  }
}
