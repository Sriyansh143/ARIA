/**
 * ide/index.ts — JARVIS IDE backend library.
 *
 * Provides all filesystem + git + lint + project management primitives the
 * IDE UI needs. Backed by Prisma (IdeProject/IdeFile/IdeSession/ActionLog)
 * and the local filesystem via the fs-sandbox module for the workspace root.
 *
 * Design notes:
 *   - Project `rootPath` is an absolute path under the JARVIS workspace root
 *     (see fs-sandbox). All relative file paths in the DB are resolved
 *     against it; we re-use fs-sandbox's traversal-safe resolver.
 *   - On `createProject`, if rootPath exists on disk we scan it once
 *     (respecting .gitignore + skipping node_modules/.next/.git/dist/build)
 *     and create IdeFile rows for up to 500 files.
 *   - Heavy commands (git/tsc/eslint) run via child_process with a 30s
 *     timeout and full try/catch so a single failure can't crash the API.
 */

import { execSync } from 'child_process';
import {
  existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync,
  renameSync, readdirSync, statSync,
} from 'fs';
import { join, relative, dirname, basename, resolve, sep } from 'path';
import { db } from '@/lib/db';
import { getWorkspaceRoot, resolveSandboxPath } from '@/lib/fs-sandbox';

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

export interface CreateProjectInput {
  name: string;
  rootPath: string;
  description?: string;
  language?: string;
  framework?: string;
}

export interface ProjectSummary {
  id: string;
  name: string;
  rootPath: string;
  description: string | null;
  language: string;
  framework: string | null;
  status: string;
  theme: string;
  fontSize: number;
  wordWrap: boolean;
  minimap: boolean;
  autoSave: boolean;
  formatOnSave: boolean;
  linting: boolean;
  tabSize: number;
  gitBranch: string | null;
  gitRemote: string | null;
  lastOpenedAt: string | null;
  createdAt: string;
  fileCount: number;
}

export interface FileMeta {
  id: string;
  projectId: string;
  path: string;
  name: string;
  extension: string;
  language: string;
  size: number;
  lineCount: number;
  isDirty: boolean;
  lastSavedAt: string | null;
  lastSavedBy: string | null;
  gitStatus: string;
  updatedAt: string;
}

export interface FileWithContent extends FileMeta {
  content: string;
}

export interface SearchResult {
  path: string;
  line: number;
  column: number;
  preview: string;
  matchStart: number;
  matchEnd: number;
}

export interface OutlineSymbol {
  name: string;
  type: 'function' | 'class' | 'interface' | 'const' | 'method' | 'type' | 'import';
  line: number;
}

export interface ProblemItem {
  file: string;
  line: number;
  column: number;
  severity: 'error' | 'warning' | 'info';
  message: string;
  code?: string;
}

export interface GitStatusInfo {
  branch: string;
  ahead: number;
  behind: number;
  remote: string;
  modified: number;
  added: number;
  deleted: number;
  untracked: number;
  files: Array<{ path: string; status: string }>;
}

export interface SessionInfo {
  id: string;
  projectId: string;
  agentCodename: string | null;
  openTabs: string[];
  activeTabId: string | null;
  cursor: { fileId?: string; line?: number; col?: number };
  scrollPosition: number;
  lastActiveAt: string;
}

// ────────────────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────────────────

const SCAN_SKIP_DIRS = new Set([
  'node_modules', '.next', '.git', 'dist', 'build', 'out', '.cache',
  '.turbo', '.vercel', 'coverage', '.nuxt', '.output', 'vendor',
]);

const SCAN_MAX_FILES = 500;

const LANG_BY_EXT: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
  mjs: 'javascript', cjs: 'javascript', json: 'json', css: 'css', scss: 'css',
  md: 'markdown', mdx: 'markdown', html: 'html', py: 'python', go: 'go',
  rs: 'rust', java: 'java', c: 'c', cpp: 'cpp', sh: 'bash', yml: 'yaml',
  yaml: 'yaml', toml: 'toml', sql: 'sql', prisma: 'prisma', txt: 'text',
  xml: 'xml', svg: 'xml', env: 'ini', ini: 'ini', log: 'text',
};

const TEXT_EXTS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'json', 'css', 'scss', 'md', 'mdx',
  'html', 'py', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'hpp', 'sh', 'yml', 'yaml',
  'toml', 'sql', 'prisma', 'txt', 'xml', 'svg', 'env', 'ini', 'log', 'gitignore',
  'dockerignore', 'eslintrc', 'prettierrc', 'babelrc',
]);

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

function extOf(name: string): string {
  const m = name.match(/\.([a-zA-Z0-9]+)$/);
  return m ? m[1].toLowerCase() : '';
}

function languageOf(name: string): string {
  const ext = extOf(name);
  if (LANG_BY_EXT[ext]) return LANG_BY_EXT[ext];
  if (name === '.gitignore' || name === '.dockerignore') return 'ini';
  if (name.startsWith('.eslintrc') || name.startsWith('.prettierrc') || name.startsWith('.babelrc')) return 'json';
  return 'text';
}

function isTextFile(name: string): boolean {
  const ext = extOf(name);
  if (TEXT_EXTS.has(ext)) return true;
  if (name.startsWith('.')) return true; // dotfiles typically text
  return false;
}

/**
 * Resolve a project's rootPath to an absolute path. Accepts:
 *   - '' / '.' / 'workspace'  → the JARVIS workspace root itself.
 *   - any other relative path → resolved against the workspace root
 *     (via the fs-sandbox resolver, which rejects escapes).
 *   - absolute path inside the workspace → returned as-is.
 *   - absolute path outside the workspace → returned as-is (best-effort,
 *     the operator may have legitimate reasons).
 */
function resolveProjectRoot(rootPath: string): string {
  if (!rootPath || rootPath === '.' || rootPath === 'workspace') {
    return getWorkspaceRoot();
  }
  if (rootPath.startsWith('/')) {
    const ws = getWorkspaceRoot();
    const rel = relative(ws, rootPath);
    if (rel === '' || (!rel.startsWith('..') && !resolve(rootPath).startsWith('..'))) {
      return rootPath;
    }
    return rootPath;
  }
  return resolveSandboxPath(rootPath);
}

function ensureDir(absPath: string) {
  if (!existsSync(absPath)) mkdirSync(absPath, { recursive: true });
}

/** Run a shell command synchronously with timeout + error capture. */
function runCmd(cmd: string, cwd: string, timeoutMs = 30000): {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
} {
  try {
    const stdout = execSync(cmd, {
      cwd,
      timeout: timeoutMs,
      maxBuffer: 5 * 1024 * 1024,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { ok: true, stdout, stderr: '', exitCode: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; status?: number; message?: string };
    return {
      ok: false,
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? e.message ?? 'exec failed',
      exitCode: e.status ?? null,
    };
  }
}

/** Recursively scan a directory for text files, respecting SCAN_SKIP_DIRS. */
function scanDirForFiles(absRoot: string, rel = ''): string[] {
  const out: string[] = [];
  const dir = join(absRoot, rel);
  if (!existsSync(dir)) return out;
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (out.length >= SCAN_MAX_FILES) break;
    if (name === '.git' || SCAN_SKIP_DIRS.has(name)) continue;
    const childRel = rel ? `${rel}/${name}` : name;
    const childAbs = join(dir, name);
    let st;
    try { st = statSync(childAbs); } catch { continue; }
    if (st.isDirectory()) {
      out.push(...scanDirForFiles(absRoot, childRel));
    } else if (st.isFile() && isTextFile(name) && st.size < 512 * 1024) {
      out.push(childRel);
    }
  }
  return out;
}

/** Read .gitignore and return a Set of patterns (very simple — glob-free). */
function readGitignore(absRoot: string): Set<string> {
  const set = new Set<string>();
  const f = join(absRoot, '.gitignore');
  if (!existsSync(f)) return set;
  try {
    const txt = readFileSync(f, 'utf-8');
    for (const line of txt.split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      set.add(t);
    }
  } catch { /* ignore */ }
  return set;
}

// ────────────────────────────────────────────────────────────────────────────
// Project operations
// ────────────────────────────────────────────────────────────────────────────

export async function createProject(input: CreateProjectInput): Promise<ProjectSummary> {
  const { name, rootPath, description, language = 'typescript', framework } = input;
  const absRoot = resolveProjectRoot(rootPath);
  if (!existsSync(absRoot)) {
    ensureDir(absRoot);
  }

  // Detect framework + git info if available.
  let detectedFramework = framework;
  let gitBranch: string | null = null;
  let gitRemote: string | null = null;
  if (!detectedFramework) {
    if (existsSync(join(absRoot, 'package.json'))) {
      try {
        const pkg = JSON.parse(readFileSync(join(absRoot, 'package.json'), 'utf-8'));
        const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
        if (deps.next) detectedFramework = 'nextjs';
        else if (deps.react) detectedFramework = 'react';
        else if (deps.express) detectedFramework = 'node';
        else detectedFramework = 'node';
      } catch { detectedFramework = 'node'; }
    } else if (existsSync(join(absRoot, 'requirements.txt')) || existsSync(join(absRoot, 'pyproject.toml'))) {
      detectedFramework = 'python';
    } else if (existsSync(join(absRoot, 'go.mod'))) {
      detectedFramework = 'go';
    } else if (existsSync(join(absRoot, 'Cargo.toml'))) {
      detectedFramework = 'rust';
    } else {
      detectedFramework = 'node';
    }
  }
  const branchRes = runCmd('git rev-parse --abbrev-ref HEAD 2>/dev/null', absRoot, 5000);
  if (branchRes.ok && branchRes.stdout.trim()) gitBranch = branchRes.stdout.trim();
  const remoteRes = runCmd('git remote get-url origin 2>/dev/null', absRoot, 5000);
  if (remoteRes.ok && remoteRes.stdout.trim()) gitRemote = remoteRes.stdout.trim();

  const project = await db.ideProject.create({
    data: {
      name,
      rootPath,
      description: description ?? null,
      language,
      framework: detectedFramework ?? null,
      gitBranch,
      gitRemote,
      lastOpenedAt: new Date(),
    },
  });

  // Scan disk for existing files.
  const ignore = readGitignore(absRoot);
  const files = scanDirForFiles(absRoot);
  let created = 0;
  for (const rel of files) {
    if (created >= SCAN_MAX_FILES) break;
    const parts = rel.split('/');
    if (parts.some((p) => ignore.has(p))) continue;
    const abs = join(absRoot, rel);
    let content = '';
    let size = 0;
    try {
      const buf = readFileSync(abs);
      size = buf.length;
      content = buf.toString('utf-8');
    } catch { continue; }
    const name = basename(rel);
    const ext = extOf(name);
    const lineCount = content ? content.split('\n').length : 0;
    await db.ideFile.create({
      data: {
        projectId: project.id,
        path: rel,
        name,
        extension: ext || 'txt',
        language: languageOf(name),
        content,
        size,
        lineCount,
        gitStatus: 'unchanged',
        isDirty: false,
      },
    });
    created++;
  }

  // Initial session
  await db.ideSession.create({
    data: { projectId: project.id, agentCodename: null },
  });

  return getProjectSummary(project.id);
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const rows = await db.ideProject.findMany({
    orderBy: { lastOpenedAt: 'desc' },
    include: { _count: { select: { files: true } } },
  });
  return rows.map((r) => ({
    id: r.id, name: r.name, rootPath: r.rootPath, description: r.description,
    language: r.language, framework: r.framework, status: r.status,
    theme: r.theme, fontSize: r.fontSize, wordWrap: r.wordWrap, minimap: r.minimap,
    autoSave: r.autoSave, formatOnSave: r.formatOnSave, linting: r.linting, tabSize: r.tabSize,
    gitBranch: r.gitBranch, gitRemote: r.gitRemote,
    lastOpenedAt: r.lastOpenedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
    fileCount: r._count.files,
  }));
}

export async function getProjectSummary(id: string): Promise<ProjectSummary> {
  const r = await db.ideProject.findUnique({
    where: { id },
    include: { _count: { select: { files: true } } },
  });
  if (!r) throw new Error('Project not found');
  return {
    id: r.id, name: r.name, rootPath: r.rootPath, description: r.description,
    language: r.language, framework: r.framework, status: r.status,
    theme: r.theme, fontSize: r.fontSize, wordWrap: r.wordWrap, minimap: r.minimap,
    autoSave: r.autoSave, formatOnSave: r.formatOnSave, linting: r.linting, tabSize: r.tabSize,
    gitBranch: r.gitBranch, gitRemote: r.gitRemote,
    lastOpenedAt: r.lastOpenedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
    fileCount: r._count.files,
  };
}

export interface ProjectDetail extends ProjectSummary {
  files: FileMeta[];
}

export async function getProject(id: string): Promise<ProjectDetail> {
  const proj = await getProjectSummary(id);
  const files = await db.ideFile.findMany({
    where: { projectId: id },
    orderBy: [{ path: 'asc' }],
    select: {
      id: true, projectId: true, path: true, name: true, extension: true,
      language: true, size: true, lineCount: true, isDirty: true,
      lastSavedAt: true, lastSavedBy: true, gitStatus: true, updatedAt: true,
    },
  });
  const gitMap = await getGitStatusMap(id);
  const fileMetas: FileMeta[] = files.map((f) => ({
    ...f,
    lastSavedAt: f.lastSavedAt?.toISOString() ?? null,
    updatedAt: f.updatedAt.toISOString(),
    gitStatus: gitMap.get(f.path) ?? f.gitStatus,
  }));
  return { ...proj, files: fileMetas };
}

export async function deleteProject(id: string): Promise<{ ok: true }> {
  await db.ideProject.delete({ where: { id } });
  return { ok: true };
}

/** Update editor prefs on a project. */
export async function updateProjectSettings(id: string, settings: Partial<{
  theme: string;
  fontSize: number;
  wordWrap: boolean;
  minimap: boolean;
  autoSave: boolean;
  formatOnSave: boolean;
  linting: boolean;
  tabSize: number;
}>): Promise<ProjectSummary> {
  const data: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(settings)) {
    if (v !== undefined) data[k] = v;
  }
  await db.ideProject.update({ where: { id }, data });
  return getProjectSummary(id);
}

// ────────────────────────────────────────────────────────────────────────────
// File operations
// ────────────────────────────────────────────────────────────────────────────

async function absPathFor(projectId: string, relPath: string): Promise<string> {
  const p = await db.ideProject.findUnique({ where: { id: projectId }, select: { rootPath: true } });
  if (!p) throw new Error('Project not found');
  const root = resolveProjectRoot(p.rootPath);
  // Reuse the sandbox path resolver against the project root.
  // We resolve manually here since each project has its own root.
  const cleaned = relPath.replace(/^[/\\]+/, '');
  const abs = resolve(root, cleaned);
  const rel = relative(root, abs);
  if (rel.startsWith('..') || resolve(rel) === rel && rel.startsWith('/')) {
    throw new Error(`Path escapes project root: ${relPath}`);
  }
  return abs;
}

export async function openFile(projectId: string, filePath: string): Promise<FileWithContent> {
  const abs = await absPathFor(projectId, filePath);
  let content = '';
  let size = 0;
  if (existsSync(abs)) {
    try {
      const buf = readFileSync(abs);
      size = buf.length;
      content = buf.toString('utf-8');
    } catch { /* fall back to db */ }
  }
  const name = basename(filePath);
  const ext = extOf(name);
  const lineCount = content ? content.split('\n').length : 0;

  const existing = await db.ideFile.findFirst({ where: { projectId, path: filePath } });
  let file;
  if (existing) {
    file = await db.ideFile.update({
      where: { id: existing.id },
      data: {
        content,
        size,
        lineCount,
        isDirty: false,
      },
    });
  } else {
    file = await db.ideFile.create({
      data: {
        projectId,
        path: filePath,
        name,
        extension: ext || 'txt',
        language: languageOf(name),
        content,
        size,
        lineCount,
        gitStatus: 'unchanged',
      },
    });
  }

  await db.ideProject.update({ where: { id: projectId }, data: { lastOpenedAt: new Date() } });

  return {
    ...file,
    lastSavedAt: file.lastSavedAt?.toISOString() ?? null,
    updatedAt: file.updatedAt.toISOString(),
  };
}

export async function getFile(fileId: string): Promise<FileWithContent> {
  const f = await db.ideFile.findUnique({ where: { id: fileId } });
  if (!f) throw new Error('File not found');
  return {
    ...f,
    lastSavedAt: f.lastSavedAt?.toISOString() ?? null,
    updatedAt: f.updatedAt.toISOString(),
  };
}

export async function saveFile(fileId: string, content: string, savedBy = 'operator'): Promise<FileWithContent> {
  const f = await db.ideFile.findUnique({ where: { id: fileId } });
  if (!f) throw new Error('File not found');
  const abs = await absPathFor(f.projectId, f.path);
  const before = f.content;
  const dir = dirname(abs);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(abs, content, 'utf-8');
  const size = Buffer.byteLength(content, 'utf-8');
  const lineCount = content ? content.split('\n').length : 0;
  const updated = await db.ideFile.update({
    where: { id: fileId },
    data: {
      content,
      size,
      lineCount,
      isDirty: false,
      lastSavedAt: new Date(),
      lastSavedBy: savedBy,
    },
  });

  try {
    await db.actionLog.create({
      data: {
        actor: savedBy,
        action: 'ide.file.save',
        category: 'file',
        target: `file:${f.path}`,
        beforeState: JSON.stringify({ content: before.slice(0, 4096), size: before.length }),
        afterState: JSON.stringify({ content: content.slice(0, 4096), size }),
        reversible: true,
        meta: JSON.stringify({ projectId: f.projectId, fileId }),
      },
    });
  } catch { /* ActionLog optional */ }

  return {
    ...updated,
    lastSavedAt: updated.lastSavedAt!.toISOString(),
    updatedAt: updated.updatedAt.toISOString(),
  };
}

export async function createFile(projectId: string, path: string, content = ''): Promise<FileWithContent> {
  const cleanPath = path.replace(/^[/\\]+/, '');
  const abs = await absPathFor(projectId, cleanPath);
  const dir = dirname(abs);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  if (!existsSync(abs)) writeFileSync(abs, content, 'utf-8');
  const name = basename(cleanPath);
  const ext = extOf(name);
  const size = Buffer.byteLength(content, 'utf-8');
  const lineCount = content ? content.split('\n').length : 0;

  const existing = await db.ideFile.findFirst({ where: { projectId, path: cleanPath } });
  let file;
  if (existing) {
    file = await db.ideFile.update({
      where: { id: existing.id },
      data: { content, size, lineCount, isDirty: false, lastSavedAt: new Date() },
    });
  } else {
    file = await db.ideFile.create({
      data: {
        projectId,
        path: cleanPath,
        name,
        extension: ext || 'txt',
        language: languageOf(name),
        content,
        size,
        lineCount,
        gitStatus: 'untracked',
      },
    });
  }

  try {
    await db.actionLog.create({
      data: {
        actor: 'operator',
        action: 'ide.file.create',
        category: 'file',
        target: `file:${cleanPath}`,
        beforeState: null,
        afterState: JSON.stringify({ content: content.slice(0, 4096), size }),
        reversible: true,
        meta: JSON.stringify({ projectId, fileId: file.id }),
      },
    });
  } catch { /* ignore */ }

  return {
    ...file,
    lastSavedAt: file.lastSavedAt?.toISOString() ?? null,
    updatedAt: file.updatedAt.toISOString(),
  };
}

export async function deleteFile(fileId: string): Promise<{ ok: true }> {
  const f = await db.ideFile.findUnique({ where: { id: fileId } });
  if (!f) return { ok: true };
  const abs = await absPathFor(f.projectId, f.path);
  if (existsSync(abs)) {
    try { unlinkSync(abs); } catch { /* ignore */ }
  }
  try {
    await db.actionLog.create({
      data: {
        actor: 'operator',
        action: 'ide.file.delete',
        category: 'destructive',
        target: `file:${f.path}`,
        beforeState: JSON.stringify({ content: f.content.slice(0, 4096), size: f.size }),
        afterState: null,
        reversible: true,
        meta: JSON.stringify({ projectId: f.projectId, fileId }),
      },
    });
  } catch { /* ignore */ }
  await db.ideFile.delete({ where: { id: fileId } });
  return { ok: true };
}

export async function renameFile(fileId: string, newPath: string): Promise<FileWithContent> {
  const f = await db.ideFile.findUnique({ where: { id: fileId } });
  if (!f) throw new Error('File not found');
  const cleanPath = newPath.replace(/^[/\\]+/, '');
  const oldAbs = await absPathFor(f.projectId, f.path);
  const newAbs = await absPathFor(f.projectId, cleanPath);
  const dir = dirname(newAbs);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  if (existsSync(oldAbs)) {
    try { renameSync(oldAbs, newAbs); } catch { /* ignore */ }
  }
  const name = basename(cleanPath);
  const ext = extOf(name);
  const updated = await db.ideFile.update({
    where: { id: fileId },
    data: {
      path: cleanPath,
      name,
      extension: ext || 'txt',
      language: languageOf(name),
    },
  });
  return {
    ...updated,
    lastSavedAt: updated.lastSavedAt?.toISOString() ?? null,
    updatedAt: updated.updatedAt.toISOString(),
  };
}

export async function createFolder(projectId: string, path: string): Promise<{ ok: true }> {
  const cleanPath = path.replace(/^[/\\]+/, '').replace(/\/+$/, '');
  const abs = await absPathFor(projectId, cleanPath);
  ensureDir(abs);
  const keep = join(abs, '.gitkeep');
  if (!existsSync(keep)) writeFileSync(keep, '', 'utf-8');
  return { ok: true };
}

// ────────────────────────────────────────────────────────────────────────────
// Search across files
// ────────────────────────────────────────────────────────────────────────────

export async function searchInFiles(
  projectId: string,
  query: string,
  opts: { useRegex?: boolean; caseSensitive?: boolean; filePattern?: string } = {},
): Promise<SearchResult[]> {
  if (!query) return [];
  const project = await db.ideProject.findUnique({ where: { id: projectId }, select: { rootPath: true } });
  if (!project) throw new Error('Project not found');
  const root = resolveProjectRoot(project.rootPath);
  const files = scanDirForFiles(root).slice(0, 500);
  const results: SearchResult[] = [];

  let matcher: RegExp;
  try {
    if (opts.useRegex) {
      matcher = new RegExp(query, opts.caseSensitive ? 'g' : 'gi');
    } else {
      const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      matcher = new RegExp(escaped, opts.caseSensitive ? 'g' : 'gi');
    }
  } catch {
    return [];
  }

  const pattern = opts.filePattern ?? '';
  const fileMatcher = pattern ? new RegExp(pattern, 'i') : null;

  const MAX_RESULTS = 200;
  for (const rel of files) {
    if (results.length >= MAX_RESULTS) break;
    if (fileMatcher && !fileMatcher.test(rel)) continue;
    const abs = join(root, rel);
    let content: string;
    try { content = readFileSync(abs, 'utf-8'); } catch { continue; }
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (results.length >= MAX_RESULTS) break;
      const line = lines[i];
      matcher.lastIndex = 0;
      const m = matcher.exec(line);
      if (m) {
        results.push({
          path: rel,
          line: i + 1,
          column: m.index + 1,
          preview: line.length > 300 ? line.slice(0, 300) + '…' : line,
          matchStart: m.index,
          matchEnd: m.index + m[0].length,
        });
      }
    }
  }
  return results;
}

// ────────────────────────────────────────────────────────────────────────────
// Git operations
// ────────────────────────────────────────────────────────────────────────────

/** Returns true if the directory is inside a git work tree (walks up parents). */
function isInsideGitRepo(root: string): boolean {
  const res = runCmd('git rev-parse --is-inside-work-tree 2>/dev/null', root, 3000);
  return res.ok && res.stdout.trim() === 'true';
}

async function getGitStatusMap(projectId: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const project = await db.ideProject.findUnique({ where: { id: projectId }, select: { rootPath: true } });
  if (!project) return map;
  const root = resolveProjectRoot(project.rootPath);
  if (!isInsideGitRepo(root)) return map;
  const res = runCmd('git status --porcelain', root, 8000);
  if (!res.ok) return map;
  for (const line of res.stdout.split('\n')) {
    if (line.length < 4) continue;
    const xy = line.slice(0, 2);
    const path = line.slice(3).trim().replace(/^"(.*)"$/, '$1');
    let status = 'unchanged';
    const a = xy[0], b = xy[1];
    if (a === '?' && b === '?') status = 'untracked';
    else if (a === 'A' || b === 'A') status = 'added';
    else if (a === 'D' || b === 'D') status = 'deleted';
    else if (a === 'M' || b === 'M' || a === 'R' || b === 'R' || a === 'C' || b === 'C') status = 'modified';
    else if (a === 'U' || b === 'U') status = 'untracked';
    map.set(path, status);
  }
  return map;
}

export async function getGitStatus(projectId: string): Promise<GitStatusInfo> {
  const project = await db.ideProject.findUnique({ where: { id: projectId }, select: { rootPath: true } });
  if (!project) throw new Error('Project not found');
  const root = resolveProjectRoot(project.rootPath);

  const empty: GitStatusInfo = {
    branch: '', ahead: 0, behind: 0, remote: '',
    modified: 0, added: 0, deleted: 0, untracked: 0,
    files: [],
  };
  if (!isInsideGitRepo(root)) return empty;

  const branchRes = runCmd('git rev-parse --abbrev-ref HEAD', root, 5000);
  const branch = branchRes.ok ? branchRes.stdout.trim() : '';
  const remoteRes = runCmd('git config --get remote.origin.url', root, 5000);
  const remote = remoteRes.ok ? remoteRes.stdout.trim() : '';
  const aheadBehindRes = runCmd('git rev-list --left-right --count @{u}...HEAD 2>/dev/null', root, 5000);
  let ahead = 0, behind = 0;
  if (aheadBehindRes.ok && aheadBehindRes.stdout.includes('\t')) {
    const [b, a] = aheadBehindRes.stdout.trim().split('\t').map((x) => parseInt(x, 10) || 0);
    behind = b; ahead = a;
  }

  const statusRes = runCmd('git status --porcelain', root, 8000);
  const files: Array<{ path: string; status: string }> = [];
  let modified = 0, added = 0, deleted = 0, untracked = 0;
  if (statusRes.ok) {
    for (const line of statusRes.stdout.split('\n')) {
      if (line.length < 4) continue;
      const xy = line.slice(0, 2);
      const path = line.slice(3).trim().replace(/^"(.*)"$/, '$1');
      let status = 'modified';
      const a = xy[0], b = xy[1];
      if (a === '?' && b === '?') { status = 'untracked'; untracked++; }
      else if (a === 'A' || b === 'A') { status = 'added'; added++; }
      else if (a === 'D' || b === 'D') { status = 'deleted'; deleted++; }
      else if (a === 'M' || b === 'M') { status = 'modified'; modified++; }
      else { status = 'modified'; modified++; }
      files.push({ path, status });
    }
  }

  return { branch, ahead, behind, remote, modified, added, deleted, untracked, files };
}

export async function getGitDiff(projectId: string, opts: { staged?: boolean } = {}): Promise<string> {
  const project = await db.ideProject.findUnique({ where: { id: projectId }, select: { rootPath: true } });
  if (!project) throw new Error('Project not found');
  const root = resolveProjectRoot(project.rootPath);
  if (!isInsideGitRepo(root)) return '';
  const cmd = opts.staged ? 'git diff --staged' : 'git diff';
  const res = runCmd(cmd, root, 15000);
  return res.stdout || res.stderr || '';
}

// ────────────────────────────────────────────────────────────────────────────
// Symbol outline
// ────────────────────────────────────────────────────────────────────────────

const OUTLINE_PATTERNS: Array<{ type: OutlineSymbol['type']; re: RegExp }> = [
  { type: 'import', re: /^\s*import\s+(?:\*\s+as\s+\w+|\{[^}]+\}|\w+(?:\s*,\s*\{[^}]+\})?|\w+\s+from)\s+['"]/ },
  { type: 'class', re: /^\s*(?:export\s+default\s+)?(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/ },
  { type: 'interface', re: /^\s*(?:export\s+)?interface\s+(\w+)/ },
  { type: 'type', re: /^\s*(?:export\s+)?type\s+(\w+)\s*=/ },
  { type: 'function', re: /^\s*(?:export\s+default\s+)?(?:export\s+)?(?:async\s+)?function\s*\*?\s+(\w+)/ },
  { type: 'const', re: /^\s*(?:export\s+)?const\s+(\w+)\s*[:=]/ },
  { type: 'method', re: /^\s+(?:public\s+|private\s+|protected\s+|static\s+|async\s+|readonly\s+)*(\w+)\s*\(/ },
];

export async function getOutline(fileId: string): Promise<OutlineSymbol[]> {
  const f = await getFile(fileId);
  const lines = f.content.split('\n');
  const out: OutlineSymbol[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const { type, re } of OUTLINE_PATTERNS) {
      const m = line.match(re);
      if (m) {
        const name = m[1] || '(anonymous)';
        out.push({ name, type, line: i + 1 });
        break;
      }
    }
  }
  return out;
}

// ────────────────────────────────────────────────────────────────────────────
// Problems (lint / typecheck)
// ────────────────────────────────────────────────────────────────────────────

export async function getProblems(projectId: string): Promise<ProblemItem[]> {
  const project = await db.ideProject.findUnique({ where: { id: projectId }, select: { rootPath: true } });
  if (!project) throw new Error('Project not found');
  const root = resolveProjectRoot(project.rootPath);
  const problems: ProblemItem[] = [];

  if (existsSync(join(root, 'tsconfig.json'))) {
    const tscRes = runCmd('npx --no-install tsc --noEmit --pretty false 2>&1', root, 30000);
    const text = (tscRes.stdout + (tscRes.stderr || '')).trim();
    if (text) {
      for (const line of text.split('\n')) {
        const m = line.match(/^(.+?)\((\d+),(\d+)\):\s+(error|warning)\s+(TS\d+):\s+(.+)$/);
        if (m) {
          problems.push({
            file: relative(root, resolve(m[1])).split(sep).join('/'),
            line: parseInt(m[2], 10),
            column: parseInt(m[3], 10),
            severity: m[4] as 'error' | 'warning',
            code: m[5],
            message: m[6],
          });
        }
      }
    }
  }

  if (existsSync(join(root, '.eslintrc')) || existsSync(join(root, '.eslintrc.json'))
      || existsSync(join(root, '.eslintrc.js')) || existsSync(join(root, '.eslintrc.cjs'))
      || existsSync(join(root, 'eslint.config.js')) || existsSync(join(root, 'eslint.config.mjs'))) {
    const eslintRes = runCmd('npx --no-install eslint --format json . 2>&1', root, 30000);
    try {
      const json = JSON.parse(eslintRes.stdout);
      if (Array.isArray(json)) {
        for (const file of json) {
          const filePath = relative(root, resolve(file.filePath)).split(sep).join('/');
          if (file.messages && Array.isArray(file.messages)) {
            for (const msg of file.messages) {
              problems.push({
                file: filePath,
                line: msg.line || 1,
                column: msg.column || 1,
                severity: msg.severity === 2 ? 'error' : 'warning',
                message: msg.message,
                code: msg.ruleId || undefined,
              });
            }
          }
        }
      }
    } catch { /* non-JSON eslint output — ignore */ }
  }

  return problems.slice(0, 500);
}

// ────────────────────────────────────────────────────────────────────────────
// Sessions
// ────────────────────────────────────────────────────────────────────────────

export async function listSessions(projectId: string): Promise<SessionInfo[]> {
  const rows = await db.ideSession.findMany({
    where: { projectId },
    orderBy: { lastActiveAt: 'desc' },
  });
  return rows.map((r) => ({
    id: r.id,
    projectId: r.projectId,
    agentCodename: r.agentCodename,
    openTabs: safeParseArr(r.openTabs),
    activeTabId: r.activeTabId,
    cursor: safeParseObj(r.cursor),
    scrollPosition: r.scrollPosition,
    lastActiveAt: r.lastActiveAt.toISOString(),
  }));
}

export async function updateSession(sessionId: string, update: Partial<{
  openTabs: string[];
  activeTabId: string | null;
  cursor: { fileId?: string; line?: number; col?: number };
  scrollPosition: number;
}>): Promise<SessionInfo> {
  const data: Record<string, unknown> = { lastActiveAt: new Date() };
  if (update.openTabs !== undefined) data.openTabs = JSON.stringify(update.openTabs);
  if (update.activeTabId !== undefined) data.activeTabId = update.activeTabId;
  if (update.cursor !== undefined) data.cursor = JSON.stringify(update.cursor);
  if (update.scrollPosition !== undefined) data.scrollPosition = update.scrollPosition;
  const r = await db.ideSession.update({ where: { id: sessionId }, data });
  return {
    id: r.id,
    projectId: r.projectId,
    agentCodename: r.agentCodename,
    openTabs: safeParseArr(r.openTabs),
    activeTabId: r.activeTabId,
    cursor: safeParseObj(r.cursor),
    scrollPosition: r.scrollPosition,
    lastActiveAt: r.lastActiveAt.toISOString(),
  };
}

export async function createSession(projectId: string, agentCodename?: string | null): Promise<SessionInfo> {
  const r = await db.ideSession.create({ data: { projectId, agentCodename: agentCodename ?? null } });
  return {
    id: r.id,
    projectId: r.projectId,
    agentCodename: r.agentCodename,
    openTabs: [],
    activeTabId: null,
    cursor: {},
    scrollPosition: 0,
    lastActiveAt: r.lastActiveAt.toISOString(),
  };
}

// ────────────────────────────────────────────────────────────────────────────
// JSON helpers
// ────────────────────────────────────────────────────────────────────────────

function safeParseArr(s: string): string[] {
  try { const v = JSON.parse(s); return Array.isArray(v) ? v : []; } catch { return []; }
}

function safeParseObj(s: string): Record<string, unknown> {
  try { return JSON.parse(s) || {}; } catch { return {}; }
}
