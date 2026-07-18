import { NextRequest, NextResponse } from 'next/server';
import { runMonitor, getMonitor } from '@/lib/agent-monitors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ─── POST /api/agent-monitors/[key] ───────────────────────────────────
// Run a single monitor by key. Returns its run result.
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ key: string }> },
) {
  const { key } = await params;
  const monitor = getMonitor(key);
  if (!monitor) {
    return NextResponse.json(
      { ok: false, error: `Unknown monitor key: ${key}` },
      { status: 404 },
    );
  }
  const result = await runMonitor(key);
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
