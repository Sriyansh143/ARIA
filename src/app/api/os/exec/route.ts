import { NextRequest, NextResponse } from 'next/server';
import { executeCommand, checkCommand } from '@/lib/os-executor';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/os/exec — execute a shell command
// Body: { command, timeout?, cwd?, skipApproval? }
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { command, timeout, cwd, skipApproval } = body as {
    command?: string; timeout?: number; cwd?: string; skipApproval?: boolean;
  };

  if (!command || !command.trim()) {
    return NextResponse.json({ error: 'command required' }, { status: 400 });
  }

  // Pre-check guardrails so we can return a clean 403 for blocked commands.
  const guard = checkCommand(command);
  if (guard.safety === 'blocked') {
    return NextResponse.json({
      error: 'Command blocked',
      reason: guard.reason,
      result: { success: false, stdout: '', stderr: `BLOCKED: ${guard.reason}`, exitCode: null, timedOut: false },
    }, { status: 403 });
  }

  if (guard.safety === 'requires-approval' && !skipApproval) {
    return NextResponse.json({
      error: 'Command requires approval',
      reason: guard.reason,
      result: { success: false, stdout: '', stderr: `REQUIRES APPROVAL: ${guard.reason}`, exitCode: null, timedOut: false, requiresApproval: true },
    }, { status: 402 });
  }

  const result = await executeCommand(command, { timeout, cwd, skipApproval });
  return NextResponse.json({ result });
}
