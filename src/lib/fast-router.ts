// =====================================================================
// fast-router.ts -- Fast-first model routing for instant responses.
// =====================================================================
// Phase 17 / UX optimization.
//
// Problem: the existing smart-router tries slow models first (Ollama
// mistral:7b takes 3-5s to load), so even a simple "hi" takes 5+ seconds.
//
// Solution: classify the prompt in <1ms (no LLM call needed), then pick
// the fastest model that can handle it:
//
//   - Greeting / small talk ("hi", "hello", "thanks")
//       -> Groq Llama 3.3 70B (500 tok/s, <500ms first token)
//       -> Fallback: local Ollama llama3.2:3b (no network latency)
//
//   - Code task ("write", "function", "debug", "refactor")
//       -> Qwen2.5-Coder (7b local or 32b cloud)
//       -> Fallback: Groq qwen-2.5-coder-32b
//
//   - Reasoning / strategy ("analyze", "compare", "should we")
//       -> DeepSeek-R1 (cloud, slow but thorough)
//       -> Fallback: Qwen3 8b (local, fast)
//
//   - Vision / screenshot ("look at", "screenshot", "image")
//       -> LLaVA (local) or Qwen2.5-VL
//
//   - Default (anything else)
//       -> Groq Llama 3.3 70B (fast default)
//       -> Fallback: local Ollama llama3.2:3b
//
// The classification is pure TypeScript (regex + keyword matching) -
// no LLM call needed, so it adds zero latency.
// =====================================================================

export type PromptCategory = 'greeting' | 'code' | 'reasoning' | 'vision' | 'tool-use' | 'chat'

export interface FastRouteResult {
  category: PromptCategory
  preferredModel: string
  fallbackChain: string[]
  reason: string
  estimatedLatencyMs: number
}

// ─── Prompt classification (pure TS, <1ms) ──────────────────────────
const GREETING_PATTERNS = [
  /^(hi|hello|hey|yo|sup|howdy|greetings)\b/i,
  /^(good\s+(morning|afternoon|evening|night))\b/i,
  /^(thanks|thank\s+you|thx|ty|appreciate\s+it)\b/i,
  /^(bye|goodbye|see\s+you|cya)\b/i,
  /^(how\s+are\s+you|how's\s+it\s+going|what's\s+up|sup)\b/i,
  /^(test|ping|are\s+you\s+there|you\s+alive)\b/i,
]

const CODE_PATTERNS = [
  /\b(code|function|class|method|variable|const|let|var|import|export|require)\b/i,
  /\b(debug|error|exception|stack\s+trace|bug|fix|refactor|optimize)\b/i,
  /\b(python|javascript|typescript|rust|go|java|c\+\+|ruby|php|swift|kotlin)\b/i,
  /\b(api|endpoint|route|handler|middleware|controller)\b/i,
  /\b(sql|query|database|table|schema|migration)\b/i,
  /\b(regex|pattern|match|replace|split|parse)\b/i,
  /```[\s\S]*?```/,  // code blocks
  /\b(write|create|build|implement|generate)\s+(a|an|the|some)?\s*(function|class|script|component|app|program)\b/i,
]

const REASONING_PATTERNS = [
  /\b(analyze|analysis|compare|comparison|evaluate|assess)\b/i,
  /\b(should\s+we|why|what\s+if|pros\s+and\s+cons|trade-?offs?)\b/i,
  /\b(strategy|strategic|plan|planning|roadmap|architecture)\b/i,
  /\b(decide|decision|recommend|recommendation|suggest|suggestion)\b/i,
  /\b(research|investigate|study|examine|explore)\b/i,
  /\b(think|reason|deduce|infer|conclude)\b/i,
  /#strategy|#deep-research|#codebase-overhaul/i,
]

const VISION_PATTERNS = [
  /\b(look\s+at|see|view|screenshot|screen\s+capture|image|picture|photo)\b/i,
  /\b(what's\s+on\s+(my|the)\s+screen|read\s+the\s+screen)\b/i,
  /\b(analyze\s+(this|the)\s+(image|screenshot|photo|picture))\b/i,
  /\b(ocr|text\s+recognition|visual)\b/i,
]

const TOOL_USE_PATTERNS = [
  /\b(scrape|crawl|fetch|download|upload)\b/i,
  /\b(search|find|look\s+up|query)\b/i,
  /\b(send\s+(email|message|notification)|post\s+to|call\s+api)\b/i,
  /\b(weather|currency|ip\s+lookup|stock\s+price)\b/i,
  /\b(file|filesystem|read\s+file|write\s+file|list\s+files)\b/i,
]

export function classifyPrompt(prompt: string): PromptCategory {
  const trimmed = prompt.trim()

  // Check in order of specificity (most specific first)
  if (GREETING_PATTERNS.some(re => re.test(trimmed))) return 'greeting'
  if (VISION_PATTERNS.some(re => re.test(trimmed))) return 'vision'
  if (CODE_PATTERNS.some(re => re.test(trimmed))) return 'code'
  if (REASONING_PATTERNS.some(re => re.test(trimmed))) return 'reasoning'
  if (TOOL_USE_PATTERNS.some(re => re.test(trimmed))) return 'tool-use'

  // Short prompts (<20 chars) are likely greetings or simple questions
  if (trimmed.length < 20) return 'greeting'

  return 'chat'
}

// ─── Fast-first route table ──────────────────────────────────────────
// Each category maps to a preferred model + fallback chain.
// The chain is ordered by speed: fastest first, most capable last.
const FAST_ROUTE_TABLE: Record<PromptCategory, FastRouteResult> = {
  greeting: {
    category: 'greeting',
    preferredModel: 'groq:llama-3.3-70b-versatile',
    fallbackChain: [
      'groq:llama-3.3-70b-versatile',     // 500 tok/s, <500ms first token
      'llama3.2:3b',                        // local, no network
      'groq:llama-3.1-8b-instant',         // ultra-fast fallback
      'qwen2.5:3b',                         // local fallback
    ],
    reason: 'Greeting detected - using fastest model (Groq Llama 3.3 70B, ~500ms)',
    estimatedLatencyMs: 500,
  },

  code: {
    category: 'code',
    preferredModel: 'groq:qwen-2.5-coder-32b',
    fallbackChain: [
      'groq:qwen-2.5-coder-32b',           // cloud, fast coder (500 tok/s)
      'qwen3-coder:480b-cloud',            // cloud, biggest
      'omniroute:deepseek/deepseek-chat',  // cloud via OmniRoute free gateway
      'qwen2.5-coder:7b',                  // local, code specialist
      'qwen2.5-coder:3b-instruct',         // local, smaller
      'deepseek-coder:latest',             // local fallback
    ],
    reason: 'Code task detected - using Groq Qwen2.5-Coder 32B (fast cloud)',
    estimatedLatencyMs: 1500,
  },

  reasoning: {
    category: 'reasoning',
    preferredModel: 'deepseek-r1:1.5b',
    fallbackChain: [
      'deepseek-r1:1.5b',                  // local reasoning model
      'qwen3:8b',                           // local, reasoning capable
      'deepseek-v3.1:671b-cloud',          // cloud, deep reasoning
      'glm-4.6:cloud',                     // cloud fallback
      'qwen3.5:latest',                    // local fallback
    ],
    reason: 'Reasoning task detected - using DeepSeek-R1 for chain-of-thought',
    estimatedLatencyMs: 5000,
  },

  vision: {
    category: 'vision',
    preferredModel: 'llava:latest',
    fallbackChain: [
      'llava:latest',                      // local vision
      'qwen2.5vl:3b',                      // local, smaller
      'qwen3-vl:235b-cloud',              // cloud vision
      'gemma3:4b',                         // local fallback
    ],
    reason: 'Vision task detected - using LLaVA for image analysis',
    estimatedLatencyMs: 3000,
  },

  'tool-use': {
    category: 'tool-use',
    preferredModel: 'llama3.1:8b',
    fallbackChain: [
      'llama3.1:8b',                       // local, tool-use capable
      'qwen2.5:7b',                        // local, tool-use
      'groq:llama-3.3-70b-versatile',     // cloud fast
      'glm-4.6:cloud',                     // cloud, strong tool-use
      'mistral:latest',                    // local fallback
    ],
    reason: 'Tool-use task detected - using Llama 3.1 8B with function calling',
    estimatedLatencyMs: 2000,
  },

  chat: {
    category: 'chat',
    preferredModel: 'groq:llama-3.3-70b-versatile',
    fallbackChain: [
      'groq:llama-3.3-70b-versatile',     // fast default
      'llama3.2:3b',                       // local
      'mistral:latest',                    // local
      'qwen2.5:7b',                        // local
      'glm-4.6:cloud',                     // cloud
    ],
    reason: 'General chat - using fast default (Groq Llama 3.3 70B)',
    estimatedLatencyMs: 800,
  },
}

// ─── Main entry: get fast route for a prompt ─────────────────────────
export function getFastRoute(prompt: string): FastRouteResult {
  const category = classifyPrompt(prompt)
  return FAST_ROUTE_TABLE[category]
}

// ─── Check if a model is likely available (based on env) ─────────────
export function isModelLikelyAvailable(modelId: string): boolean {
  // Groq models require GROQ_API_KEY
  if (modelId.startsWith('groq:')) {
    return !!process.env.GROQ_API_KEY
  }
  // Cloud models (ollama-cloud bridge) require the provider to be enabled
  if (modelId.includes(':cloud')) {
    return true  // assume available - the router will fall back if not
  }
  // Local Ollama models - assume available (router will check at call time)
  return true
}

// ─── Filter the fallback chain to only likely-available models ───────
export function getAvailableFallbackChain(prompt: string): string[] {
  const route = getFastRoute(prompt)
  return route.fallbackChain.filter(isModelLikelyAvailable)
}
