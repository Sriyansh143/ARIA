import { NextRequest, NextResponse } from 'next/server';
import { sendEmail } from '@/lib/email-sender';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const { to, subject, body } = await req.json().catch(() => ({})) as { to?: string; subject?: string; body?: string };
  if (!to || !subject) {
    return NextResponse.json({ error: 'to and subject required' }, { status: 400 });
  }
  const result = await sendEmail(to, subject, body || '');
  return NextResponse.json(result);
}
