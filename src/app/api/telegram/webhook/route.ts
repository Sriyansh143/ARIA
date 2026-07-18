import { NextRequest, NextResponse } from 'next/server';
import { handleTelegramUpdate, isTelegramConfigured } from '@/lib/telegram-bot';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/telegram/webhook — receives Telegram updates (messages + callbacks)
export async function POST(req: NextRequest) {
  if (!isTelegramConfigured()) {
    return NextResponse.json({ ok: false, error: 'Telegram not configured' }, { status: 503 });
  }
  const update = await req.json().catch(() => ({}));
  const result = await handleTelegramUpdate(update);
  return NextResponse.json(result);
}

// GET /api/telegram/webhook — set up the webhook
export async function GET() {
  if (!isTelegramConfigured()) {
    return NextResponse.json({ ok: false, error: 'Telegram not configured' });
  }
  const token = process.env.TELEGRAM_BOT_TOKEN!;
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  const webhookUrl = `${baseUrl}/api/telegram/webhook`;
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: webhookUrl }),
    });
    const data = await r.json();
    return NextResponse.json({ ok: true, webhook: webhookUrl, result: data });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'unknown' });
  }
}
