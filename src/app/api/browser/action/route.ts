import { NextRequest, NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface BrowserAction {
  type: 'navigate' | 'click' | 'type' | 'screenshot' | 'extract' | 'scroll' | 'eval';
  url?: string;
  ref?: string;
  text?: string;
  selector?: string;
  direction?: 'up' | 'down';
  amount?: number;
  script?: string;
}

// POST /api/browser/action — execute a browser action via agent-browser CLI
export async function POST(req: NextRequest) {
  const { action } = await req.json().catch(() => ({})) as { action?: BrowserAction };
  if (!action || !action.type) {
    return NextResponse.json({ error: 'action.type required' }, { status: 400 });
  }

  try {
    let cmd = '';
    switch (action.type) {
      case 'navigate':
        if (!action.url) return NextResponse.json({ error: 'url required for navigate' }, { status: 400 });
        cmd = `agent-browser open ${action.url}`;
        break;
      case 'click':
        if (!action.ref) return NextResponse.json({ error: 'ref required for click' }, { status: 400 });
        cmd = `agent-browser click ${action.ref}`;
        break;
      case 'type':
        if (!action.ref || !action.text) return NextResponse.json({ error: 'ref and text required for type' }, { status: 400 });
        cmd = `agent-browser fill ${action.ref} "${action.text.replace(/"/g, '\\"')}"`;
        break;
      case 'screenshot':
        cmd = `agent-browser screenshot --full`;
        break;
      case 'extract':
        cmd = `agent-browser snapshot -i`;
        break;
      case 'scroll':
        cmd = `agent-browser scroll ${action.direction || 'down'} ${action.amount || 500}`;
        break;
      case 'eval':
        if (!action.script) return NextResponse.json({ error: 'script required for eval' }, { status: 400 });
        cmd = `agent-browser eval "${action.script.replace(/"/g, '\\"')}"`;
        break;
      default:
        return NextResponse.json({ error: `Unknown action type: ${action.type}` }, { status: 400 });
    }

    const { stdout, stderr } = await execAsync(cmd, { timeout: 30000 });
    return NextResponse.json({
      ok: true,
      action: action.type,
      output: stdout.slice(0, 50000),
      error: stderr || undefined,
    });
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message?: string };
    return NextResponse.json({
      ok: false,
      error: err.message || 'browser action failed',
      stdout: err.stdout?.slice(0, 5000),
      stderr: err.stderr?.slice(0, 5000),
    }, { status: 500 });
  }
}
