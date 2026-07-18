import { NextRequest, NextResponse } from 'next/server';
import { sendToOwner, sendApprovalRequest, isTelegramConfigured } from '@/lib/telegram-bot';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  if (!isTelegramConfigured()) {
    return NextResponse.json({ ok: false, error: 'Telegram not configured' }, { status: 503 });
  }
  const { message, type, title, description, approvalId } = await req.json().catch(() => ({})) as {
    message?: string; type?: string; title?: string; description?: string; approvalId?: string;
  };

  if (type === 'approval' && title && approvalId) {
    const ok = await sendApprovalRequest(title, description || '', approvalId);
    return NextResponse.json({ ok });
  }

  if (message) {
    const ok = await sendToOwner(message);
    return NextResponse.json({ ok });
  }

  return NextResponse.json({ error: 'message or type=approval required' }, { status: 400 });
}
