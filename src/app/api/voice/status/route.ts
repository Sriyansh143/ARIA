import { NextRequest, NextResponse } from 'next/server';
import { getStatus } from '@/lib/freeswitch-bridge';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/voice/status?uuid=... — get call status
export async function GET(req: NextRequest) {
  const uuid = req.nextUrl.searchParams.get('uuid');
  if (!uuid) return NextResponse.json({ error: 'uuid required' }, { status: 400 });
  const result = await getStatus(uuid);
  return NextResponse.json(result);
}
