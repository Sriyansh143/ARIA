import { NextRequest, NextResponse } from 'next/server'
import {
  REASONING_SKILLS,
  chainOfThought,
  constitutionalAI,
  reactPattern,
  treeOfThoughts,
  stepBackPrompting,
  fewShotLearning,
  guardrails,
  toolUse,
  longContext,
  selfReflection,
  claudeLevelPipeline,
} from '@/lib/claude-skills'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Map skill keys → callables. Each callable takes a prompt + optional
// options object and returns a JSON-serialisable result.
type SkillFn = (prompt: string, options?: Record<string, unknown>) => Promise<unknown>

const SKILL_FNS: Record<string, SkillFn> = {
  'chain-of-thought': async (p, o) => chainOfThought(p, o?.context as string | undefined, o?.model as string | undefined),
  'constitutional-ai': async (p, o) => constitutionalAI(p, o?.principles as string[] | undefined, o?.model as string | undefined),
  'react-pattern': async (p, o) => {
    // Tools are not callable across the wire (functions don't serialise),
    // so we accept an optional `tools` array of {name, description} for the
    // planner prompt, but execute them as no-ops.
    const wireTools = (o?.tools as Array<{ name: string; description: string }> | undefined) ?? []
    const tools = wireTools.map((t) => ({
      name: t.name,
      description: t.description,
      run: async (input: string) => `[stub tool ${t.name} received: ${input.slice(0, 200)}]`,
    }))
    return reactPattern(p, tools, o?.maxIter as number | undefined, o?.model as string | undefined)
  },
  'tree-of-thoughts': async (p, o) => treeOfThoughts(p, o?.branchingFactor as number | undefined, o?.model as string | undefined),
  'step-back-prompting': async (p, o) => stepBackPrompting(p, o?.model as string | undefined),
  'few-shot-learning': async (p, o) => fewShotLearning(p, o?.examples as { input: string; output: string }[] | undefined, o?.model as string | undefined),
  guardrails: async (p, o) => guardrails(p, (o?.response as string) ?? ''),
  'tool-use': async (p, o) => {
    const wireTools = (o?.tools as Array<{ name: string; description: string }> | undefined) ?? []
    const tools = wireTools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: {},
      run: async () => `[stub tool ${t.name}]`,
    }))
    return toolUse(p, tools, o?.model as string | undefined)
  },
  'long-context': async (p, o) => longContext(p, o?.maxChars as number | undefined, o?.model as string | undefined),
  'self-reflection': async (p, o) => selfReflection(p, (o?.answer as string) ?? '', o?.model as string | undefined),
  pipeline: async (p, o) => claudeLevelPipeline(p, o?.context as string | undefined, o?.model as string | undefined),
}

// GET — list available reasoning skills (key, name, description).
export async function GET() {
  return NextResponse.json({
    skills: REASONING_SKILLS,
    pipeline: { key: 'pipeline', name: 'Master Pipeline', description: 'Full Claude-level pipeline: input-guard → step-back → chain-of-thought → self-reflection → output-guard.' },
    total: REASONING_SKILLS.length + 1,
  })
}

// POST — invoke a reasoning skill by key.
// Body: { skill: string, prompt: string, options?: object }
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const { skill, prompt, options } = body as { skill?: string; prompt?: string; options?: Record<string, unknown> }
  if (!skill || typeof skill !== 'string') {
    return NextResponse.json({ error: 'skill required' }, { status: 400 })
  }
  if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
    return NextResponse.json({ error: 'prompt required' }, { status: 400 })
  }
  const fn = SKILL_FNS[skill]
  if (!fn) {
    return NextResponse.json({ error: `unknown skill: ${skill}`, available: Object.keys(SKILL_FNS) }, { status: 404 })
  }
  try {
    const result = await fn(prompt, options)
    return NextResponse.json({ skill, prompt, result, ok: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown error'
    return NextResponse.json({ skill, prompt, error: msg, ok: false }, { status: 500 })
  }
}
