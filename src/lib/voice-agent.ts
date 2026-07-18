// =====================================================================
// voice-agent.ts — Voice agent engine (STT + LLM + TTS pipeline).
// =====================================================================
// Pipeline:
//   1. Caller speaks → audio streamed in
//   2. STT (Sarvam API) converts speech → text
//   3. LLM (chat()) generates response from text + system prompt
//   4. TTS (Sarvam API) converts response → audio
//   5. Audio streamed back to caller
//   6. Loop until caller hangs up or max duration reached
//
// Workflows + call sessions are persisted as MemoryItem rows under
// scope='voice-workflow' / 'voice-call'. Active sessions are kept in-memory
// for the duration of the call.
// =====================================================================

import { db } from '@/lib/db'
import { logger } from '@/lib/logger'
import { chat, type ChatTurn } from '@/lib/llm'
import { randomUUID } from 'crypto'

// ─── Types ───────────────────────────────────────────────────────────
export interface VoiceWorkflowDef {
  id?: string
  name: string
  description?: string
  greeting: string
  systemPrompt: string
  language?: string
  voice?: string
  sttModel?: string
  llmModel?: string
  maxDuration?: number  // seconds
}

export interface VoiceWorkflowRecord extends VoiceWorkflowDef {
  id: string
  status: 'active' | 'paused' | 'archived'
  runCount: number
  createdAt: string
  updatedAt: string
}

export interface VoiceCallSession {
  callId: string
  workflowId: string
  direction: 'inbound' | 'outbound' | 'webrtc'
  phoneNumber?: string
  status: 'queued' | 'ringing' | 'in-progress' | 'completed' | 'failed' | 'no-answer' | 'busy'
  startedAt: number
  transcript: Array<{ role: 'caller' | 'agent'; text: string; ts: number }>
  conversationHistory: ChatTurn[]
  maxDuration: number
  greeting: string
  systemPrompt: string
  voice: string
  language: string
  llmModel?: string
}

// Active call sessions (in-memory — persists for duration of call)
const activeCalls = new Map<string, VoiceCallSession>()

// ─── Sarvam AI STT (Speech-to-Text) ──────────────────────────────────
export async function speechToText(audioBase64: string, language: string = 'en-IN'): Promise<{
  ok: boolean
  text?: string
  error?: string
}> {
  const k = process.env.SARVAM_API_KEY
  if (!k) return { ok: false, error: 'SARVAM_API_KEY not set — needed for STT' }
  try {
    const r = await fetch('https://api.sarvam.ai/speech-to-text', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-subscription-key': k,
      },
      body: JSON.stringify({
        audio: audioBase64,
        language_code: language,
        model: 'saarika-v1',
      }),
      signal: AbortSignal.timeout(30_000),
    })
    if (!r.ok) {
      const txt = await r.text().catch(() => '')
      return { ok: false, error: `Sarvam STT ${r.status}: ${txt.slice(0, 200)}` }
    }
    const d = await r.json() as { transcript?: string; text?: string }
    return { ok: true, text: d.transcript || d.text || '' }
  } catch (err) {
    return { ok: false, error: `STT failed: ${err instanceof Error ? err.message : String(err)}` }
  }
}

// ─── Sarvam AI TTS (Text-to-Speech) ──────────────────────────────────
export async function textToSpeech(text: string, voice: string = 'meera', language: string = 'en-IN'): Promise<{
  ok: boolean
  audioBase64?: string
  error?: string
}> {
  const k = process.env.SARVAM_API_KEY
  if (!k) return { ok: false, error: 'SARVAM_API_KEY not set — needed for TTS' }
  try {
    const r = await fetch('https://api.sarvam.ai/text-to-speech', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-subscription-key': k,
      },
      body: JSON.stringify({
        inputs: [text.slice(0, 1000)],
        target_language_code: language,
        speaker: voice,
        pitch: 0,
        pace: 1.15,
        loudness: 1.5,
        speech_sample_rate: 22050,
        enable_preprocessing: true,
        model: 'bulbul:v1',
      }),
      signal: AbortSignal.timeout(30_000),
    })
    if (!r.ok) {
      const txt = await r.text().catch(() => '')
      return { ok: false, error: `Sarvam TTS ${r.status}: ${txt.slice(0, 200)}` }
    }
    const d = await r.json() as { audios?: string[] }
    const audioBase64 = d.audios?.[0]
    if (!audioBase64) return { ok: false, error: 'Sarvam TTS response missing audios[0]' }
    return { ok: true, audioBase64 }
  } catch (err) {
    return { ok: false, error: `TTS failed: ${err instanceof Error ? err.message : String(err)}` }
  }
}

// ─── LLM response generation ─────────────────────────────────────────
export async function generateAgentResponse(
  conversationHistory: ChatTurn[],
  systemPrompt: string,
  _llmModel?: string,
): Promise<{ ok: boolean; text?: string; error?: string }> {
  try {
    // Use our canonical chat() — systemPrompt is the third arg.
    // The latest user message is the last item in conversationHistory.
    const history = conversationHistory.slice(0, -1)
    const lastUser = [...conversationHistory].reverse().find(m => m.role === 'user')
    const userMsg = lastUser?.content ?? ''
    const result = await chat(userMsg, history, systemPrompt)
    return { ok: true, text: result.content }
  } catch (err) {
    return { ok: false, error: `LLM failed: ${err instanceof Error ? err.message : String(err)}` }
  }
}

// ─── Voice workflow persistence (MemoryItem) ─────────────────────────
async function persistWorkflow(wf: VoiceWorkflowRecord): Promise<void> {
  try {
    await db.memoryItem.upsert({
      where: { key_scope: { key: `voice-workflow:${wf.id}`, scope: 'voice-workflow' } },
      create: {
        scope: 'voice-workflow',
        key: `voice-workflow:${wf.id}`,
        value: JSON.stringify(wf),
        tags: JSON.stringify([wf.status, wf.name]),
      },
      update: {
        value: JSON.stringify(wf),
        tags: JSON.stringify([wf.status, wf.name]),
      },
    })
  } catch (err) {
    logger.warn({ err: (err as Error).message, id: wf.id }, 'voice: persist workflow failed')
  }
}

async function fetchWorkflow(id: string): Promise<VoiceWorkflowRecord | null> {
  try {
    const row = await db.memoryItem.findUnique({
      where: { key_scope: { key: `voice-workflow:${id}`, scope: 'voice-workflow' } },
    })
    if (!row) return null
    return JSON.parse(row.value) as VoiceWorkflowRecord
  } catch {
    return null
  }
}

// ─── Start a voice call session ──────────────────────────────────────
export async function startCallSession(opts: {
  workflowId: string
  direction: 'inbound' | 'outbound' | 'webrtc'
  phoneNumber?: string
  callSid?: string
}): Promise<{ ok: boolean; callId?: string; error?: string }> {
  try {
    const workflow = await fetchWorkflow(opts.workflowId)
    if (!workflow) return { ok: false, error: 'Voice workflow not found' }
    if (workflow.status !== 'active') return { ok: false, error: `Workflow is ${workflow.status} (not active)` }

    const callId = `call_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`
    const session: VoiceCallSession = {
      callId,
      workflowId: opts.workflowId,
      direction: opts.direction,
      phoneNumber: opts.phoneNumber,
      status: 'ringing',
      startedAt: Date.now(),
      transcript: [],
      conversationHistory: [],
      maxDuration: workflow.maxDuration ?? 300,
      greeting: workflow.greeting,
      systemPrompt: workflow.systemPrompt,
      voice: workflow.voice ?? 'meera',
      language: workflow.language ?? 'en-IN',
      llmModel: workflow.llmModel,
    }
    activeCalls.set(callId, session)

    // Bump run count + persist
    workflow.runCount = (workflow.runCount ?? 0) + 1
    workflow.updatedAt = new Date().toISOString()
    await persistWorkflow(workflow)

    logger.info({ callId, workflow: workflow.name }, 'voice: call session started')
    return { ok: true, callId }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Failed to start call session' }
  }
}

// ─── Process incoming audio from caller ──────────────────────────────
export async function processCallerAudio(callId: string, audioBase64: string): Promise<{
  ok: boolean
  responseText?: string
  responseAudio?: string
  error?: string
  shouldHangUp?: boolean
}> {
  const session = activeCalls.get(callId)
  if (!session) return { ok: false, error: 'Call session not found' }
  if (session.status !== 'in-progress') return { ok: false, error: `Call is ${session.status}, not in-progress` }

  const elapsed = (Date.now() - session.startedAt) / 1000
  if (elapsed > session.maxDuration) {
    await endCallSession(callId, 'completed', 'Max duration reached')
    return { ok: false, shouldHangUp: true, error: 'Max duration reached' }
  }

  const sttResult = await speechToText(audioBase64, session.language)
  if (!sttResult.ok || !sttResult.text) {
    return { ok: false, error: sttResult.error || 'STT returned no text' }
  }

  const callerText = sttResult.text.trim()
  if (!callerText) return { ok: false, error: 'Empty transcription' }

  if (/goodbye|bye|hang\s*up|end\s*call|that'?s\s*all/i.test(callerText)) {
    await endCallSession(callId, 'completed', 'Caller said goodbye')
    return { ok: true, shouldHangUp: true, responseText: 'Goodbye! Have a great day.' }
  }

  session.transcript.push({ role: 'caller', text: callerText, ts: Date.now() })
  session.conversationHistory.push({ role: 'user', content: callerText })

  const llmResult = await generateAgentResponse(
    session.conversationHistory,
    session.systemPrompt,
    session.llmModel,
  )
  if (!llmResult.ok || !llmResult.text) {
    return { ok: false, error: llmResult.error || 'LLM returned no text' }
  }

  const responseText = llmResult.text
  session.transcript.push({ role: 'agent', text: responseText, ts: Date.now() })
  session.conversationHistory.push({ role: 'assistant', content: responseText })

  const ttsResult = await textToSpeech(responseText, session.voice, session.language)
  if (!ttsResult.ok || !ttsResult.audioBase64) {
    return { ok: true, responseText, error: ttsResult.error }
  }

  return {
    ok: true,
    responseText,
    responseAudio: ttsResult.audioBase64,
  }
}

// ─── Get the greeting message for a new call ─────────────────────────
export async function getCallGreeting(callId: string): Promise<{
  ok: boolean
  greetingText?: string
  greetingAudio?: string
  error?: string
}> {
  const session = activeCalls.get(callId)
  if (!session) return { ok: false, error: 'Call session not found' }

  session.status = 'in-progress'
  session.transcript.push({ role: 'agent', text: session.greeting, ts: Date.now() })
  session.conversationHistory.push({ role: 'assistant', content: session.greeting })

  const ttsResult = await textToSpeech(session.greeting, session.voice, session.language)
  return {
    ok: true,
    greetingText: session.greeting,
    greetingAudio: ttsResult.audioBase64,
  }
}

// ─── End a call session ──────────────────────────────────────────────
export async function endCallSession(
  callId: string,
  status: 'completed' | 'failed' | 'no-answer' | 'busy',
  error?: string,
): Promise<void> {
  const session = activeCalls.get(callId)
  if (!session) return

  const duration = Math.round((Date.now() - session.startedAt) / 1000)

  // Persist call record
  try {
    const callRecord = {
      id: callId,
      workflowId: session.workflowId,
      direction: session.direction,
      phoneNumber: session.phoneNumber ?? null,
      status,
      duration,
      transcript: session.transcript,
      error: error ?? null,
      startedAt: new Date(session.startedAt).toISOString(),
      endedAt: new Date().toISOString(),
    }
    await db.memoryItem.create({
      data: {
        scope: 'voice-call',
        key: `voice-call:${callId}`,
        value: JSON.stringify(callRecord),
        tags: JSON.stringify([status, session.workflowId]),
      },
    })
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'voice: failed to persist call record')
  }

  activeCalls.delete(callId)
  logger.info({ callId, status, duration }, 'voice: call ended')
}

// ─── Get active call session ─────────────────────────────────────────
export function getActiveCall(callId: string): VoiceCallSession | null {
  return activeCalls.get(callId) ?? null
}

export function listActiveCalls(): VoiceCallSession[] {
  return [...activeCalls.values()]
}

// ─── Create a voice workflow ─────────────────────────────────────────
export async function createVoiceWorkflow(opts: VoiceWorkflowDef): Promise<{ ok: boolean; workflowId?: string; error?: string }> {
  try {
    const id = opts.id ?? `vwf_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`
    const now = new Date().toISOString()
    const record: VoiceWorkflowRecord = {
      id,
      name: opts.name,
      description: opts.description,
      greeting: opts.greeting,
      systemPrompt: opts.systemPrompt,
      language: opts.language ?? 'en-IN',
      voice: opts.voice ?? 'meera',
      sttModel: opts.sttModel ?? 'saarika-v1',
      llmModel: opts.llmModel,
      maxDuration: opts.maxDuration ?? 300,
      status: 'active',
      runCount: 0,
      createdAt: now,
      updatedAt: now,
    }
    await persistWorkflow(record)
    return { ok: true, workflowId: id }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Failed to create workflow' }
  }
}

// ─── List all voice workflows ────────────────────────────────────────
export async function listVoiceWorkflows(): Promise<VoiceWorkflowRecord[]> {
  try {
    const rows = await db.memoryItem.findMany({ where: { scope: 'voice-workflow' } })
    return rows
      .map(r => {
        try { return JSON.parse(r.value) as VoiceWorkflowRecord } catch { return null }
      })
      .filter((w): w is VoiceWorkflowRecord => w !== null)
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'voice: listWorkflows failed')
    return []
  }
}

// ─── Get call history ────────────────────────────────────────────────
export async function getCallHistory(workflowId?: string, limit: number = 50): Promise<Array<Record<string, unknown>>> {
  try {
    const rows = await db.memoryItem.findMany({
      where: { scope: 'voice-call' },
      orderBy: { createdAt: 'desc' },
      take: limit * 2,  // over-fetch then filter
    })
    const calls = rows
      .map(r => {
        try { return JSON.parse(r.value) as Record<string, unknown> } catch { return null }
      })
      .filter((c): c is Record<string, unknown> => c !== null)
    if (workflowId) {
      return calls.filter(c => c.workflowId === workflowId).slice(0, limit)
    }
    return calls.slice(0, limit)
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'voice: getCallHistory failed')
    return []
  }
}
