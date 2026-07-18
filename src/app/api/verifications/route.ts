import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import {
  verifyClaim,
  listVerifications,
  getVerificationStats,
  logClaim,
  type ClaimType,
} from '@/lib/verification';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET — list verifications + stats
export async function GET(req: NextRequest) {
  const statsOnly = req.nextUrl.searchParams.get('stats') === '1';
  if (statsOnly) {
    const stats = await getVerificationStats();
    return NextResponse.json(stats);
  }

  const claimType = req.nextUrl.searchParams.get('claimType') as ClaimType | null;
  const status = req.nextUrl.searchParams.get('status');
  const questioned = req.nextUrl.searchParams.get('questioned');
  const limit = parseInt(req.nextUrl.searchParams.get('limit') ?? '50', 10);
  const offset = parseInt(req.nextUrl.searchParams.get('offset') ?? '0', 10);

  const result = await listVerifications({
    claimType: claimType ?? undefined,
    status: (status as never) ?? undefined,
    questioned: questioned === 'true' ? true : questioned === 'false' ? false : undefined,
    limit,
    offset,
  });
  return NextResponse.json(result);
}

// POST — log + verify a new claim
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { claimType, claimText, claimSource, evidence, linkedTaskId, crossCheck } = body as {
    claimType?: ClaimType;
    claimText?: string;
    claimSource?: string;
    evidence?: unknown[];
    linkedTaskId?: string;
    crossCheck?: boolean;
  };

  if (!claimType || !claimText) {
    return NextResponse.json(
      { error: 'claimType and claimText are required' },
      { status: 400 },
    );
  }

  const result = await verifyClaim(
    {
      claimType,
      claimText,
      claimSource,
      evidence: evidence as never,
      linkedTaskId,
    },
    { crossCheck: crossCheck !== false },
  );

  return NextResponse.json(result);
}
