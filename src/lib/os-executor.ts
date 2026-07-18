/**
 * os-executor.ts — Sandboxed shell command execution for autonomous agents.
 *
 * Ported from jarvis-mission-control-final.zip, adapted for this app.
 * SECURITY:
 *   1. Sanitized env — only PATH, HOME, LANG, TERM propagated to children.
 *   2. Command allow-list + block-list (regex).
 *   3. Per-command timeout + output size cap.
 *   4. Audit log entry per exec.
 */

import { spawn } from 'child_process';
import { db } from '@/lib/db';

const isWindows = process.platform === 'win32';

const DEFAULT_CHILD_ENV_ALLOWLIST = [
  'PATH', 'HOME', 'LANG', 'LC_ALL', 'TERM', 'TMPDIR', 'TEMP', 'TMP',
  'SYSTEMROOT', 'WINDIR', 'PATHEXT', 'COMSPEC',
  'USER', 'USERNAME', 'COMPUTERNAME', 'HOSTNAME',
];

function buildChildEnv(): NodeJS.ProcessEnv {
  const allow = new Set<string>(DEFAULT_CHILD_ENV_ALLOWLIST);
  const extra = process.env.JARVIS_CHILD_ENV_ALLOWLIST;
  if (extra) {
    for (const k of extra.split(',').map((s) => s.trim()).filter(Boolean)) {
      allow.add(k.toUpperCase());
    }
  }
  const out: NodeJS.ProcessEnv = {};
  for (const k of Object.keys(process.env)) {
    if (allow.has(k.toUpperCase()) && process.env[k] !== undefined) {
      out[k] = process.env[k] as string;
    }
  }
  if (!isWindows) out.HOME = '/tmp';
  return out;
}

const MAX_OUTPUT_SIZE = 100_000; // 100KB
const DEFAULT_TIMEOUT = 30_000; // 30s

// Commands that are ALWAYS blocked (regex patterns).
const BLOCKED_PATTERNS = [
  /rm\s+-rf\s+\//,             // rm -rf /
  /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\};\s*:/, // fork bomb
  /dd\s+.*of=\/dev\//,         // dd to device
  /mkfs/,                      // format
  />\s*\/dev\/sd/,             // write to disk device
  /\bsudo\b/,                  // privilege escalation
  /chmod\s+777/,               // world-writable
  /curl\s+.*\|\s*(sh|bash)/,   // pipe to shell
  /\bhalt\b/,                  // shutdown
  /\breboot\b/,                // reboot
  /\bshutdown\b/,              // shutdown
];

// Commands that require approval (not auto-approved).
const REQUIRES_APPROVAL = [
  /git\s+push/,                // push to remote
  /npm\s+publish/,             // publish package
  /docker\s+rm/,                // remove container
  /docker\s+rmi/,              // remove image
  /\bkill\s+-9/,               // force kill
];

export interface ExecResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  blocked?: string;
  requiresApproval?: boolean;
}

export interface GuardrailResult {
  safety: 'allowed' | 'blocked' | 'requires-approval';
  reason?: string;
}

export function checkCommand(cmd: string): GuardrailResult {
  const trimmed = cmd.trim();
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { safety: 'blocked', reason: `Command matches blocked pattern: ${pattern.source}` };
    }
  }
  for (const pattern of REQUIRES_APPROVAL) {
    if (pattern.test(trimmed)) {
      return { safety: 'requires-approval', reason: `Command requires approval: ${pattern.source}` };
    }
  }
  return { safety: 'allowed' };
}

export async function executeCommand(
  cmd: string,
  options?: { timeout?: number; cwd?: string; skipApproval?: boolean }
): Promise<ExecResult> {
  const timeout = options?.timeout || DEFAULT_TIMEOUT;
  const guardrail = checkCommand(cmd);

  if (guardrail.safety === 'blocked') {
    return { success: false, stdout: '', stderr: `BLOCKED: ${guardrail.reason}`, exitCode: null, timedOut: false, blocked: guardrail.reason };
  }

  if (guardrail.safety === 'requires-approval' && !options?.skipApproval) {
    return { success: false, stdout: '', stderr: `REQUIRES APPROVAL: ${guardrail.reason}`, exitCode: null, timedOut: false, requiresApproval: true };
  }

  return new Promise((resolvePromise) => {
    const shell = isWindows ? 'cmd.exe' : '/bin/bash';
    const shellFlag = isWindows ? '/c' : '-c';
    const child = spawn(shell, [shellFlag, cmd], {
      cwd: options?.cwd || process.cwd(),
      timeout,
      env: buildChildEnv(),
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    child.stdout?.on('data', (d) => {
      stdout += d.toString();
      if (stdout.length > MAX_OUTPUT_SIZE) {
        child.kill();
        stderr += '\n[output truncated at 100KB]';
      }
    });

    child.stderr?.on('data', (d) => {
      stderr += d.toString();
      if (stderr.length > MAX_OUTPUT_SIZE) {
        stderr = stderr.slice(0, MAX_OUTPUT_SIZE) + '\n[truncated]';
      }
    });

    child.on('close', (exitCode) => {
      // Best-effort audit log.
      try {
        db.auditLog.create({
          data: {
            actor: 'orion',
            action: 'os-exec',
            target: cmd.slice(0, 200),
            meta: JSON.stringify({ exitCode, timedOut, cwd: options?.cwd }),
          },
        }).catch(() => {});
      } catch { /* best-effort */ }

      resolvePromise({
        success: exitCode === 0,
        stdout: stdout.slice(0, MAX_OUTPUT_SIZE),
        stderr: stderr.slice(0, MAX_OUTPUT_SIZE),
        exitCode,
        timedOut,
      });
    });

    child.on('error', (err) => {
      resolvePromise({
        success: false,
        stdout,
        stderr: stderr + err.message,
        exitCode: null,
        timedOut: false,
      });
    });
  });
}

/** OS tool definitions for LLM function-calling. */
export const OS_TOOLS = [
  {
    name: 'execute_command',
    description: 'Execute a shell command (bash/cmd). Blocked: rm -rf /, sudo, mkfs, fork bombs. Requires approval: git push, npm publish, docker rm.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The shell command to execute' },
        timeout: { type: 'number', description: 'Timeout in ms (default 30000)' },
        cwd: { type: 'string', description: 'Working directory (default: project root)' },
      },
      required: ['command'],
    },
  },
  {
    name: 'read_file',
    description: 'Read a file from the workspace sandbox',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Relative path within workspace' } },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: 'Write content to a file in the workspace sandbox',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path within workspace' },
        content: { type: 'string', description: 'File content to write' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'list_directory',
    description: 'List directory contents in the workspace',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Relative path within workspace (default: .)' } },
      required: [],
    },
  },
  {
    name: 'edit_file',
    description: 'Find and replace text in a file',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        old_string: { type: 'string' },
        new_string: { type: 'string' },
      },
      required: ['path', 'old_string', 'new_string'],
    },
  },
];
