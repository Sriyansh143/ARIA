import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { randomUUID } from 'crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface FeedbackEntry {
  id: string;
  feedback: string;
  improvement?: string;
  createdAt: string;
}

function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const method = await db.earningMethod.findUnique({
    where: { id },
    select: { feedback: true },
  });
  if (!method) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const feedback = safeParse<FeedbackEntry[]>(method.feedback, []);
  return NextResponse.json({ feedback });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const feedback = String(body.feedback || '').trim();
  const improvement = String(body.improvement || '').trim();

  if (!feedback) {
    return NextResponse.json({ error: 'feedback required' }, { status: 400 });
  }

  const method = await db.earningMethod.findUnique({
    where: { id },
    select: { feedback: true },
  });
  if (!method) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const existing = safeParse<FeedbackEntry[]>(method.feedback, []);
  const entry: FeedbackEntry = {
    id: randomUUID(),
    feedback,
    improvement: improvement || undefined,
    createdAt: new Date().toISOString(),
  };
  const next = [entry, ...existing].slice(0, 100);

  await db.earningMethod.update({
    where: { id },
    data: { feedback: JSON.stringify(next) },
  });

  return NextResponse.json({ entry, feedback: next });
}
