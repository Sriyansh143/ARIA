import { NextRequest, NextResponse } from 'next/server';
import { researchEarningMethod } from '@/lib/ceo-agent';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST — research an earning method and create a full pipeline
export async function POST(req: NextRequest) {
  const { methodName, methodDescription } = await req.json().catch(() => ({})) as {
    methodName?: string; methodDescription?: string;
  };
  if (!methodName) {
    return NextResponse.json({ error: 'methodName required' }, { status: 400 });
  }
  const result = await researchEarningMethod(methodName, methodDescription || '');
  return NextResponse.json(result);
}
