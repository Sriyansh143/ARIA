// =====================================================================
// image-generator.ts — Generate images via z-ai-web-dev-sdk.
// =====================================================================
// Used by:
//   - /api/chat (inline image generation when user asks for an image)
//   - /api/generate-image (returns URL for chat display)
//
// The z-ai-web-dev-sdk returns base64 image data. We save it to /uploads
// and return a relative URL the chat bubble can render as markdown ![](url).
// =====================================================================

import { logger } from '@/lib/logger'
import { createArtifact } from '@/lib/artifact-helper'
import { randomUUID } from 'crypto'
import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'

export interface ImageGenResult {
  ok: boolean
  imageUrl?: string  // relative URL like /uploads/images/{uuid}.png
  error?: string
  latencyMs: number
  model: string
  prompt: string
}

export type ImageSize =
  | '1024x1024'
  | '768x1344'
  | '864x1152'
  | '1344x768'
  | '1152x864'
  | '1440x720'
  | '720x1440'

// ─── Detect if a user prompt is asking for image generation ──────────
const IMAGE_GEN_TRIGGERS = [
  /^(generate|create|draw|paint|make|render|design)\s+(an?\s+)?(image|picture|photo|illustration|painting|drawing|render|artwork|art|wallpaper|portrait|sketch)\b/i,
  /^(image|picture|photo|illustration|painting|drawing|render|artwork|art|wallpaper|portrait|sketch)\s+of\b/i,
  /\bgenerate\s+(me\s+)?(an?\s+)?(image|picture|photo|illustration)/i,
  /\bdraw\s+(me\s+)?(an?\s+)?/i,
  /\bpaint\s+(me\s+)?(an?\s+)?/i,
  /\bcreate\s+(me\s+)?(an?\s+)?(image|picture|photo)/i,
  /\bmake\s+(me\s+)?(an?\s+)?(image|picture|photo)/i,
  /\b(in\s+hd|hd\s+quality|4k\s+quality|in\s+4k|high\s+definition|ultra\s+realistic|photorealistic|realistic\s+image|hyperrealistic|cinematic\s+lighting)\b/i,
  /\b\w+\s+(realistic|in\s+hd|in\s+4k|photorealistic)\s*$/i,
]

const IMAGE_KEYWORDS = [
  'image of', 'picture of', 'photo of', 'illustration of', 'painting of',
  'drawing of', 'render of', 'artwork of', 'art of', 'portrait of',
  'wallpaper of', 'sketch of',
]

export function detectImageGenerationRequest(prompt: string): { isImageGen: boolean; cleanedPrompt: string } {
  const trimmed = prompt.trim()
  if (!trimmed || trimmed.length < 5) return { isImageGen: false, cleanedPrompt: trimmed }

  for (const re of IMAGE_GEN_TRIGGERS) {
    if (re.test(trimmed)) {
      let cleaned = trimmed
        .replace(/^(generate|create|draw|paint|make|render|design)\s+(me\s+)?(an?\s+)?(image|picture|photo|illustration|painting|drawing|render|artwork|art|wallpaper|portrait|sketch)\s+(of\s+)?/i, '')
        .replace(/^(image|picture|photo|illustration|painting|drawing|render|artwork|art|wallpaper|portrait|sketch)\s+of\s+/i, '')
        .replace(/\b(in\s+hd|hd\s+quality|4k\s+quality|in\s+4k|high\s+definition|ultra\s+realistic|photorealistic|realistic\s+image|hyperrealistic|cinematic\s+lighting)\b/gi, '')
        .trim()
      if (!cleaned) cleaned = trimmed
      return { isImageGen: true, cleanedPrompt: cleaned }
    }
  }

  const lower = trimmed.toLowerCase()
  for (const kw of IMAGE_KEYWORDS) {
    if (lower.includes(kw)) {
      const cleaned = trimmed.replace(/^.*?\b(image|picture|photo|illustration|painting|drawing|render|artwork|art|wallpaper|portrait|sketch)\s+of\s+/i, '').trim()
      return { isImageGen: true, cleanedPrompt: cleaned || trimmed }
    }
  }

  return { isImageGen: false, cleanedPrompt: trimmed }
}

const UPLOAD_DIR = join(process.cwd(), 'uploads', 'images')

function ensureUploadDir(): void {
  try { mkdirSync(UPLOAD_DIR, { recursive: true }) } catch { /* ignore */ }
}

// Lazy-load z-ai SDK (server-only)
let _zai: Awaited<ReturnType<typeof import('z-ai-web-dev-sdk').default.create>> | null = null
async function getZai() {
  if (!_zai) {
    const ZAI = (await import('z-ai-web-dev-sdk')).default
    _zai = await ZAI.create()
  }
  return _zai
}

// ─── Generate an image via z-ai-web-dev-sdk ────────────────────────────
export async function generateImage(
  prompt: string,
  opts?: { size?: ImageSize; model?: string },
): Promise<ImageGenResult> {
  const started = Date.now()
  const model = opts?.model || 'zai-image'
  const size = opts?.size || '1024x1024'

  try {
    const zai = await getZai()
    const response = await zai.images.generations.create({
      prompt,
      size,
    })
    const base64 = response?.data?.[0]?.base64
    if (!base64) {
      return {
        ok: false,
        error: 'z-ai returned no image data',
        latencyMs: Date.now() - started,
        model,
        prompt,
      }
    }

    // Save the base64 image to disk
    ensureUploadDir()
    const filename = `${randomUUID()}.png`
    const filePath = join(UPLOAD_DIR, filename)
    writeFileSync(filePath, Buffer.from(base64, 'base64'))
    const imageUrl = `/uploads/images/${filename}`

    try {
      await createArtifact({
        kind: 'image',
        content: imageUrl,
        metadata: { prompt, model, size, latencyMs: Date.now() - started },
      })
    } catch (e) {
      logger.warn({ err: (e as Error).message }, 'image-gen: failed to log artifact')
    }

    return {
      ok: true,
      imageUrl,
      latencyMs: Date.now() - started,
      model,
      prompt,
    }
  } catch (err) {
    return {
      ok: false,
      error: `Image generation failed: ${err instanceof Error ? err.message : String(err)}`,
      latencyMs: Date.now() - started,
      model,
      prompt,
    }
  }
}

// ─── Fetch the image binary from a URL ────────────────────────────────
export async function fetchImageBuffer(imageUrl: string): Promise<Buffer | null> {
  try {
    const r = await fetch(imageUrl, { signal: AbortSignal.timeout(30_000) })
    if (!r.ok) return null
    const ab = await r.arrayBuffer()
    return Buffer.from(ab)
  } catch {
    return null
  }
}

// ─── Combined multi-provider entry ────────────────────────────────────
// Currently only z-ai is configured. This function exists for API compat
// with the original zip layout (which tried SiliconFlow/Higgsfield/browser).
export async function generateImageAnyProvider(prompt: string): Promise<ImageGenResult> {
  return generateImage(prompt)
}

// ─── List configured providers (for GET /api/generate-image) ──────────
export function getConfiguredImageProviders(): string[] {
  return ['zai']
}
