import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const status = req.nextUrl.searchParams.get('status');
  const where: Record<string, unknown> = {};
  if (status) where.status = status;
  const tasks = await db.task.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: { assignee: { select: { codename: true, name: true } } },
  });
  return NextResponse.json({ tasks });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { title, description, priority, assigneeId, tags } = body;
  if (!title) return NextResponse.json({ error: 'title required' }, { status: 400 });
  const task = await db.task.create({
    data: {
      title,
      description,
      priority: priority ?? 'medium',
      assigneeId: assigneeId || null,
      tags: JSON.stringify(tags ?? []),
    },
  });
  return NextResponse.json({ task });
}
