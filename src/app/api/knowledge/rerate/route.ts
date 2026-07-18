import { NextRequest, NextResponse } from 'next/server';
import { reRateAgentSkill } from '@/lib/knowledge-enhancer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { agentCodename, skillKey } = body as { agentCodename?: string; skillKey?: string };

  if (!agentCodename || !skillKey) {
    return NextResponse.json(
      { error: 'agentCodename and skillKey are required' },
      { status: 400 },
    );
  }

  const result = await reRateAgentSkill(agentCodename, skillKey);
  return NextResponse.json(result);
}
