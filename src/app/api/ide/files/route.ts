import { NextRequest, NextResponse } from 'next/server';
import { createFile, createFolder, openFile } from '@/lib/ide';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({})) as {
      projectId?: string; path?: string; content?: string; folder?: boolean;
    };
    if (!body.projectId || !body.path) {
      return NextResponse.json({ error: 'projectId + path required' }, { status: 400 });
    }
    if (body.folder) {
      await createFolder(body.projectId, body.path);
      return NextResponse.json({ ok: true });
    }
    const file = await createFile(body.projectId, body.path, body.content ?? '');
    return NextResponse.json({ file });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'create failed' }, { status: 500 });
  }
}

// Open file by path (returns content) — used when no fileId yet.
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({})) as { projectId?: string; path?: string };
    if (!body.projectId || !body.path) {
      return NextResponse.json({ error: 'projectId + path required' }, { status: 400 });
    }
    const file = await openFile(body.projectId, body.path);
    return NextResponse.json({ file });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'open failed' }, { status: 500 });
  }
}
