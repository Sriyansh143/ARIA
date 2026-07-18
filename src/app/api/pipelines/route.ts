import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

interface PipelineStep {
  skillKey: string;
  label?: string;
  input?: string;
}

// GET — list all saved pipeline templates (with parsed steps + sharedWith).
export async function GET(req: NextRequest) {
  const community = req.nextUrl.searchParams.get('community') === 'true';
  const where = community ? { shared: true } : {};
  const pipelines = await db.pipeline.findMany({ where, orderBy: { updatedAt: 'desc' } });
  return NextResponse.json({
    pipelines: pipelines.map((p) => ({
      ...p,
      steps: JSON.parse(p.steps) as PipelineStep[],
      sharedWith: JSON.parse(p.sharedWith) as string[],
    })),
  });
}

// POST — save a new pipeline template. Body: { name, description, steps, owner? }
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { name, description, steps, owner } = body as { name?: string; description?: string; steps?: PipelineStep[]; owner?: string };
  if (!name || !Array.isArray(steps) || steps.length === 0) {
    return NextResponse.json({ error: 'name and non-empty steps array required' }, { status: 400 });
  }
  const existing = await db.pipeline.findFirst({ where: { name } });
  if (existing) {
    const updated = await db.pipeline.update({
      where: { id: existing.id },
      data: { description: description ?? existing.description, steps: JSON.stringify(steps), owner: owner ?? existing.owner },
    });
    return NextResponse.json({ pipeline: { ...updated, steps: JSON.parse(updated.steps), sharedWith: JSON.parse(updated.sharedWith) } });
  }
  const pipeline = await db.pipeline.create({
    data: { name, description: description ?? '', steps: JSON.stringify(steps), owner: owner ?? 'ORION' },
  });
  return NextResponse.json({ pipeline: { ...pipeline, steps: JSON.parse(pipeline.steps), sharedWith: JSON.parse(pipeline.sharedWith) } });
}

// PATCH — toggle shared status or update sharedWith. Body: { id, shared?, sharedWith? }
export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { id, shared, sharedWith } = body as { id?: string; shared?: boolean; sharedWith?: string[] };
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const data: Record<string, unknown> = {};
  if (typeof shared === 'boolean') data.shared = shared;
  if (Array.isArray(sharedWith)) data.sharedWith = JSON.stringify(sharedWith);
  const pipeline = await db.pipeline.update({ where: { id }, data });
  return NextResponse.json({ pipeline: { ...pipeline, steps: JSON.parse(pipeline.steps), sharedWith: JSON.parse(pipeline.sharedWith) } });
}
