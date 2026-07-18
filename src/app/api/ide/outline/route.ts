import { NextRequest, NextResponse } from 'next/server';
import { getOutline } from '@/lib/ide';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({})) as { fileId?: string };
    if (!body.fileId) {
      return NextResponse.json({ error: 'fileId required' }, { status: 400 });
    }
    const symbols = await getOutline(body.fileId);
    return NextResponse.json({ symbols });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'outline failed' }, { status: 500 });
  }
}
