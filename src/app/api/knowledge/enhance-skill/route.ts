import { NextRequest, NextResponse } from 'next/server';
import { enhanceSkill, type EnhancementLevel } from '@/lib/knowledge-enhancer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { skillId, targetLevel } = body as { skillId?: string; targetLevel?: EnhancementLevel };

  if (!skillId) {
    return NextResponse.json({ error: 'skillId is required' }, { status: 400 });
  }

  const result = await enhanceSkill(skillId, targetLevel ?? 'expert');
  return NextResponse.json(result);
}
