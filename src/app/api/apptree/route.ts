import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

interface TreeNode {
  name: string;
  path: string;
  type: 'dir' | 'file';
  size?: number;
  children?: TreeNode[];
}

const EXCLUDE = new Set([
  'node_modules',
  '.next',
  '.git',
  '.turbo',
  '.cache',
  'dist',
  'build',
  'out',
  'coverage',
  '.pnp',
  '.yarn',
  'tool-results',
  'rollback-snapshots',
  'download',
]);

const MAX_DEPTH = 4;
const MAX_FILES_PER_DIR = 200;

async function walk(absDir: string, relDir: string, depth: number): Promise<TreeNode[]> {
  if (depth >= MAX_DEPTH) return [];
  let entries: import('fs').Dirent[];
  try {
    entries = await fs.readdir(absDir, { withFileTypes: true });
  } catch {
    return [];
  }
  // Filter excluded + hidden dotfiles at top level.
  const visible = entries.filter((e) => {
    if (EXCLUDE.has(e.name)) return false;
    if (e.name.startsWith('.')) return false;
    return true;
  });
  // Sort dirs first, then files, alphabetical.
  visible.sort((a, b) => {
    if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  const out: TreeNode[] = [];
  let count = 0;
  for (const e of visible) {
    if (count >= MAX_FILES_PER_DIR) break;
    count += 1;
    const childAbs = path.join(absDir, e.name);
    const childRel = relDir ? `${relDir}/${e.name}` : e.name;
    if (e.isDirectory()) {
      const children = await walk(childAbs, childRel, depth + 1);
      out.push({ name: e.name, path: childRel, type: 'dir', children });
    } else {
      let size: number | undefined;
      try {
        const stat = await fs.stat(childAbs);
        size = stat.size;
      } catch {
        // ignore
      }
      out.push({ name: e.name, path: childRel, type: 'file', size });
    }
  }
  return out;
}

// GET /api/apptree — return the project file tree.
export async function GET(_req: NextRequest) {
  const root = process.cwd();
  const children = await walk(root, '', 0);
  const tree: TreeNode = {
    name: path.basename(root) || 'project',
    path: '',
    type: 'dir',
    children,
  };
  return NextResponse.json({ tree, root: path.basename(root) });
}

// GET /api/apptree?file=<path> — return first 20 lines of a file.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const filePath = body.file;
  if (!filePath || typeof filePath !== 'string') {
    return NextResponse.json({ error: 'file required' }, { status: 400 });
  }
  // Resolve safely inside project root.
  const root = process.cwd();
  const abs = path.resolve(root, filePath);
  if (!abs.startsWith(root)) {
    return NextResponse.json({ error: 'outside project root' }, { status: 400 });
  }
  try {
    const stat = await fs.stat(abs);
    if (stat.isDirectory()) {
      return NextResponse.json({ error: 'is a directory' }, { status: 400 });
    }
    if (stat.size > 1024 * 1024) {
      // Skip large files.
      return NextResponse.json({ path: filePath, size: stat.size, lines: [], truncated: true });
    }
    const content = await fs.readFile(abs, 'utf8');
    const allLines = content.split('\n');
    const lines = allLines.slice(0, 20);
    return NextResponse.json({
      path: filePath,
      size: stat.size,
      lines,
      totalLines: allLines.length,
      truncated: allLines.length > 20,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
