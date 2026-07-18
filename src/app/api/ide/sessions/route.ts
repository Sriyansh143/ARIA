import { NextRequest, NextResponse } from 'next/server';
import { listSessions, createSession, updateSession } from '@/lib/ide';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/ide/sessions?projectId=xxx
export async function GET(req: NextRequest) {
  try {
    const projectId = req.nextUrl.searchParams.get('projectId');
    if (!projectId) {
      return NextResponse.json({ error: 'projectId required' }, { status: 400 });
    }
    const sessions = await listSessions(projectId);
    return NextResponse.json({ sessions });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'list sessions failed' }, { status: 500 });
  }
}

// POST /api/ide/sessions  { projectId, agentCodename? } -> create
// OR  { sessionId, openTabs?, activeTabId?, cursor?, scrollPosition? } -> update
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({})) as {
      projectId?: string;
      sessionId?: string;
      agentCodename?: string | null;
      openTabs?: string[];
      activeTabId?: string | null;
      cursor?: { fileId?: string; line?: number; col?: number };
      scrollPosition?: number;
    };
    if (body.sessionId) {
      const session = await updateSession(body.sessionId, {
        openTabs: body.openTabs,
        activeTabId: body.activeTabId ?? undefined,
        cursor: body.cursor,
        scrollPosition: body.scrollPosition,
      });
      return NextResponse.json({ session });
    }
    if (!body.projectId) {
      return NextResponse.json({ error: 'projectId or sessionId required' }, { status: 400 });
    }
    const session = await createSession(body.projectId, body.agentCodename ?? null);
    return NextResponse.json({ session });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'session op failed' }, { status: 500 });
  }
}
