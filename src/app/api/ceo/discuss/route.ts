import { NextRequest, NextResponse } from 'next/server';
import { multiAgentTabSweep, runDiscussion } from '@/lib/multi-agent-discussion';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST — run multi-agent discussion
// Body: { topic?: string } — if topic provided, run single discussion; otherwise run full sweep
export async function POST(req: NextRequest) {
  const { topic } = await req.json().catch(() => ({})) as { topic?: string };

  if (topic) {
    // Single discussion on a specific topic
    const result = await runDiscussion(topic, { manual: true });
    return NextResponse.json(result);
  }

  // Full multi-agent tab sweep
  const result = await multiAgentTabSweep();
  return NextResponse.json(result);
}
