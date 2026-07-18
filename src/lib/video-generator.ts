// =====================================================================
// video-generator.ts — Local video generation via ComfyUI (SVD).
// =====================================================================
// Submits an image-to-video workflow to a local ComfyUI instance and
// polls for completion. Used as a local-first alternative to SiliconFlow
// Wan 2.2 (cloud) so operators with a GPU can generate short video clips
// without sending the source image to a third party.
//
// ComfyUI API (https://github.com/comfyanonymous/ComfyUI):
//   - GET  {base}/system_stats            → health check
//   - POST {base}/upload/image            → upload input image (multipart)
//   - POST {base}/prompt                  → submit workflow, returns { prompt_id }
//   - GET  {base}/history/{prompt_id}     → status + output filenames
//   - GET  {base}/view?filename=...       → fetch generated file bytes
//
// Stable Video Diffusion (SVD) workflow:
//   LoadImage → SVD_img2vid_Conditioner → KSampler(svd.safetensors)
//            → VAE Decode → SaveAnimatedWEBP
//
// SVD is image-to-video only (no text-to-video). The caller must supply
// an input image (URL, data URL, or base64 string). The `prompt`
// parameter is accepted for API parity with SiliconFlow Wan 2.2 but is
// ignored by SVD itself.
//
// Configuration:
//   COMFYUI_BASE_URL  — e.g. http://127.0.0.1:8188 (default if unset on
//                       the call path; isComfyUIConfigured() returns
//                       false unless this env var is set, so the route
//                       only routes here when the operator opts in).
// =====================================================================

import { logger } from '@/lib/logger'
import { createArtifact } from '@/lib/artifact-helper'

// Inline SSRF guard (replaces @/lib/ssrf-guard dependency).
// Blocks private/loopback/link-local ranges so a user-supplied image URL
// can't be used to exfiltrate data from internal services.
class SsrfError extends Error { constructor(m: string) { super(m); this.name = 'SsrfError' } }

async function assertSafeUrl(rawUrl: string): Promise<void> {
  let u: URL
  try { u = new URL(rawUrl) } catch { throw new SsrfError('invalid URL') }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new SsrfError(`disallowed protocol: ${u.protocol}`)
  }
  const host = u.hostname.toLowerCase()
  // Block obvious internal hostnames
  if (host === 'localhost' || host === 'metadata.google.internal') {
    throw new SsrfError(`blocked host: ${host}`)
  }
  // Block IPv4 private/loopback/link-local
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (ipv4) {
    const [a, b] = ipv4.slice(1).map(Number)
    if (a === 10) throw new SsrfError(`blocked private IP: ${host}`)
    if (a === 127) throw new SsrfError(`blocked loopback IP: ${host}`)
    if (a === 169 && b === 254) throw new SsrfError(`blocked link-local IP: ${host}`)
    if (a === 172 && b >= 16 && b <= 31) throw new SsrfError(`blocked private IP: ${host}`)
    if (a === 192 && b === 168) throw new SsrfError(`blocked private IP: ${host}`)
    if (a === 0) throw new SsrfError(`blocked reserved IP: ${host}`)
  }
  // Block IPv6 loopback + link-local
  if (host === '::1' || host === 'fe80::' || host.startsWith('fe80:')) {
    throw new SsrfError(`blocked IPv6 internal address: ${host}`)
  }
  // For hostnames that aren't IPs, we trust DNS resolution (full DNS
  // rebind protection requires a custom agent — out of scope here).
}

export interface LocalVideoResult {
  ok: boolean
  videoUrl?: string // URL on the ComfyUI host (e.g. http://127.0.0.1:8188/view?...)
  taskId?: string // ComfyUI prompt_id (for polling / debugging)
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'unknown'
  error?: string
  latencyMs: number
  model: string
  prompt: string
  provider: 'comfyui-local'
}

export interface GenerateVideoLocalOptions {
  // Input image for SVD img2vid. Required. May be:
  //   - a data: URL (base64-encoded)
  //   - an http(s):// URL (we fetch + re-upload to ComfyUI)
  //   - a raw base64 string (we wrap it in a data URL)
  image: string
  // Text prompt. SVD ignores this; kept for API parity with the
  // SiliconFlow Wan 2.2 cloud path so the same request body works.
  prompt?: string
  // Output dimensions. SVD defaults to 1024x576; smaller is faster.
  width?: number
  height?: number
  // Number of frames to generate. SVD default is 14 (~2.3s at 6fps).
  frames?: number
  // Motion intensity 0-4095. 127 = default; higher = more motion.
  motionBucketId?: number
  // Output FPS for the animated webp. Default 6.
  fps?: number
  // Polling timeout. Default 5 minutes.
  timeoutMs?: number
  // Poll interval. Default 2 seconds.
  pollIntervalMs?: number
}

const DEFAULT_BASE = 'http://127.0.0.1:8188'
const SVS_DEFAULT_CKPT = 'svd.safetensors'

function getComfyUIBase(): string {
  return (process.env.COMFYUI_BASE_URL || DEFAULT_BASE).replace(/\/+$/, '')
}

/**
 * Whether the operator has opted into the local ComfyUI path.
 * The video API route calls this to decide whether to try local FIRST
 * (before falling back to SiliconFlow Wan 2.2).
 */
export function isComfyUIConfigured(): boolean {
  return !!process.env.COMFYUI_BASE_URL
}

/**
 * Build a ComfyUI API-format workflow for Stable Video Diffusion
 * (image-to-video). The graph is keyed by node id (string) per ComfyUI
 * convention. Inputs reference other nodes as `['<id>', <output_index>]`.
 *
 * The default checkpoint name is `svd.safetensors` — operators should
 * download the SVD weights from
 *   https://huggingface.co/stabilityai/stable-video-diffusion-img2vid
 * and drop the file into ComfyUI's `models/checkpoints/` directory.
 */
function buildSvdWorkflow(
  opts: GenerateVideoLocalOptions,
  uploadedImageName: string,
): Record<string, unknown> {
  const width = opts.width ?? 1024
  const height = opts.height ?? 576
  const frames = opts.frames ?? 14
  const motionBucketId = opts.motionBucketId ?? 127
  const fps = opts.fps ?? 6
  return {
    '1': {
      class_type: 'LoadImage',
      inputs: { image: uploadedImageName },
    },
    '2': {
      class_type: 'SVD_img2vid_Conditioner',
      inputs: {
        clip_vision: ['3', 0],
        init_image: ['1', 0],
        width,
        height,
        video_frames: frames,
        motion_bucket_id: motionBucketId,
        fps,
        augmentation_level: 0,
      },
    },
    '3': {
      class_type: 'CheckpointLoaderSimple',
      inputs: { ckpt_name: SVS_DEFAULT_CKPT },
    },
    '4': {
      class_type: 'KSampler',
      inputs: {
        seed: Math.floor(Math.random() * 2 ** 32),
        steps: 20,
        cfg: 2.5,
        sampler_name: 'euler',
        scheduler: 'karras',
        denoise: 1.0,
        model: ['3', 0],
        positive: ['2', 0],
        negative: ['2', 1],
        latent_image: ['2', 2],
      },
    },
    '5': {
      class_type: 'VAEDecode',
      inputs: {
        samples: ['4', 0],
        vae: ['3', 2],
      },
    },
    '6': {
      class_type: 'SaveAnimatedWEBP',
      inputs: {
        images: ['5', 0],
        filename_prefix: 'jarvis_svd',
        fps: fps * 2,
        lossless: false,
        quality: 90,
        method: 'default',
      },
    },
  }
}

/**
 * Upload an input image to ComfyUI's /upload/image endpoint so it can be
 * referenced by name in the workflow. Accepts data URLs, http(s) URLs
 * (fetched + re-uploaded), and raw base64 strings.
 */
async function uploadInputImage(
  base: string,
  image: string,
): Promise<{ name: string; subfolder: string; type: string }> {
  let buffer: Buffer
  const filename = 'jarvis-input-' + Date.now() + '.png'

  if (image.startsWith('data:')) {
    const b64 = image.split(',')[1] || ''
    buffer = Buffer.from(b64, 'base64')
  } else if (image.startsWith('http://') || image.startsWith('https://')) {
    // FIX (audit 2026-07-07 / B3): SSRF protection. The `image` parameter
    // is user-supplied and was previously fetched without any validation —
    // an attacker could point it at http://169.254.169.254/ (AWS IMDS),
    // http://127.0.0.1:PORT/ (internal services), or any private IP to
    // exfiltrate internal data via the re-uploaded image bytes. Now we run
    // it through assertSafeUrl which blocks private/loopback/link-local
    // ranges (IPv4 + IPv6, including IPv4-mapped IPv6 bypass attempts).
    try {
      await assertSafeUrl(image)
    } catch (err) {
      if (err instanceof SsrfError) {
        throw new Error(`input image URL rejected (SSRF protection): ${err.message}`)
      }
      throw err
    }
    const r = await fetch(image, { signal: AbortSignal.timeout(30_000) })
    if (!r.ok) {
      throw new Error(`failed to fetch input image from ${image}: HTTP ${r.status}`)
    }
    buffer = Buffer.from(await r.arrayBuffer())
  } else {
    // Assume raw base64 — try to decode. If it fails, rethrow with a
    // helpful message.
    try {
      buffer = Buffer.from(image, 'base64')
    } catch {
      throw new Error(
        'input image must be a data: URL, an http(s):// URL, or a base64 string',
      )
    }
  }

  if (!buffer || buffer.length === 0) {
    throw new Error('input image is empty after decoding')
  }

  const form = new FormData()
  const blob = new Blob([new Uint8Array(buffer)])
  form.append('image', blob, filename)
  form.append('overwrite', 'true')
  form.append('type', 'input')

  const r = await fetch(`${base}/upload/image`, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(60_000),
  })
  if (!r.ok) {
    const txt = await r.text().catch(() => '')
    throw new Error(`ComfyUI /upload/image ${r.status}: ${txt.slice(0, 200)}`)
  }
  const d = (await r.json()) as { name?: string; subfolder?: string; type?: string }
  if (!d.name) {
    throw new Error(`ComfyUI /upload/image response missing name: ${JSON.stringify(d).slice(0, 200)}`)
  }
  return {
    name: d.name,
    subfolder: d.subfolder || '',
    type: d.type || 'input',
  }
}

/**
 * Poll ComfyUI's /history/{prompt_id} endpoint until the workflow
 * completes (or the timeout elapses). On success, returns the URL of
 * the generated animated webp on the ComfyUI host.
 */
async function pollForCompletion(
  base: string,
  promptId: string,
  opts: GenerateVideoLocalOptions,
  started: number,
): Promise<LocalVideoResult> {
  const timeoutMs = opts.timeoutMs ?? 5 * 60 * 1000
  const pollInterval = opts.pollIntervalMs ?? 2000

  while (Date.now() - started < timeoutMs) {
    await new Promise((r) => setTimeout(r, pollInterval))

    let d: any
    try {
      const r = await fetch(`${base}/history/${promptId}`, {
        signal: AbortSignal.timeout(10_000),
      })
      if (!r.ok) continue
      d = await r.json()
    } catch {
      // Transient network error — keep polling.
      continue
    }

    const entry = d?.[promptId]
    if (!entry) continue

    // ComfyUI marks completion via status.completed=true. Some forks
    // also expose status.status_str ('success' | 'error').
    const isComplete = entry.status?.completed === true || entry.status?.status_str === 'success'
    if (isComplete) {
      // Find the output file. SaveAnimatedWEBP emits under 'gifs' or
      // 'webp' (depending on ComfyUI version); fall back to 'images'.
      const outputs = entry.outputs || {}
      for (const nodeId of Object.keys(outputs)) {
        const node = outputs[nodeId] || {}
        const file = node.gifs?.[0] || node.webp?.[0] || node.images?.[0]
        if (file?.filename) {
          const qs = new URLSearchParams({
            filename: file.filename,
            subfolder: file.subfolder || '',
            type: file.type || 'output',
          })
          const videoUrl = `${base}/view?${qs.toString()}`
          try {
            await createArtifact({
              kind: 'video',
              content: `[generated video (local SVD)](${videoUrl})`,
              metadata: {
                promptId,
                model: 'comfyui:svd',
                latencyMs: Date.now() - started,
              },
            })
          } catch {}
          return {
            ok: true,
            videoUrl,
            taskId: promptId,
            status: 'succeeded',
            latencyMs: Date.now() - started,
            model: 'comfyui:svd',
            prompt: opts.prompt || '',
            provider: 'comfyui-local',
          }
        }
      }
      // Completed but no output file — treat as failure.
      return {
        ok: false,
        error: 'ComfyUI completed but no output file was produced',
        taskId: promptId,
        status: 'failed',
        latencyMs: Date.now() - started,
        model: 'comfyui:svd',
        prompt: opts.prompt || '',
        provider: 'comfyui-local',
      }
    }

    if (entry.status?.status_str === 'error') {
      return {
        ok: false,
        error:
          'ComfyUI reported error: ' +
          JSON.stringify(entry.status?.messages || []).slice(0, 200),
        taskId: promptId,
        status: 'failed',
        latencyMs: Date.now() - started,
        model: 'comfyui:svd',
        prompt: opts.prompt || '',
        provider: 'comfyui-local',
      }
    }
    // Still pending/running — keep polling.
  }

  return {
    ok: false,
    error: `ComfyUI video generation timed out after ${timeoutMs}ms`,
    taskId: promptId,
    status: 'failed',
    latencyMs: Date.now() - started,
    model: 'comfyui:svd',
    prompt: opts.prompt || '',
    provider: 'comfyui-local',
  }
}

/**
 * Generate a short video clip via a local ComfyUI instance running
 * Stable Video Diffusion (image-to-video). This is the local-first
 * alternative to SiliconFlow Wan 2.2 — it keeps the source image on
 * the operator's own machine and uses their GPU.
 *
 * Returns a LocalVideoResult with `ok: true` and `videoUrl` set on
 * success, or `ok: false` with an `error` message on failure. Never
 * throws — callers can use the result directly without try/catch.
 */
export async function generateVideoLocal(
  opts: GenerateVideoLocalOptions,
): Promise<LocalVideoResult> {
  const started = Date.now()
  const base = getComfyUIBase()

  if (!opts.image) {
    return {
      ok: false,
      error: 'input image is required for SVD img2vid (ComfyUI does not support text-to-video)',
      latencyMs: 0,
      model: 'comfyui:svd',
      prompt: opts.prompt || '',
      status: 'failed',
      provider: 'comfyui-local',
    }
  }

  try {
    // 1) Health check — fail fast if ComfyUI isn't running.
    try {
      const r = await fetch(`${base}/system_stats`, {
        signal: AbortSignal.timeout(5_000),
      })
      if (!r.ok) {
        return {
          ok: false,
          error: `ComfyUI not reachable at ${base} (HTTP ${r.status})`,
          latencyMs: Date.now() - started,
          model: 'comfyui:svd',
          prompt: opts.prompt || '',
          status: 'failed',
          provider: 'comfyui-local',
        }
      }
    } catch (err: any) {
      return {
        ok: false,
        error: `ComfyUI not reachable at ${base}: ${err?.message || err}`,
        latencyMs: Date.now() - started,
        model: 'comfyui:svd',
        prompt: opts.prompt || '',
        status: 'failed',
        provider: 'comfyui-local',
      }
    }

    // 2) Upload the input image.
    const uploaded = await uploadInputImage(base, opts.image)

    // 3) Build + submit the SVD workflow.
    const workflow = buildSvdWorkflow(opts, uploaded.name)
    const submitR = await fetch(`${base}/prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: workflow }),
      signal: AbortSignal.timeout(15_000),
    })
    if (!submitR.ok) {
      const txt = await submitR.text().catch(() => '')
      return {
        ok: false,
        error: `ComfyUI /prompt ${submitR.status}: ${txt.slice(0, 200)}`,
        latencyMs: Date.now() - started,
        model: 'comfyui:svd',
        prompt: opts.prompt || '',
        status: 'failed',
        provider: 'comfyui-local',
      }
    }
    const submitD = (await submitR.json()) as { prompt_id?: string; promptId?: string }
    const promptId = submitD.prompt_id || submitD.promptId
    if (!promptId) {
      return {
        ok: false,
        error: 'ComfyUI /prompt response missing prompt_id',
        latencyMs: Date.now() - started,
        model: 'comfyui:svd',
        prompt: opts.prompt || '',
        status: 'failed',
        provider: 'comfyui-local',
      }
    }

    logger.info(
      { promptId, base, frames: opts.frames ?? 14 },
      '[video-generator] ComfyUI SVD workflow submitted, polling for completion',
    )

    // 4) Poll until complete (or timeout).
    return await pollForCompletion(base, promptId, opts, started)
  } catch (err: any) {
    return {
      ok: false,
      error: `local video gen failed: ${err?.message || String(err)}`,
      latencyMs: Date.now() - started,
      model: 'comfyui:svd',
      prompt: opts.prompt || '',
      status: 'failed',
      provider: 'comfyui-local',
    }
  }
}
