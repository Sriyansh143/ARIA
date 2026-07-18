import { NextRequest, NextResponse } from 'next/server';
import { hangupCall } from '@/lib/freeswitch-bridge';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/voice/hangup — hangup a call
// Body: { uuid: string }
export async function POST(req: NextRequest) {
  const { uuid } = await req.json().catch(() => ({})) as { uuid?: string };
  if (!uuid) return NextResponse.json({ error: 'uuid required' }, { status: 400 });
  const result = await hangupCall(uuid);
  return NextResponse.json(result);
}
