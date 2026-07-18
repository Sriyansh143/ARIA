import { NextRequest, NextResponse } from 'next/server';
import { questionClaim } from '@/lib/verification';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST — question a claim (implements "plans can be questioned and improvised")
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const { questionNote, improvedVersion } = body as {
    questionNote?: string;
    improvedVersion?: string;
  };

  if (!questionNote) {
    return NextResponse.json({ error: 'questionNote is required' }, { status: 400 });
  }

  const result = await questionClaim(id, questionNote, improvedVersion);
  return NextResponse.json(result);
}
