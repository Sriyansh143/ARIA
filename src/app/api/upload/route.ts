import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import crypto from 'node:crypto';
import path from 'node:path';
import { promises as fs } from 'node:fs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BYTES = 50 * 1024 * 1024; // 50MB
const ALLOWED_SCOPES = new Set(['memory', 'skill', 'plugin', 'knowledge', 'learning']);

const UPLOAD_ROOT = path.resolve(process.cwd(), 'uploads');

function safeExt(filename: string): string {
  const ext = path.extname(filename || '').toLowerCase().replace(/^\./, '');
  // Allow common file extensions; reject path traversal or empty.
  if (!ext || ext.length > 16 || /[\\/:*?"<>|]/.test(ext)) return 'bin';
  return ext;
}

async function ensureScopeDir(scope: string): Promise<string> {
  if (!ALLOWED_SCOPES.has(scope)) {
    throw new Error(`Invalid scope: ${scope}`);
  }
  const dir = path.join(UPLOAD_ROOT, scope);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

/** GET /api/upload?scope=memory — list recent uploads for a scope. */
export async function GET(req: NextRequest) {
  const scope = req.nextUrl.searchParams.get('scope') ?? 'memory';
  if (!ALLOWED_SCOPES.has(scope)) {
    return NextResponse.json({ error: 'Invalid scope' }, { status: 400 });
  }
  const artifacts = await db.artifact.findMany({
    where: { type: 'file', meta: { contains: `"scope":"${scope}"` } },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });
  return NextResponse.json({ items: artifacts });
}

/** POST /api/upload — multipart upload (file + scope + meta). */
export async function POST(req: NextRequest) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Multipart form-data required' }, { status: 400 });
  }

  const file = form.get('file');
  const scope = (form.get('scope') as string | null) ?? 'memory';
  const title = (form.get('title') as string | null) ?? '';
  const description = (form.get('description') as string | null) ?? '';

  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'file field required' }, { status: 400 });
  }
  if (!ALLOWED_SCOPES.has(scope)) {
    return NextResponse.json({ error: `Invalid scope: ${scope}` }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: 'Empty file' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `File too large (${file.size} bytes > ${MAX_BYTES} bytes / 50MB)` },
      { status: 413 },
    );
  }

  const ext = safeExt(file.name);
  const id = crypto.randomUUID();
  const dir = await ensureScopeDir(scope);
  const filename = `${id}.${ext}`;
  const filepath = path.join(dir, filename);

  // Persist bytes to disk.
  try {
    const buf = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(filepath, buf);
  } catch (e) {
    return NextResponse.json(
      { error: `Failed to write file: ${e instanceof Error ? e.message : 'unknown'}` },
      { status: 500 },
    );
  }

  // Record metadata in the Artifact table.
  const meta = {
    scope,
    originalName: file.name,
    mime: file.type || 'application/octet-stream',
    ext,
    title,
    description,
    path: filepath,
    url: `/uploads/${scope}/${filename}`,
  };
  const artifact = await db.artifact.create({
    data: {
      name: title || file.name,
      type: 'file',
      size: file.size,
      meta: JSON.stringify(meta),
    },
  });

  return NextResponse.json({ artifact, meta });
}

/** DELETE /api/upload?id=... — remove an upload from disk + DB. */
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id query required' }, { status: 400 });
  const artifact = await db.artifact.findUnique({ where: { id } });
  if (!artifact) return NextResponse.json({ error: 'not found' }, { status: 404 });

  let meta: { path?: string; url?: string; scope?: string } = {};
  try {
    meta = JSON.parse(artifact.meta || '{}');
  } catch {
    meta = {};
  }
  if (meta.path) {
    try {
      await fs.unlink(meta.path);
    } catch {
      /* best-effort */
    }
  }
  await db.artifact.delete({ where: { id } });
  return NextResponse.json({ deleted: id });
}
