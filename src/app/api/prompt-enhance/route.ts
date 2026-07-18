import { NextRequest, NextResponse } from 'next/server';
import { enhancePromptPro, enhancePlan } from '@/lib/prompt-enhancer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST — enhance a single prompt (mandatory pro-level wrapper)
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { prompt, context, mode } = body as {
    prompt?: string;
    context?: Record<string, unknown>;
    mode?: 'single' | 'plan';
  };

  if (!prompt) {
    return NextResponse.json({ error: 'prompt is required' }, { status: 400 });
  }

  if (mode === 'plan') {
    // For plan mode, the prompt is expected to be a JSON array of steps
    let steps: Array<{ title: string; description?: string; action: string }>;
    try {
      steps = JSON.parse(prompt);
    } catch {
      return NextResponse.json({ error: 'Invalid plan JSON' }, { status: 400 });
    }
    const enhanced = await enhancePlan(steps, context as never);
    return NextResponse.json({ enhanced, count: enhanced.length });
  }

  const enhanced = await enhancePromptPro(prompt, context as never);
  return NextResponse.json({
    original: prompt,
    enhanced,
    originalLen: prompt.length,
    enhancedLen: enhanced.length,
  });
}
