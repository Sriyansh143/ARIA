import { NextRequest, NextResponse } from 'next/server';
import { consolidateMemories } from '@/lib/knowledge-enhancer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { memoryKeys } = body as { memoryKeys?: string[] };

  if (!memoryKeys || !Array.isArray(memoryKeys) || memoryKeys.length === 0) {
    return NextResponse.json({ error: 'memoryKeys (string[]) is required' }, { status: 400 });
  }

  const result = await consolidateMemories(memoryKeys);
  return NextResponse.json(result);
}
