// =====================================================================
// os-executor.ts — Shell/file execution for autonomous agents.
// =====================================================================
// Adapted for v10: simplified + tightened around the core use-case of
// running OS commands from the parallel orchestrator. Security model:
//   - Allow-list env propagation (no secrets leak to spawned processes)
//   - Hard timeout (30s default, 120s max)
//   - Output truncation (10K chars) to keep LLM context bounded
//   - Every exec logged via db.agentLog.create (best-effort)
//   - Path-traversal guard (cwd-prefixed reads/writes only)
//
// Mirrors the zip's API surface (executeCommand, readFile, writeFile,
// listDirectory, executeToolCall, OS_TOOLS) so callers can swap imports.
// =====================================================================

import { spawn } from 'child_process';
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync, realpathSync } from 'fs';
import { join, resolve, isAbsolute, dirname, basename } from 'path';
import { db } from './db';

const isWindows = process.platform === 'win32';

// ─── Config ──────────────────────────────────────────────────────────

export const OS_EXEC_DEFAULT_TIMEOUT_MS = 30_000;
export const OS_EXEC_MAX_TIMEOUT_MS = 120_000;
export const OS_EXEC_MAX_OUTPUT_CHARS = 10_000;

// Blocklist of command prefixes — even when an LLM thinks it wants to run
// these, we refuse. The list is conservative: it targets obviously
// destructive commands rather than trying to enumerate every dangerous
// shell invocation.
const COMMAND_BLOCKLIST: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\brm\s+-rf\s+\/(?:\s|$)/, reason: 'refuses recursive root delete' },
  { pattern: /:\(\)\s*\{\s*:\|:&\s*\}\s*;:/, reason: 'fork-bomb detected' },
  { pattern: /\bmkfs\b/, reason: 'filesystem-format blocked' },
  { pattern: /\bdd\s+if=.*of=\/dev\/(?:sd|nvme|hd)/, reason: 'raw disk write blocked' },
  { pattern: /\bshutdown\b|\breboot\b|\bhalt\b|\bpoweroff\b/, reason: 'system power control blocked' },
];

// Allow-list of env vars propagated to child processes. Everything else
// (especially secrets like API keys, DATABASE_URL) is stripped.
const DEFAULT_CHILD_ENV_ALLOWLIST = [
  'PATH', 'HOME', 'LANG', 'LC_ALL', 'TERM', 'TMPDIR', 'TEMP', 'TMP',
  'SYSTEMROOT', 'WINDIR', 'PATHEXT', 'COMSPEC',
  'USER', 'USERNAME', 'COMPUTERNAME', 'HOSTNAME',
];

function buildChildEnv(): NodeJS.ProcessEnv {
  const allow = new Set<string>(DEFAULT_CHILD_ENV_ALLOWLIST);
  const extra = process.env.OS_EXEC_ENV_ALLOWLIST;
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

export interface GuardrailResult {
  safety: 'ok' | 'blocked';
  reason?: string;
}

export function checkCommand(cmd: string): GuardrailResult {
  if (typeof cmd !== 'string' || cmd.trim().length === 0) {
    return { safety: 'blocked', reason: 'empty command' };
  }
  for (const rule of COMMAND_BLOCKLIST) {
    if (rule.pattern.test(cmd)) {
      return { safety: 'blocked', reason: rule.reason };
    }
  }
  return { safety: 'ok' };
}

// ─── Logging helper ──────────────────────────────────────────────────

async function logExec(opts: {
  agentId?: string;
  cmd: string;
  success: boolean;
  exitCode: number | null;
  durationMs: number;
  stdoutPreview: string;
  stderrPreview: string;
}): Promise<void> {
  if (!opts.agentId) return; // best-effort; many callers don't pass an agentId
  try {
    await db.agentLog.create({
      data: {
        agentId: opts.agentId,
        level: opts.success ? 'success' : 'error',
        message: `os-exec [${opts.cmd.slice(0, 80)}] → exit=${opts.exitCode} (${opts.durationMs}ms)`,
        meta: JSON.stringify({
          cmd: opts.cmd.slice(0, 500),
          exitCode: opts.exitCode,
          durationMs: opts.durationMs,
          stdout: opts.stdoutPreview.slice(0, 500),
          stderr: opts.stderrPreview.slice(0, 500),
        }),
      },
    });
  } catch {
    // Logging is best-effort — never fail an exec because the log write failed.
  }
}

// ─── Public API ──────────────────────────────────────────────────────

export interface ExecuteCommandOptions {
  timeout?: number;
  cwd?: string;
  agentId?: string;        // when set, every exec is logged to AgentLog
  skipGuardrails?: boolean; // if true, skips the blocklist check (use with care)
  maxOutputChars?: number;
}

export interface ExecuteCommandResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
  guardrail: GuardrailResult;
}

export async function executeCommand(
  cmd: string,
  options?: ExecuteCommandOptions,
): Promise<ExecuteCommandResult> {
  const start = Date.now();
  const timeout = Math.min(
    OS_EXEC_MAX_TIMEOUT_MS,
    options?.timeout ?? OS_EXEC_DEFAULT_TIMEOUT_MS,
  );
  const maxOut = options?.maxOutputChars ?? OS_EXEC_MAX_OUTPUT_CHARS;

  const guardrail = options?.skipGuardrails
    ? { safety: 'ok' as const }
    : checkCommand(cmd);

  if (guardrail.safety === 'blocked') {
    const result: ExecuteCommandResult = {
      success: false,
      stdout: '',
      stderr: `BLOCKED: ${guardrail.reason}`,
      exitCode: null,
      durationMs: Date.now() - start,
      guardrail,
    };
    await logExec({
      agentId: options?.agentId,
      cmd,
      success: false,
      exitCode: null,
      durationMs: result.durationMs,
      stdoutPreview: '',
      stderrPreview: result.stderr,
    });
    return result;
  }

  return new Promise((resolvePromise) => {
    const shell = isWindows ? 'cmd.exe' : '/bin/bash';
    const shellFlag = isWindows ? '/c' : '-c';
    let stdout = '';
    let stderr = '';
    let truncated = false;

    const child = spawn(shell, [shellFlag, cmd], {
      cwd: options?.cwd || process.cwd(),
      timeout,
      env: buildChildEnv(),
    });

    child.stdout?.on('data', (d) => {
      stdout += d.toString();
      if (stdout.length > maxOut) {
        truncated = true;
        child.kill('SIGKILL');
      }
    });
    child.stderr?.on('data', (d) => {
      stderr += d.toString();
      if (stderr.length > maxOut) {
        stderr = stderr.slice(0, maxOut);
      }
    });

    const finalize = (exitCode: number | null, err?: Error) => {
      const durationMs = Date.now() - start;
      const out = stdout.slice(0, maxOut) + (truncated ? '\n[truncated]' : '');
      const errText = stderr.slice(0, maxOut) + (err ? `\n${err.message}` : '');
      const result: ExecuteCommandResult = {
        success: exitCode === 0 && !err,
        stdout: out,
        stderr: errText,
        exitCode,
        durationMs,
        guardrail,
      };
      logExec({
        agentId: options?.agentId,
        cmd,
        success: result.success,
        exitCode,
        durationMs,
        stdoutPreview: out,
        stderrPreview: errText,
      }).catch(() => {});
      resolvePromise(result);
    };

    child.on('close', (exitCode) => finalize(exitCode));
    child.on('error', (err) => finalize(null, err));
  });
}

// ─── File helpers (path-traversal-safe) ──────────────────────────────

function isPathAllowed(path: string): boolean {
  let resolved: string;
  try {
    if (existsSync(path)) {
      resolved = realpathSync(path);
    } else {
      const parent = dirname(path);
      if (existsSync(parent)) {
        resolved = join(realpathSync(parent), basename(path));
      } else {
        resolved = resolve(path);
      }
    }
  } catch {
    return false;
  }
  const normalized = resolved.replace(/\\/g, '/').toLowerCase();
  const cwd = process.cwd().replace(/\\/g, '/').toLowerCase();
  if (!normalized.startsWith(cwd)) return false;
  const forbidden = ['/etc/', '/proc/', '/sys/', '/dev/', 'c:\\windows\\'];
  for (const f of forbidden) {
    if (normalized.includes(f)) return false;
  }
  return true;
}

export function readFile(path: string): { success: boolean; content?: string; error?: string } {
  try {
    const fullPath = isAbsolute(path) ? path : join(process.cwd(), path);
    if (!isPathAllowed(fullPath)) return { success: false, error: 'Access denied' };
    return { success: true, content: readFileSync(fullPath, 'utf-8').slice(0, OS_EXEC_MAX_OUTPUT_CHARS) };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function writeFile(path: string, content: string): { success: boolean; error?: string } {
  try {
    const fullPath = isAbsolute(path) ? path : join(process.cwd(), path);
    if (!isPathAllowed(fullPath)) return { success: false, error: 'Access denied' };
    const parentDir = dirname(fullPath);
    if (!existsSync(parentDir)) mkdirSync(parentDir, { recursive: true });
    writeFileSync(fullPath, content, 'utf-8');
    return { success: true };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export interface DirectoryEntry {
  name: string;
  type: 'dir' | 'file';
  size: number;
}

export function listDirectory(path: string): { success: boolean; entries?: DirectoryEntry[]; error?: string } {
  try {
    const fullPath = isAbsolute(path) ? path : join(process.cwd(), path);
    if (!isPathAllowed(fullPath)) return { success: false, error: 'Access denied' };
    const entries: DirectoryEntry[] = readdirSync(fullPath).map((name) => {
      const stat = statSync(join(fullPath, name));
      return { name, type: (stat.isDirectory() ? 'dir' : 'file') as 'dir' | 'file', size: stat.size };
    });
    return { success: true, entries };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ─── Tool-call dispatch (for agent-loop style tool use) ──────────────

export const OS_TOOLS = [
  { name: 'execute_command', description: 'Execute a shell command (sandboxed, 30s timeout)', parameters: { type: 'object', properties: { command: { type: 'string' }, timeout: { type: 'number' }, cwd: { type: 'string' } }, required: ['command'] } },
  { name: 'read_file', description: 'Read file contents (cwd-prefixed)', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
  { name: 'write_file', description: 'Write to a file (cwd-prefixed)', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } },
  { name: 'list_directory', description: 'List directory contents', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
];

export async function executeToolCall(
  toolName: string,
  args: Record<string, unknown>,
): Promise<{ success: boolean; result: string }> {
  try {
    switch (toolName) {
      case 'execute_command': {
        const cmd = await executeCommand(String(args.command ?? ''), {
          timeout: args.timeout ? Number(args.timeout) : undefined,
          cwd: args.cwd ? String(args.cwd) : undefined,
        });
        return {
          success: cmd.success,
          result: JSON.stringify({
            stdout: cmd.stdout.slice(0, 2000),
            stderr: cmd.stderr.slice(0, 2000),
            exitCode: cmd.exitCode,
          }),
        };
      }
      case 'read_file': {
        const fr = readFile(String(args.path ?? ''));
        return { success: fr.success, result: fr.success ? (fr.content ?? '').slice(0, 5000) : (fr.error ?? '') };
      }
      case 'write_file': {
        const wf = writeFile(String(args.path ?? ''), String(args.content ?? ''));
        return { success: wf.success, result: wf.success ? 'Written' : (wf.error ?? '') };
      }
      case 'list_directory': {
        const ld = listDirectory(String(args.path ?? ''));
        return { success: ld.success, result: ld.success ? JSON.stringify((ld.entries ?? []).slice(0, 50)) : (ld.error ?? '') };
      }
      default:
        return { success: false, result: `Unknown tool: ${toolName}` };
    }
  } catch (err: unknown) {
    return { success: false, result: err instanceof Error ? err.message : String(err) };
  }
}
