import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { chat, type ChatTurn } from '@/lib/llm';

export const dynamic = 'force-dynamic';

// GET — recent chat history.
export async function GET(req: NextRequest) {
  const limit = Number(req.nextUrl.searchParams.get('limit') ?? 50);
  const messages = await db.chatMessage.findMany({ orderBy: { createdAt: 'desc' }, take: limit });
  return NextResponse.json({ messages: messages.reverse() });
}

// POST — generate a completion via GLM-4.6 and persist both turns.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { message, history } = body as { message?: string; history?: ChatTurn[] };
  if (!message || !message.trim()) {
    return NextResponse.json({ error: 'message required' }, { status: 400 });
  }
  try {
    const { content, latencyMs } = await chat(message, history ?? []);
    await db.chatMessage.create({ data: { role: 'user', content: message } });
    const saved = await db.chatMessage.create({
      data: { role: 'assistant', content, latency: latencyMs, model: 'glm-4.6' },
    });
    return NextResponse.json({ message: saved });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
