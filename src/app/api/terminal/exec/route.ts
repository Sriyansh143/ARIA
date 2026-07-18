import { NextRequest, NextResponse } from 'next/server';
import { executeCommand } from '@/lib/os-executor';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const { command, cwd } = await req.json().catch(() => ({})) as { command?: string; cwd?: string };
  if (!command) return NextResponse.json({ error: 'command required' }, { status: 400 });
  const result = await executeCommand(command, { cwd, timeout: 30000 });
  return NextResponse.json(result);
}
