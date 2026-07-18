/**
 * fs-sandbox.ts — Path-traversal-safe filesystem operations.
 *
 * Ported from jarvis-mission-control-final.zip, adapted for this app.
 * All filesystem API routes route through this module. It enforces a
 * workspace root and rejects any path that escapes it via:
 *   - `..` traversal
 *   - absolute paths outside the root
 *   - symlinks pointing outside the root
 *
 * Root: process.env.JARVIS_WORKSPACE_ROOT || <project_root>/workspace
 */

import { resolve, join, relative, isAbsolute, dirname, basename } from 'path';
import {
  existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync,
  lstatSync, realpathSync, unlinkSync, renameSync, statSync,
} from 'fs';

const WORKSPACE_ROOT = process.env.JARVIS_WORKSPACE_ROOT
  || join(process.cwd(), 'workspace');

if (!existsSync(WORKSPACE_ROOT)) {
  try { mkdirSync(WORKSPACE_ROOT, { recursive: true }); } catch { /* ignore */ }
}

export function getWorkspaceRoot(): string {
  return WORKSPACE_ROOT;
}

/** Resolve a relative path within the workspace, rejecting escapes. */
export function resolveSandboxPath(relativePath: string): string {
  let cleaned = relativePath.replace(/^[/\\]+/, '');

  if (cleaned.includes('..')) {
    const resolved = resolve(WORKSPACE_ROOT, cleaned);
    const rel = relative(WORKSPACE_ROOT, resolved);
    if (rel.startsWith('..') || isAbsolute(rel)) {
      throw new Error(`Path traversal blocked: ${relativePath} resolves outside workspace`);
    }
  }

  const resolved = resolve(WORKSPACE_ROOT, cleaned);
  const rel = relative(WORKSPACE_ROOT, resolved);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`Path escapes workspace root: ${relativePath}`);
  }

  // Check for symlink escape
  if (existsSync(resolved)) {
    try {
      const real = realpathSync(resolved);
      const realRel = relative(WORKSPACE_ROOT, real);
      if (realRel.startsWith('..') || isAbsolute(realRel)) {
        throw new Error(`Symlink escapes workspace root: ${relativePath} -> ${real}`);
      }
    } catch (err) {
      if ((err as Error).message.includes('escapes')) throw err;
    }
  }

  return resolved;
}

/** Read a file from the sandbox. 1MB cap. */
export async function readSandboxed(relativePath: string): Promise<string> {
  const abs = resolveSandboxPath(relativePath);
  if (!existsSync(abs)) throw new Error(`File not found: ${relativePath}`);
  const stat = lstatSync(abs);
  if (stat.isDirectory()) throw new Error(`Path is a directory: ${relativePath}`);
  if (stat.size > 1024 * 1024) throw new Error(`File too large (>1MB): ${relativePath}`);
  return readFileSync(abs, 'utf-8');
}

/** Write a file to the sandbox. 10MB cap. */
export async function writeSandboxed(relativePath: string, content: string): Promise<void> {
  const abs = resolveSandboxPath(relativePath);
  if (content.length > 10 * 1024 * 1024) throw new Error('Content exceeds 10MB cap');
  const dir = dirname(abs);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(abs, content, { encoding: 'utf-8' });
}

/** Edit a file (find-and-replace). */
export async function editSandboxed(relativePath: string, oldString: string, newString: string): Promise<void> {
  const abs = resolveSandboxPath(relativePath);
  if (!existsSync(abs)) throw new Error(`File not found: ${relativePath}`);
  const content = readFileSync(abs, 'utf-8');
  if (!content.includes(oldString)) throw new Error('oldString not found in file');
  const newContent = content.replace(oldString, newString);
  writeFileSync(abs, newContent, { encoding: 'utf-8' });
}

/** List directory contents. */
export async function listSandboxed(relativePath: string): Promise<{
  path: string;
  entries: Array<{ name: string; type: 'file' | 'directory'; size: number }>;
}> {
  const abs = resolveSandboxPath(relativePath);
  if (!existsSync(abs)) throw new Error(`Path not found: ${relativePath}`);
  const stat = lstatSync(abs);
  if (!stat.isDirectory()) {
    return {
      path: relativePath,
      entries: [{ name: relativePath.split('/').pop() || '', type: 'file', size: stat.size }],
    };
  }
  const names = readdirSync(abs);
  const entries = names.map((name) => {
    const full = join(abs, name);
    const s = lstatSync(full);
    return { name, type: s.isDirectory() ? 'directory' as const : 'file' as const, size: s.size };
  });
  return { path: relativePath, entries };
}

/** Delete a file from the sandbox. */
export async function deleteSandboxed(relativePath: string): Promise<void> {
  const abs = resolveSandboxPath(relativePath);
  if (!existsSync(abs)) throw new Error(`File not found: ${relativePath}`);
  const stat = lstatSync(abs);
  if (stat.isDirectory()) throw new Error(`Cannot delete directory: ${relativePath}`);
  unlinkSync(abs);
}

/** Get file stats. */
export async function statSandboxed(relativePath: string): Promise<{
  path: string;
  size: number;
  isDirectory: boolean;
  modified: Date;
  created: Date;
}> {
  const abs = resolveSandboxPath(relativePath);
  if (!existsSync(abs)) throw new Error(`File not found: ${relativePath}`);
  const stat = statSync(abs);
  return {
    path: relativePath,
    size: stat.size,
    isDirectory: stat.isDirectory(),
    modified: stat.mtime,
    created: stat.birthtime,
  };
}
