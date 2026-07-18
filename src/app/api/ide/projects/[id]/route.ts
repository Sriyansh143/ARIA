import { NextRequest, NextResponse } from 'next/server';
import { getProject, deleteProject, updateProjectSettings } from '@/lib/ide';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const project = await getProject(id);
    return NextResponse.json({ project });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'fetch failed' }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await deleteProject(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'delete failed' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const allowed = ['theme', 'fontSize', 'wordWrap', 'minimap', 'autoSave', 'formatOnSave', 'linting', 'tabSize'];
    const update: Record<string, unknown> = {};
    for (const k of allowed) if (k in body) update[k] = body[k];
    const project = await updateProjectSettings(id, update as never);
    return NextResponse.json({ project });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'update failed' }, { status: 500 });
  }
}
