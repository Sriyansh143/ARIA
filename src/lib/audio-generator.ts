// =====================================================================
// audio-generator.ts — Generate audio via Sarvam AI / SiliconFlow TTS.
// =====================================================================
// Used by:
//   - /api/chat (inline audio generation when user asks for TTS)
//   - /api/generate-audio (returns URL for chat display)
//
// Strategy:
//   1. If SARVAM_API_KEY is set → use Sarvam AI's official API (TTS,
//      supports 11 Indian languages + English).
//   2. Otherwise → use SiliconFlow CosyVoice2 TTS (free, requires
//      SILICONFLOW_API_KEY).
//   3. Otherwise → return an error with setup instructions.
// =====================================================================

import { logger } from '@/lib/logger'
import { createArtifact } from '@/lib/artifact-helper'
import { randomUUID } from 'crypto'
import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'

export interface AudioGenResult {
  ok: boolean
  audioUrl?: string  // relative URL like /uploads/audio/{uuid}.mp3
  audioBase64?: string  // base64-encoded audio bytes (kept for API compat)
  error?: string
  latencyMs: number
  model: string
  prompt: string
  provider: string  // 'sarvam' | 'siliconflow-tts' | 'none'
  sentToTelegram: boolean
}

// ─── Detect if a user prompt is asking for audio generation ──────────
const AUDIO_GEN_TRIGGERS = [
  /^(generate|create|make|produce|sing|play|compose)\s+(an?\s+)?(song|track|audio|music|tune|melody|beat|instrumental|jingle|podcast|voiceover|voice\s+over)\b/i,
  /^(sing|play|perform)\s+(me\s+)?(an?\s+)?/i,
  /^(text\s+to\s+speech|tts|speech\s+synthesis)\b/i,
  /\bsuno\b/i,
  /\bsarvam\b/i,
  /\b(sing\s+this|say\s+this|narrate\s+this|read\s+this\s+aloud)\b/i,
  /\b(read|narrate)\s+(this|the)\s+(text|poem|story|script)\b/i,
  /\b(in\s+an?\s+indian\s+voice|in\s+hindi|in\s+tamil|in\s+telugu|in\s+kannada|in\s+bengali|in\s+marathi|in\s+gujarati|in\s+punjabi|in\s+malayalam|in\s+odia|in\s+urdu)\b/i,
]

const AUDIO_KEYWORDS = [
  'song of', 'track of', 'music of', 'audio of',
  'sing about', 'sing a song', 'compose a song', 'make a song',
  'text to speech', 'voice over', 'voiceover', 'narrate',
]

export function detectAudioGenerationRequest(prompt: string): { isAudioGen: boolean; cleanedPrompt: string } {
  const trimmed = prompt.trim()
  if (!trimmed || trimmed.length < 5) return { isAudioGen: false, cleanedPrompt: trimmed }

  for (const re of AUDIO_GEN_TRIGGERS) {
    if (re.test(trimmed)) {
      let cleaned = trimmed
        .replace(/^(generate|create|make|produce|sing|play|compose|perform|narrate|read)\s+(me\s+)?(an?\s+)?(song|track|audio|music|tune|melody|beat|instrumental|jingle|podcast|voiceover|voice\s+over|this|the\s+\w+)\s*(about|of|saying|titled|called)?\s*/i, '')
        .replace(/\b(in\s+an?\s+indian\s+voice|in\s+hindi|in\s+tamil|in\s+telugu|in\s+kannada|in\s+bengali|in\s+marathi|in\s+gujarati|in\s+punjabi|in\s+malayalam|in\s+odia|in\s+urdu)\b/gi, '')
        .trim()
      if (!cleaned) cleaned = trimmed
      return { isAudioGen: true, cleanedPrompt: cleaned }
    }
  }

  const lower = trimmed.toLowerCase()
  for (const kw of AUDIO_KEYWORDS) {
    if (lower.includes(kw)) {
      return { isAudioGen: true, cleanedPrompt: trimmed }
    }
  }

  return { isAudioGen: false, cleanedPrompt: trimmed }
}

const UPLOAD_DIR = join(process.cwd(), 'uploads', 'audio')
function ensureUploadDir(): void {
  try { mkdirSync(UPLOAD_DIR, { recursive: true }) } catch { /* ignore */ }
}

function saveAudioBuffer(buf: Buffer): string {
  ensureUploadDir()
  const filename = `${randomUUID()}.mp3`
  const filePath = join(UPLOAD_DIR, filename)
  writeFileSync(filePath, buf)
  return `/uploads/audio/${filename}`
}

// ─── Sarvam AI TTS (text-to-speech) ──────────────────────────────────
async function generateViaSarvam(text: string, language?: string): Promise<{ ok: boolean; audioBase64?: string; error?: string }> {
  const k = process.env.SARVAM_API_KEY
  if (!k) return { ok: false, error: 'SARVAM_API_KEY not set' }
  try {
    const r = await fetch('https://api.sarvam.ai/text-to-speech', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-subscription-key': k,
      },
      body: JSON.stringify({
        inputs: [text.slice(0, 1000)],
        target_language_code: language || 'en-IN',
        speaker: 'meera',
        pitch: 0,
        pace: 1.15,
        loudness: 1.5,
        speech_sample_rate: 22050,
        enable_preprocessing: true,
        model: 'bulbul:v1',
      }),
      signal: AbortSignal.timeout(60_000),
    })
    if (!r.ok) {
      const txt = await r.text().catch(() => '')
      return { ok: false, error: `Sarvam API error ${r.status}: ${txt.slice(0, 200)}` }
    }
    const d = await r.json() as { audios?: string[] }
    const audioBase64 = d.audios?.[0]
    if (!audioBase64) return { ok: false, error: 'Sarvam response missing audios[0]' }
    return { ok: true, audioBase64 }
  } catch (err) {
    return { ok: false, error: `Sarvam failed: ${err instanceof Error ? err.message : String(err)}` }
  }
}

// ─── SiliconFlow TTS (text-to-speech) ────────────────────────────────
async function generateViaSiliconFlowTTS(text: string, _language?: string): Promise<{ ok: boolean; audioBase64?: string; error?: string }> {
  const k = process.env.SILICONFLOW_API_KEY
  if (!k) return { ok: false, error: 'SILICONFLOW_API_KEY not set' }
  try {
    const r = await fetch('https://api.siliconflow.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${k}`,
      },
      body: JSON.stringify({
        model: 'FunAudioLLM/CosyVoice2-0.5B',
        input: text.slice(0, 2000),
        voice: 'FunAudioLLM/CosyVoice2-0.5B:alex',
      }),
      signal: AbortSignal.timeout(60_000),
    })
    if (!r.ok) {
      const txt = await r.text().catch(() => '')
      return { ok: false, error: `SiliconFlow TTS error ${r.status}: ${txt.slice(0, 200)}` }
    }
    const audioBuf = Buffer.from(await r.arrayBuffer())
    if (audioBuf.length < 100) return { ok: false, error: 'SiliconFlow TTS returned empty audio' }
    return { ok: true, audioBase64: audioBuf.toString('base64') }
  } catch (err) {
    return { ok: false, error: `SiliconFlow TTS failed: ${err instanceof Error ? err.message : String(err)}` }
  }
}

// ─── Main entry: generate audio ───────────────────────────────────────
export async function generateAudio(
  prompt: string,
  opts?: { sendToTelegram?: boolean; language?: string },
): Promise<AudioGenResult> {
  const started = Date.now()
  const language = opts?.language
  void opts?.sendToTelegram  // accepted for API compat; no Telegram integration in this build

  // 1. Try Sarvam AI TTS first
  const sarvamResult = await generateViaSarvam(prompt, language)
  if (sarvamResult.ok && sarvamResult.audioBase64) {
    const buf = Buffer.from(sarvamResult.audioBase64, 'base64')
    const audioUrl = saveAudioBuffer(buf)
    try {
      await createArtifact({
        kind: 'audio',
        content: audioUrl,
        metadata: { prompt, model: 'sarvam:bulbul-v1', language, latencyMs: Date.now() - started },
      })
    } catch { /* ignore */ }
    return {
      ok: true,
      audioUrl,
      audioBase64: sarvamResult.audioBase64,
      latencyMs: Date.now() - started,
      model: 'sarvam:bulbul-v1',
      prompt,
      provider: 'sarvam',
      sentToTelegram: false,
    }
  }

  // 2. Fall back to SiliconFlow TTS
  if (process.env.SILICONFLOW_API_KEY) {
    const sfResult = await generateViaSiliconFlowTTS(prompt, language)
    if (sfResult.ok && sfResult.audioBase64) {
      const buf = Buffer.from(sfResult.audioBase64, 'base64')
      const audioUrl = saveAudioBuffer(buf)
      try {
        await createArtifact({
          kind: 'audio',
          content: audioUrl,
          metadata: { prompt, model: 'siliconflow:cosyvoice2', latencyMs: Date.now() - started },
        })
      } catch { /* ignore */ }
      return {
        ok: true,
        audioUrl,
        audioBase64: sfResult.audioBase64,
        latencyMs: Date.now() - started,
        model: 'siliconflow:cosyvoice2',
        prompt,
        provider: 'siliconflow-tts',
        sentToTelegram: false,
      }
    }
    logger.warn({ err: sfResult.error }, 'audio-gen: SiliconFlow TTS failed')
  }

  // Both failed
  return {
    ok: false,
    error: `Audio generation failed. Sarvam: ${sarvamResult.error}. Set SARVAM_API_KEY or SILICONFLOW_API_KEY in .env.`,
    latencyMs: Date.now() - started,
    model: 'none',
    prompt,
    provider: 'none',
    sentToTelegram: false,
  }
}

// ─── Helper: fetch audio bytes from URL ──────────────────────────────
export async function fetchAudioBuffer(url: string): Promise<Buffer | null> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(30_000) })
    if (!r.ok) return null
    const ab = await r.arrayBuffer()
    return Buffer.from(ab)
  } catch {
    return null
  }
}
