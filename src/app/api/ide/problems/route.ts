import { NextRequest, NextResponse } from 'next/server';
import { getProblems } from '@/lib/ide';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({})) as { projectId?: string };
    if (!body.projectId) {
      return NextResponse.json({ error: 'projectId required' }, { status: 400 });
    }
    const problems = await getProblems(body.projectId);
    return NextResponse.json({ problems });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'problems failed' }, { status: 500 });
  }
}
