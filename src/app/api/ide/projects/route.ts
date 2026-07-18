import { NextRequest, NextResponse } from 'next/server';
import { listProjects, createProject } from '@/lib/ide';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const projects = await listProjects();
    return NextResponse.json({ projects });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'list failed' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({})) as {
      name?: string; rootPath?: string; description?: string;
      language?: string; framework?: string;
    };
    if (!body.name || !body.rootPath) {
      return NextResponse.json({ error: 'name + rootPath required' }, { status: 400 });
    }
    const project = await createProject({
      name: body.name,
      rootPath: body.rootPath,
      description: body.description,
      language: body.language,
      framework: body.framework,
    });
    return NextResponse.json({ project });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'create failed' }, { status: 500 });
  }
}
