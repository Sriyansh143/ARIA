import { NextRequest, NextResponse } from 'next/server';
import { getFile, saveFile, deleteFile, renameFile } from '@/lib/ide';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const file = await getFile(id);
    return NextResponse.json({ file });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'fetch failed' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await req.json().catch(() => ({})) as { content?: string; savedBy?: string };
    if (body.content === undefined) {
      return NextResponse.json({ error: 'content required' }, { status: 400 });
    }
    const file = await saveFile(id, body.content, body.savedBy ?? 'operator');
    return NextResponse.json({ file });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'save failed' }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await deleteFile(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'delete failed' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await req.json().catch(() => ({})) as { newPath?: string };
    if (!body.newPath) {
      return NextResponse.json({ error: 'newPath required' }, { status: 400 });
    }
    const file = await renameFile(id, body.newPath);
    return NextResponse.json({ file });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'rename failed' }, { status: 500 });
  }
}
