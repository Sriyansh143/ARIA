import { NextRequest, NextResponse } from 'next/server';
import { makeCall, isFreeSWITCHConfigured } from '@/lib/freeswitch-bridge';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/voice/call — make an outbound call via FreeSWITCH
// Body: { to: string, from?: string, gateway?: string }
export async function POST(req: NextRequest) {
  if (!isFreeSWITCHConfigured()) {
    return NextResponse.json({
      ok: false,
      error: 'FreeSWITCH not configured. Set FREESWITCH_ESL_HOST and FREESWITCH_ESL_PASSWORD in .env',
    }, { status: 503 });
  }

  const { to, from, gateway } = await req.json().catch(() => ({})) as {
    to?: string; from?: string; gateway?: string;
  };

  if (!to) {
    return NextResponse.json({ error: 'Phone number required' }, { status: 400 });
  }

  try {
    const result = await makeCall({
      to,
      from: from || process.env.FREESWITCH_FROM_NUMBER,
      gateway: gateway || process.env.FREESWITCH_SIP_GATEWAY || 'local-pstn',
    });

    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({
      ok: false,
      error: e instanceof Error ? e.message : 'Call failed',
    }, { status: 500 });
  }
}
