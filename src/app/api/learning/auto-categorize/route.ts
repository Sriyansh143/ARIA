import { NextRequest, NextResponse } from 'next/server';
import { autoCategorize, getCategoryRules } from '@/lib/categorize';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/learning/auto-categorize — returns the category rule catalog. */
export async function GET() {
  return NextResponse.json({
    rules: getCategoryRules(),
    sections: ['skill', 'plugin', 'memory', 'knowledge', 'intelligence', 'learning'],
  });
}

/** POST /api/learning/auto-categorize — analyze a content string and return
 *  the suggested target section + confidence + reason.
 *  Body: { content: string } */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { content } = body as { content?: string };

  if (typeof content !== 'string' || content.trim().length === 0) {
    return NextResponse.json(
      { error: 'content (string) required' },
      { status: 400 },
    );
  }
  if (content.length > 500_000) {
    return NextResponse.json(
      { error: 'content too large (500KB max for preview)' },
      { status: 413 },
    );
  }

  const result = autoCategorize(content);
  return NextResponse.json({
    suggestedSection: result.suggestedSection,
    confidence: Math.round(result.confidence * 100) / 100,
    reason: result.reason,
    scores: result.scores,
  });
}
