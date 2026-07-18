import { NextRequest, NextResponse } from 'next/server';
import { getGitStatus } from '@/lib/ide';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({})) as { projectId?: string };
    if (!body.projectId) {
      return NextResponse.json({ error: 'projectId required' }, { status: 400 });
    }
    const status = await getGitStatus(body.projectId);
    return NextResponse.json({ status });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'git status failed' }, { status: 500 });
  }
}

// Convenience GET for status bar polling (lightweight).
export async function GET(req: NextRequest) {
  try {
    const projectId = req.nextUrl.searchParams.get('projectId');
    if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 });
    const status = await getGitStatus(projectId);
    return NextResponse.json({ status });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'git status failed' }, { status: 500 });
  }
}
