// Helper to create an Artifact record matching our Prisma schema.
// The Artifact model: id, name, type ('file'|'report'|'image'|'code'|'dataset'), size, meta (JSON), createdAt.
// We store image/audio/video URLs and text content in `meta` (JSON) with the
// prompt, model, latency, etc. `name` is a short filename-style string.

import { db } from '@/lib/db'
import { logger } from '@/lib/logger'

export interface ArtifactCreateOpts {
  kind: 'image' | 'audio' | 'video' | 'text' | 'code'
  content: string  // URL, markdown, or text content
  metadata?: Record<string, unknown>  // prompt, model, latencyMs, etc.
  taskId?: string
  agentId?: string
}

export async function createArtifact(opts: ArtifactCreateOpts): Promise<string | null> {
  try {
    const name = (String(opts.metadata?.prompt || opts.content || 'artifact')).slice(0, 200)
    const meta = {
      kind: opts.kind,
      content: opts.content,
      taskId: opts.taskId ?? null,
      agentId: opts.agentId ?? null,
      createdAt: new Date().toISOString(),
      ...(opts.metadata ?? {}),
    }
    const record = await db.artifact.create({
      data: {
        name,
        type: opts.kind,
        size: 0,
        meta: JSON.stringify(meta),
      },
    })
    return record.id
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'artifact: failed to create record (non-fatal)')
    return null
  }
}
