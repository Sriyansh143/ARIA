// claude-skills/index.ts — Barrel export for the 10 Claude-level skills
// + the master pipeline. Importers can `import { claudeLevelPipeline } from
// '@/lib/claude-skills'` and get everything.

export { chainOfThought } from './01-chain-of-thought'
export type { ChainOfThoughtResult } from './01-chain-of-thought'

export { constitutionalAI, DEFAULT_PRINCIPLES } from './02-constitutional-ai'
export type { ConstitutionalResult } from './02-constitutional-ai'

export { reactPattern } from './03-react-pattern'
export type { ReactTool, ReactStep, ReactResult } from './03-react-pattern'

export { treeOfThoughts } from './04-tree-of-thoughts'
export type { ThoughtNode, TreeOfThoughtsResult } from './04-tree-of-thoughts'

export { stepBackPrompting } from './05-step-back-prompting'
export type { StepBackResult } from './05-step-back-prompting'

export { fewShotLearning, DEFAULT_EXAMPLES } from './06-few-shot-learning'
export type { FewShotExample, FewShotResult } from './06-few-shot-learning'

export { guardrails, checkInput, checkOutput } from './07-guardrails'
export type { GuardrailResult, GuardrailPairResult } from './07-guardrails'

export { toolUse } from './08-tool-use'
export type { ToolSpec, ToolUseResult } from './08-tool-use'

export { longContext } from './09-long-context'
export type { LongContextResult } from './09-long-context'

export { selfReflection } from './10-self-reflection'
export type { SelfReflectionResult } from './10-self-reflection'

export { claudeLevelPipeline } from './pipeline'
export type { ClaudeLevelPipelineResult } from './pipeline'

/**
 * Registry of available reasoning skills — name + description.
 * Used by the /api/reasoning GET endpoint and the SkillsTab UI badge row.
 */
export const REASONING_SKILLS: ReadonlyArray<{
  key: string
  name: string
  description: string
}> = [
  { key: 'chain-of-thought', name: 'Chain of Thought', description: 'Two-phase reasoning: lay out the thinking, then produce the final answer.' },
  { key: 'constitutional-ai', name: 'Constitutional AI', description: 'Draft, then critique + revise against explicit helpful/harmless/honest principles.' },
  { key: 'react-pattern', name: 'ReAct (Reason+Act)', description: 'THOUGHT→ACTION→OBSERVATION loop over a tool set, capped at 5 iterations.' },
  { key: 'tree-of-thoughts', name: 'Tree of Thoughts', description: 'Explore 2-5 parallel solution branches, score each, refine the best.' },
  { key: 'step-back-prompting', name: 'Step-Back Prompting', description: 'Derive the governing principle, then answer the specific question.' },
  { key: 'few-shot-learning', name: 'Few-Shot Learning', description: 'Inject (input→output) examples so the model imitates the demonstrated pattern.' },
  { key: 'guardrails', name: 'Guardrails', description: 'Heuristic input/output filters for secrets, PII, and unsafe commands.' },
  { key: 'tool-use', name: 'Tool Use', description: 'Pick a tool from a schema, execute it, and synthesise a natural-language answer.' },
  { key: 'long-context', name: 'Long Context', description: 'Map-reduce summarisation to fit oversized inputs into the model window.' },
  { key: 'self-reflection', name: 'Self-Reflection', description: 'Self-grade an answer for correctness, then revise if needed (KEEP/REVISE).' },
]
