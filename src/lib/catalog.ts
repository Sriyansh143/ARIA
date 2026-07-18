// Catalog of all known models and agents seeded into the dashboard.
// Derived from user's `ollama list` output (Windows 11 host) + cloud bridges.

export type ModelCapability = 'chat' | 'code' | 'vision' | 'embedding' | 'reasoning' | 'tool-use'
export type AgentKind = 'hermes' | 'open-interpreter' | 'ufo' | 'openclaw' | 'crewai' | 'browser-use' | 'custom'

// Model tier — drives routing decisions (strong = flagship, fast = cheap/quick,
// vision = multimodal, reasoning = step-by-step thinker, local = on-device/embedded).
export type ModelTier = 'strong' | 'fast' | 'vision' | 'reasoning' | 'local'

export interface ModelDescriptor {
  modelId: string
  displayName: string
  capabilities: ModelCapability[]
  sizeGb?: number
  quantization?: string
  contextLen?: number
  tier?: ModelTier
}

// A flattened catalog entry that pairs a model with its owning providerKey.
// Used by the seed script and the /api/models route. Derived from PROVIDER_SEEDS.
export interface CatalogEntry extends ModelDescriptor {
  providerKey: string
  enabled: boolean
}

export interface ProviderSeed {
  name: string
  kind: 'local' | 'cloud-api' | 'browser'
  baseUrl?: string
  apiKey?: string
  enabled: boolean
  models: ModelDescriptor[]
}

// --- Ollama models detected on user's machine (from `ollama list`) ---
export const OLLAMA_MODELS: ModelDescriptor[] = [
  // Vision (for UFO / Open Interpreter OS Mode screen reading)
  { modelId: 'llava:latest', displayName: 'LLaVA 1.6', capabilities: ['vision', 'chat'], sizeGb: 4.7, contextLen: 4096 },
  { modelId: 'qwen2.5vl:3b', displayName: 'Qwen2.5-VL 3B', capabilities: ['vision', 'chat'], sizeGb: 3.2, contextLen: 32768 },
  // Code specialists (for VSCode / PowerShell script generation)
  { modelId: 'qwen2.5-coder:7b', displayName: 'Qwen2.5 Coder 7B', capabilities: ['code', 'chat'], sizeGb: 4.7, contextLen: 32768 },
  { modelId: 'qwen2.5-coder:3b-instruct', displayName: 'Qwen2.5 Coder 3B Instruct', capabilities: ['code', 'chat'], sizeGb: 1.9, contextLen: 32768 },
  { modelId: 'qwen2.5-coder:1.5b', displayName: 'Qwen2.5 Coder 1.5B', capabilities: ['code', 'chat'], sizeGb: 0.98, contextLen: 32768 },
  { modelId: 'qwen2.5-coder:1.5b-base', displayName: 'Qwen2.5 Coder 1.5B Base', capabilities: ['code'], sizeGb: 0.98, contextLen: 32768 },
  { modelId: 'deepseek-coder:latest', displayName: 'DeepSeek Coder', capabilities: ['code', 'chat'], sizeGb: 0.78, contextLen: 16384 },
  { modelId: 'codellama:latest', displayName: 'CodeLlama', capabilities: ['code', 'chat'], sizeGb: 3.8, contextLen: 16384 },
  // General chat / reasoning
  { modelId: 'llama3.1:8b', displayName: 'Llama 3.1 8B', capabilities: ['chat', 'tool-use'], sizeGb: 4.9, contextLen: 128000 },
  { modelId: 'llama3.2:3b', displayName: 'Llama 3.2 3B', capabilities: ['chat'], sizeGb: 2.0, contextLen: 128000 },
  { modelId: 'qwen2.5:7b', displayName: 'Qwen2.5 7B', capabilities: ['chat', 'tool-use', 'reasoning'], sizeGb: 4.7, contextLen: 32768 },
  { modelId: 'qwen3:8b', displayName: 'Qwen3 8B', capabilities: ['chat', 'reasoning', 'tool-use'], sizeGb: 5.2, contextLen: 32768 },
  { modelId: 'qwen3.5:4b', displayName: 'Qwen3.5 4B', capabilities: ['chat', 'reasoning'], sizeGb: 3.4, contextLen: 32768 },
  { modelId: 'qwen3.5:latest', displayName: 'Qwen3.5 6.6B', capabilities: ['chat', 'reasoning', 'tool-use'], sizeGb: 6.6, contextLen: 32768 },
  { modelId: 'mistral:latest', displayName: 'Mistral 7B (Hermes-tuned)', capabilities: ['chat', 'tool-use'], sizeGb: 4.4, contextLen: 32768 },
  { modelId: 'gemma:7b', displayName: 'Gemma 7B', capabilities: ['chat'], sizeGb: 5.0, contextLen: 8192 },
  { modelId: 'gemma:2b', displayName: 'Gemma 2B', capabilities: ['chat'], sizeGb: 1.7, contextLen: 8192 },
  { modelId: 'gemma3:4b', displayName: 'Gemma 3 4B', capabilities: ['chat', 'vision'], sizeGb: 3.3, contextLen: 8192 },
  { modelId: 'gemma4:latest', displayName: 'Gemma 4 (latest)', capabilities: ['chat', 'reasoning'], sizeGb: 9.6, contextLen: 8192 },
  { modelId: 'phi3:mini', displayName: 'Phi-3 Mini', capabilities: ['chat'], sizeGb: 2.2, contextLen: 4096 },
  { modelId: 'deepseek-r1:1.5b', displayName: 'DeepSeek R1 1.5B', capabilities: ['reasoning', 'chat'], sizeGb: 1.1, contextLen: 65536 },
  // Embeddings (memory / vector DB)
  { modelId: 'nomic-embed-text:latest', displayName: 'Nomic Embed Text', capabilities: ['embedding'], sizeGb: 0.27, contextLen: 8192 },
]

// Cloud models proxied via Ollama cloud bridge
export const OLLAMA_CLOUD_MODELS: ModelDescriptor[] = [
  { modelId: 'glm-4.6:cloud', displayName: 'GLM-4.6 (Cloud)', capabilities: ['chat', 'reasoning', 'tool-use'], contextLen: 128000 },
  { modelId: 'minimax-m2:cloud', displayName: 'MiniMax M2 (Cloud)', capabilities: ['chat', 'reasoning'], contextLen: 1000000 },
  { modelId: 'qwen3-vl:235b-cloud', displayName: 'Qwen3-VL 235B (Cloud)', capabilities: ['vision', 'chat', 'reasoning'], contextLen: 128000 },
  { modelId: 'qwen3-coder:480b-cloud', displayName: 'Qwen3 Coder 480B (Cloud)', capabilities: ['code', 'chat', 'reasoning'], contextLen: 256000 },
  { modelId: 'deepseek-v3.1:671b-cloud', displayName: 'DeepSeek V3.1 671B (Cloud)', capabilities: ['chat', 'reasoning', 'tool-use'], contextLen: 128000 },
  { modelId: 'gpt-oss:20b-cloud', displayName: 'GPT-OSS 20B (Cloud)', capabilities: ['chat', 'tool-use'], contextLen: 128000 },
  { modelId: 'gpt-oss:120b-cloud', displayName: 'GPT-OSS 120B (Cloud)', capabilities: ['chat', 'reasoning', 'tool-use'], contextLen: 128000 },
]

// --- External providers (free / freemium APIs the user mentioned) ---
export const NVIDIA_NIM_MODELS: ModelDescriptor[] = [
  // ─── NVIDIA-built models ───
  { modelId: 'nvidia/llama-3.1-nemotron-70b-instruct', displayName: 'Nemotron 70B Instruct', capabilities: ['chat', 'tool-use', 'reasoning'], contextLen: 131072 },
  { modelId: 'nvidia/llama-3.1-nemotron-nano-8b-v1', displayName: 'Nemotron Nano 8B v1', capabilities: ['chat'], contextLen: 131072 },
  { modelId: 'nvidia/llama-3.3-nemotron-super-49b-v1', displayName: 'Nemotron Super 49B v1', capabilities: ['chat', 'reasoning'], contextLen: 131072 },
  { modelId: 'nvidia/nv-llama-3.1-nemotron-51b-instruct', displayName: 'NV Nemotron 51B', capabilities: ['chat', 'reasoning'], contextLen: 131072 },
  { modelId: 'nvidia/nv-llama-3.1-nemotron-nano-8b-v2', displayName: 'NV Nemotron Nano 8B v2', capabilities: ['chat'], contextLen: 131072 },
  { modelId: 'nvidia/usdcode-llama-3.1-70b-instruct', displayName: 'USDCode Llama 70B', capabilities: ['code', 'chat'], contextLen: 131072 },
  { modelId: 'nvidia/neva-22b', displayName: 'NeVA 22B (Vision)', capabilities: ['vision', 'chat'], contextLen: 4096 },
  { modelId: 'nvidia/nv-embed-v1', displayName: 'NV-Embed v1 (Embedding)', capabilities: ['embedding'], contextLen: 32768 },
  { modelId: 'nvidia/nv-rerankqa-mistral4b-v3', displayName: 'NV RerankQA Mistral 4B', capabilities: ['embedding'], contextLen: 8192 },
  // ─── Meta Llama family ───
  { modelId: 'meta/llama-3.3-70b-instruct', displayName: 'Llama 3.3 70B', capabilities: ['chat', 'tool-use'], contextLen: 131072 },
  { modelId: 'meta/llama-3.1-405b-instruct', displayName: 'Llama 3.1 405B', capabilities: ['chat', 'reasoning', 'tool-use'], contextLen: 131072 },
  { modelId: 'meta/llama-3.1-70b-instruct', displayName: 'Llama 3.1 70B', capabilities: ['chat', 'tool-use'], contextLen: 131072 },
  { modelId: 'meta/llama-3.1-8b-instruct', displayName: 'Llama 3.1 8B', capabilities: ['chat'], contextLen: 131072 },
  { modelId: 'meta/llama-3.2-1b-instruct', displayName: 'Llama 3.2 1B', capabilities: ['chat'], contextLen: 131072 },
  { modelId: 'meta/llama-3.2-3b-instruct', displayName: 'Llama 3.2 3B', capabilities: ['chat'], contextLen: 131072 },
  { modelId: 'meta/llama-3.2-11b-vision-instruct', displayName: 'Llama 3.2 11B Vision', capabilities: ['vision', 'chat'], contextLen: 131072 },
  { modelId: 'meta/llama-3.2-90b-vision-instruct', displayName: 'Llama 3.2 90B Vision', capabilities: ['vision', 'chat', 'reasoning'], contextLen: 131072 },
  { modelId: 'meta/llama-2-70b', displayName: 'Llama 2 70B', capabilities: ['chat'], contextLen: 4096 },
  { modelId: 'meta/llama-guard-2-8b', displayName: 'Llama Guard 2 8B', capabilities: ['chat'], contextLen: 8192 },
  { modelId: 'meta/codellama-70b', displayName: 'CodeLlama 70B', capabilities: ['code', 'chat'], contextLen: 16384 },
  // ─── Qwen family ───
  { modelId: 'qwen/qwen2.5-coder-32b-instruct', displayName: 'Qwen2.5 Coder 32B', capabilities: ['code', 'chat'], contextLen: 131072 },
  { modelId: 'qwen/qwen2.5-coder-14b-instruct', displayName: 'Qwen2.5 Coder 14B', capabilities: ['code', 'chat'], contextLen: 131072 },
  { modelId: 'qwen/qwen2.5-coder-7b-instruct', displayName: 'Qwen2.5 Coder 7B', capabilities: ['code', 'chat'], contextLen: 131072 },
  { modelId: 'qwen/qwen2.5-7b-instruct', displayName: 'Qwen2.5 7B', capabilities: ['chat', 'tool-use'], contextLen: 32768 },
  { modelId: 'qwen/qwen2.5-14b-instruct', displayName: 'Qwen2.5 14B', capabilities: ['chat', 'tool-use'], contextLen: 32768 },
  { modelId: 'qwen/qwen2.5-72b-instruct', displayName: 'Qwen2.5 72B', capabilities: ['chat', 'reasoning', 'tool-use'], contextLen: 32768 },
  { modelId: 'qwen/qwen2-vl-72b-instruct', displayName: 'Qwen2 VL 72B (Vision)', capabilities: ['vision', 'chat'], contextLen: 32768 },
  { modelId: 'qwen/qwen2-vl-7b-instruct', displayName: 'Qwen2 VL 7B (Vision)', capabilities: ['vision', 'chat'], contextLen: 32768 },
  // ─── DeepSeek family ───
  { modelId: 'deepseek-ai/deepseek-r1', displayName: 'DeepSeek R1', capabilities: ['reasoning', 'chat'], contextLen: 131072 },
  { modelId: 'deepseek-ai/deepseek-v3', displayName: 'DeepSeek V3', capabilities: ['chat', 'reasoning'], contextLen: 131072 },
  { modelId: 'deepseek-ai/deepseek-v2.5', displayName: 'DeepSeek V2.5', capabilities: ['chat', 'code'], contextLen: 131072 },
  { modelId: 'deepseek-ai/deepseek-coder-6.7b-instruct', displayName: 'DeepSeek Coder 6.7B', capabilities: ['code', 'chat'], contextLen: 16384 },
  // ─── Mistral family ───
  { modelId: 'mistralai/mistral-nemotron-70b-instruct', displayName: 'Mistral Nemotron 70B', capabilities: ['chat', 'reasoning'], contextLen: 131072 },
  { modelId: 'mistralai/mixtral-8x22b-instruct-v0.1', displayName: 'Mixtral 8x22B', capabilities: ['chat', 'code'], contextLen: 65536 },
  { modelId: 'mistralai/mistral-7b-instruct-v0.3', displayName: 'Mistral 7B v0.3', capabilities: ['chat'], contextLen: 32768 },
  { modelId: 'mistralai/mistral-large-2-instruct', displayName: 'Mistral Large 2', capabilities: ['chat', 'reasoning', 'tool-use'], contextLen: 131072 },
  { modelId: 'mistralai/codestral-22b-instruct-v0.1', displayName: 'Codestral 22B', capabilities: ['code', 'chat'], contextLen: 32768 },
  { modelId: 'mistralai/mistral-small-24b-instruct', displayName: 'Mistral Small 24B', capabilities: ['chat'], contextLen: 32768 },
  // ─── Microsoft Phi family ───
  { modelId: 'microsoft/phi-3-medium-4k-instruct', displayName: 'Phi-3 Medium 4K', capabilities: ['chat'], contextLen: 4096 },
  { modelId: 'microsoft/phi-3-mini-4k-instruct', displayName: 'Phi-3 Mini 4K', capabilities: ['chat'], contextLen: 4096 },
  { modelId: 'microsoft/phi-3-small-8k-instruct', displayName: 'Phi-3 Small 8K', capabilities: ['chat'], contextLen: 8192 },
  { modelId: 'microsoft/phi-3.5-mini-instruct', displayName: 'Phi-3.5 Mini', capabilities: ['chat'], contextLen: 131072 },
  { modelId: 'microsoft/phi-3.5-moe-instruct', displayName: 'Phi-3.5 MoE', capabilities: ['chat', 'reasoning'], contextLen: 131072 },
  { modelId: 'microsoft/phi-4', displayName: 'Phi-4', capabilities: ['reasoning', 'chat'], contextLen: 16384 },
  { modelId: 'microsoft/phi-4-multimodal-instruct', displayName: 'Phi-4 Multimodal', capabilities: ['chat', 'vision'], contextLen: 131072 },
  { modelId: 'microsoft/kosmos-2', displayName: 'Kosmos-2 (Vision)', capabilities: ['vision', 'chat'], contextLen: 4096 },
  // ─── Google Gemma family ───
  { modelId: 'google/gemma-2-9b-it', displayName: 'Gemma 2 9B', capabilities: ['chat'], contextLen: 8192 },
  { modelId: 'google/gemma-2-27b-it', displayName: 'Gemma 2 27B', capabilities: ['chat', 'reasoning'], contextLen: 8192 },
  { modelId: 'google/gemma-2-2b-it', displayName: 'Gemma 2 2B', capabilities: ['chat'], contextLen: 8192 },
  { modelId: 'google/gemma-3-4b-it', displayName: 'Gemma 3 4B', capabilities: ['chat', 'vision'], contextLen: 8192 },
  { modelId: 'google/codegemma-7b', displayName: 'CodeGemma 7B', capabilities: ['code'], contextLen: 8192 },
  // ─── IBM Granite family ───
  { modelId: 'ibm/granite-3.0-8b-instruct', displayName: 'IBM Granite 3.0 8B', capabilities: ['chat'], contextLen: 4096 },
  { modelId: 'ibm/granite-3.0-8b-base', displayName: 'IBM Granite 3.0 8B Base', capabilities: ['chat'], contextLen: 4096 },
  { modelId: 'ibm/granite-34b-code-instruct', displayName: 'IBM Granite 34B Code', capabilities: ['code'], contextLen: 8192 },
  { modelId: 'ibm/granite-3.1-8b-instruct', displayName: 'IBM Granite 3.1 8B', capabilities: ['chat'], contextLen: 131072 },
  // ─── AI21 Jamba ───
  { modelId: 'ai21labs/jamba-1.5-large-instruct', displayName: 'Jamba 1.5 Large', capabilities: ['chat'], contextLen: 256000 },
  { modelId: 'ai21labs/jamba-1.5-mini-instruct', displayName: 'Jamba 1.5 Mini', capabilities: ['chat'], contextLen: 256000 },
  // ─── Other ───
  { modelId: 'aisingapore/sea-lion-7b-instruct', displayName: 'SEA-LION 7B', capabilities: ['chat'], contextLen: 4096 },
  { modelId: 'baai/bge-m3', displayName: 'BGE-M3 (Embedding)', capabilities: ['embedding'], contextLen: 8192 },
  { modelId: '01-ai/yi-large', displayName: 'Yi Large', capabilities: ['chat', 'reasoning'], contextLen: 32768 },
]

export const ZAI_MODELS: ModelDescriptor[] = [
  // ── GLM-5.x — latest flagship models (per docs.z.ai/guides/llm/glm-5.1
  // and docs.z.ai/guides/llm/glm-5-turbo) ──
  // GLM-5.1: aligned with Claude Opus 4.6, 8-hour long-horizon tasks, 200K ctx, 128K out
  { modelId: 'glm-5.1', displayName: 'GLM-5.1 (Flagship)', capabilities: ['chat', 'reasoning', 'tool-use', 'code'], contextLen: 200000 },
  // GLM-5-Turbo: optimized for OpenClaw/agentic workflows, 200K ctx, 128K out
  { modelId: 'glm-5-turbo', displayName: 'GLM-5-Turbo (Agentic)', capabilities: ['chat', 'reasoning', 'tool-use'], contextLen: 200000 },
  // GLM-4.6 — still a strong general model
  { modelId: 'glm-4.6', displayName: 'GLM-4.6', capabilities: ['chat', 'reasoning', 'tool-use'], contextLen: 128000 },
  { modelId: 'glm-4.5-air', displayName: 'GLM-4.5 Air', capabilities: ['chat', 'tool-use'], contextLen: 128000 },
  { modelId: 'glm-4.5v', displayName: 'GLM-4.5V (Vision)', capabilities: ['vision', 'chat'], contextLen: 64000 },
  { modelId: 'glm-4.5-flash', displayName: 'GLM-4.5 Flash (Free)', capabilities: ['chat'], contextLen: 128000 },
  { modelId: 'glm-4-plus', displayName: 'GLM-4 Plus', capabilities: ['chat', 'reasoning'], contextLen: 131072 },
  { modelId: 'glm-4-air', displayName: 'GLM-4 Air', capabilities: ['chat'], contextLen: 131072 },
  { modelId: 'glm-4-flash', displayName: 'GLM-4 Flash (Free)', capabilities: ['chat'], contextLen: 131072 },
  { modelId: 'glm-4-long', displayName: 'GLM-4 Long', capabilities: ['chat'], contextLen: 1000000 },
  { modelId: 'glm-4v', displayName: 'GLM-4V (Vision)', capabilities: ['vision', 'chat'], contextLen: 8192 },
  { modelId: 'glm-zero-preview', displayName: 'GLM-Zero Preview', capabilities: ['reasoning', 'chat'], contextLen: 131072 },
  { modelId: 'glm-4-0520', displayName: 'GLM-4 0520', capabilities: ['chat', 'tool-use'], contextLen: 131072 },
  { modelId: 'glm-4-air-0111', displayName: 'GLM-4 Air 0111', capabilities: ['chat'], contextLen: 131072 },
  { modelId: 'glm-3-turbo', displayName: 'GLM-3 Turbo', capabilities: ['chat'], contextLen: 131072 },
  { modelId: 'cogview-3-plus', displayName: 'CogView 3 Plus (Image Gen)', capabilities: ['vision'], contextLen: 0 },
  { modelId: 'cogview-3', displayName: 'CogView 3 (Image Gen)', capabilities: ['vision'], contextLen: 0 },
]

export const QWEN_PLAYGROUND_MODELS: ModelDescriptor[] = [
  // ── Qwen3-2507 (released July 2025) — latest flagship ──
  // 256K context (extendable to 1M), Instruct + Thinking variants
  // Sizes: 235B-A22B (flagship MoE), 30B-A3B (medium MoE), 4B (small dense)
  // Per https://github.com/QwenLM/Qwen3 — supports thinking mode toggle,
  // 100+ languages, superior agent tool-use capabilities.
  { modelId: 'qwen3-235b-a22b-instruct-2507', displayName: 'Qwen3 235B Instruct 2507 (Flagship)', capabilities: ['chat', 'reasoning', 'tool-use', 'code'], contextLen: 262144 },
  { modelId: 'qwen3-235b-a22b-thinking-2507', displayName: 'Qwen3 235B Thinking 2507 (Reasoning)', capabilities: ['reasoning', 'chat', 'code'], contextLen: 262144 },
  { modelId: 'qwen3-30b-a3b-instruct-2507', displayName: 'Qwen3 30B-A3B Instruct 2507', capabilities: ['chat', 'reasoning', 'tool-use'], contextLen: 262144 },
  { modelId: 'qwen3-30b-a3b-thinking-2507', displayName: 'Qwen3 30B-A3B Thinking 2507', capabilities: ['reasoning', 'chat'], contextLen: 262144 },
  { modelId: 'qwen3-4b-instruct-2507', displayName: 'Qwen3 4B Instruct 2507', capabilities: ['chat', 'tool-use'], contextLen: 262144 },
  { modelId: 'qwen3-4b-thinking-2507', displayName: 'Qwen3 4B Thinking 2507', capabilities: ['reasoning', 'chat'], contextLen: 262144 },
  // ── Qwen3 (April 2025 release — first Qwen3) ──
  { modelId: 'qwen3-235b-a22b', displayName: 'Qwen3 235B-A22B', capabilities: ['chat', 'reasoning', 'tool-use', 'code'], contextLen: 131072 },
  { modelId: 'qwen3-30b-a3b', displayName: 'Qwen3 30B-A3B', capabilities: ['chat', 'reasoning', 'tool-use'], contextLen: 131072 },
  { modelId: 'qwen3-32b', displayName: 'Qwen3 32B', capabilities: ['chat', 'reasoning'], contextLen: 131072 },
  { modelId: 'qwen3-14b', displayName: 'Qwen3 14B', capabilities: ['chat', 'reasoning'], contextLen: 131072 },
  { modelId: 'qwen3-8b', displayName: 'Qwen3 8B', capabilities: ['chat', 'tool-use'], contextLen: 131072 },
  { modelId: 'qwen3-4b', displayName: 'Qwen3 4B', capabilities: ['chat'], contextLen: 131072 },
  { modelId: 'qwen3-1.7b', displayName: 'Qwen3 1.7B', capabilities: ['chat'], contextLen: 32768 },
  { modelId: 'qwen3-0.6b', displayName: 'Qwen3 0.6B', capabilities: ['chat'], contextLen: 32768 },
  // ── Qwen2.5 series (still supported) ──
  { modelId: 'qwen-max', displayName: 'Qwen Max', capabilities: ['chat', 'reasoning', 'tool-use'], contextLen: 32768 },
  { modelId: 'qwen-max-latest', displayName: 'Qwen Max Latest', capabilities: ['chat', 'reasoning', 'tool-use'], contextLen: 32768 },
  { modelId: 'qwen-plus', displayName: 'Qwen Plus', capabilities: ['chat', 'tool-use'], contextLen: 131072 },
  { modelId: 'qwen-plus-latest', displayName: 'Qwen Plus Latest', capabilities: ['chat', 'tool-use'], contextLen: 131072 },
  { modelId: 'qwen-turbo', displayName: 'Qwen Turbo', capabilities: ['chat'], contextLen: 1000000 },
  { modelId: 'qwen-turbo-latest', displayName: 'Qwen Turbo Latest', capabilities: ['chat'], contextLen: 1000000 },
  { modelId: 'qwen2.5-72b-instruct', displayName: 'Qwen2.5 72B', capabilities: ['chat', 'reasoning', 'tool-use'], contextLen: 131072 },
  { modelId: 'qwen2.5-coder-32b-instruct', displayName: 'Qwen2.5 Coder 32B', capabilities: ['code', 'chat'], contextLen: 131072 },
  { modelId: 'qwen-coder-plus', displayName: 'Qwen Coder Plus', capabilities: ['code', 'chat'], contextLen: 131072 },
  { modelId: 'qwen-coder-plus-latest', displayName: 'Qwen Coder Plus Latest', capabilities: ['code', 'chat'], contextLen: 131072 },
  { modelId: 'qwen-vl-max', displayName: 'Qwen VL Max', capabilities: ['vision', 'chat'], contextLen: 32768 },
  { modelId: 'qwen-vl-plus', displayName: 'Qwen VL Plus', capabilities: ['vision', 'chat'], contextLen: 32768 },
  { modelId: 'qwen-long', displayName: 'Qwen Long', capabilities: ['chat'], contextLen: 10000000 },
  { modelId: 'qwq-32b-preview', displayName: 'QwQ 32B Preview (Reasoning)', capabilities: ['reasoning', 'chat'], contextLen: 32768 },
]

// Browser-login models (OpenRouter-style free tier or HuggingFace Chat via cookies)
export const BROWSER_LOGIN_MODELS: ModelDescriptor[] = [
  // ─── Per-playground models (browser:<provider>) ─── 18 playgrounds ───
  { modelId: 'browser:zai', displayName: 'Z.ai · GLM-4.6 (browser)', capabilities: ['chat', 'reasoning', 'tool-use'], contextLen: 128000 },
  { modelId: 'browser:qwen', displayName: 'Qwen Chat (browser)', capabilities: ['chat', 'reasoning'], contextLen: 131072 },
  { modelId: 'browser:openai', displayName: 'ChatGPT · GPT-4o (browser)', capabilities: ['chat', 'vision', 'reasoning', 'tool-use'], contextLen: 128000 },
  { modelId: 'browser:huggingface', displayName: 'HuggingChat (browser)', capabilities: ['chat'], contextLen: 131072 },
  { modelId: 'browser:gemini', displayName: 'Google Gemini (browser)', capabilities: ['chat', 'vision', 'reasoning'], contextLen: 1000000 },
  { modelId: 'browser:claude', displayName: 'Claude (browser)', capabilities: ['chat', 'reasoning', 'tool-use'], contextLen: 200000 },
  { modelId: 'browser:mistral', displayName: 'Mistral Le Chat (browser)', capabilities: ['chat', 'code'], contextLen: 131072 },
  { modelId: 'browser:deepseek', displayName: 'DeepSeek Chat (browser)', capabilities: ['chat', 'reasoning'], contextLen: 64000 },
  { modelId: 'browser:grok', displayName: 'Grok · x.ai (browser)', capabilities: ['chat', 'reasoning'], contextLen: 131072 },
  { modelId: 'browser:perplexity', displayName: 'Perplexity (browser)', capabilities: ['chat', 'reasoning'], contextLen: 131072 },
  { modelId: 'browser:you', displayName: 'You.com (browser)', capabilities: ['chat', 'reasoning'], contextLen: 131072 },
  { modelId: 'browser:phind', displayName: 'Phind (browser)', capabilities: ['chat', 'code', 'reasoning'], contextLen: 131072 },
  { modelId: 'browser:cohere', displayName: 'Cohere Coral (browser)', capabilities: ['chat', 'tool-use'], contextLen: 131072 },
  { modelId: 'browser:aistudio', displayName: 'Google AI Studio (browser)', capabilities: ['chat', 'vision', 'code'], contextLen: 2000000 },
  { modelId: 'browser:nvidia', displayName: 'NVIDIA Build (browser)', capabilities: ['chat', 'code', 'reasoning'], contextLen: 131072 },
  { modelId: 'browser:groq', displayName: 'Groq Playground (browser)', capabilities: ['chat'], contextLen: 131072 },
  { modelId: 'browser:together', displayName: 'Together AI (browser)', capabilities: ['chat', 'code'], contextLen: 131072 },
  { modelId: 'browser:replicate', displayName: 'Replicate (browser)', capabilities: ['chat'], contextLen: 131072 },
  // ─── NVIDIA build.nvidia.com sample models (ALL available on the playground) ───
  { modelId: 'browser:nvidia:nvidia/llama-3.1-nemotron-70b-instruct', displayName: 'NVIDIA · Nemotron 70B (browser)', capabilities: ['chat', 'reasoning', 'tool-use'], contextLen: 131072 },
  { modelId: 'browser:nvidia:nvidia/llama-3.1-nemotron-nano-8b-v1', displayName: 'NVIDIA · Nemotron Nano 8B (browser)', capabilities: ['chat'], contextLen: 131072 },
  { modelId: 'browser:nvidia:nvidia/llama-3.3-nemotron-super-49b-v1', displayName: 'NVIDIA · Nemotron Super 49B (browser)', capabilities: ['chat', 'reasoning'], contextLen: 131072 },
  { modelId: 'browser:nvidia:meta/llama-3.3-70b-instruct', displayName: 'NVIDIA · Llama 3.3 70B (browser)', capabilities: ['chat', 'tool-use'], contextLen: 131072 },
  { modelId: 'browser:nvidia:meta/llama-3.1-405b-instruct', displayName: 'NVIDIA · Llama 3.1 405B (browser)', capabilities: ['chat', 'reasoning'], contextLen: 131072 },
  { modelId: 'browser:nvidia:meta/llama-3.1-70b-instruct', displayName: 'NVIDIA · Llama 3.1 70B (browser)', capabilities: ['chat', 'tool-use'], contextLen: 131072 },
  { modelId: 'browser:nvidia:meta/llama-3.1-8b-instruct', displayName: 'NVIDIA · Llama 3.1 8B (browser)', capabilities: ['chat'], contextLen: 131072 },
  { modelId: 'browser:nvidia:meta/llama-3.2-1b-instruct', displayName: 'NVIDIA · Llama 3.2 1B (browser)', capabilities: ['chat'], contextLen: 131072 },
  { modelId: 'browser:nvidia:meta/llama-3.2-3b-instruct', displayName: 'NVIDIA · Llama 3.2 3B (browser)', capabilities: ['chat'], contextLen: 131072 },
  { modelId: 'browser:nvidia:meta/llama-3.2-11b-vision-instruct', displayName: 'NVIDIA · Llama 3.2 11B Vision (browser)', capabilities: ['vision', 'chat'], contextLen: 131072 },
  { modelId: 'browser:nvidia:meta/llama-3.2-90b-vision-instruct', displayName: 'NVIDIA · Llama 3.2 90B Vision (browser)', capabilities: ['vision', 'chat', 'reasoning'], contextLen: 131072 },
  { modelId: 'browser:nvidia:qwen/qwen2.5-coder-32b-instruct', displayName: 'NVIDIA · Qwen2.5 Coder 32B (browser)', capabilities: ['code', 'chat'], contextLen: 131072 },
  { modelId: 'browser:nvidia:qwen/qwen2.5-coder-14b-instruct', displayName: 'NVIDIA · Qwen2.5 Coder 14B (browser)', capabilities: ['code', 'chat'], contextLen: 131072 },
  { modelId: 'browser:nvidia:qwen/qwen2.5-coder-7b-instruct', displayName: 'NVIDIA · Qwen2.5 Coder 7B (browser)', capabilities: ['code', 'chat'], contextLen: 131072 },
  { modelId: 'browser:nvidia:qwen/qwen2.5-7b-instruct', displayName: 'NVIDIA · Qwen2.5 7B (browser)', capabilities: ['chat'], contextLen: 32768 },
  { modelId: 'browser:nvidia:qwen/qwen2.5-14b-instruct', displayName: 'NVIDIA · Qwen2.5 14B (browser)', capabilities: ['chat'], contextLen: 32768 },
  { modelId: 'browser:nvidia:qwen/qwen2.5-72b-instruct', displayName: 'NVIDIA · Qwen2.5 72B (browser)', capabilities: ['chat', 'reasoning'], contextLen: 32768 },
  { modelId: 'browser:nvidia:qwen/qwen2-vl-72b-instruct', displayName: 'NVIDIA · Qwen2 VL 72B Vision (browser)', capabilities: ['vision', 'chat'], contextLen: 32768 },
  { modelId: 'browser:nvidia:deepseek-ai/deepseek-r1', displayName: 'NVIDIA · DeepSeek R1 (browser)', capabilities: ['reasoning', 'chat'], contextLen: 131072 },
  { modelId: 'browser:nvidia:deepseek-ai/deepseek-v3', displayName: 'NVIDIA · DeepSeek V3 (browser)', capabilities: ['chat', 'reasoning'], contextLen: 131072 },
  { modelId: 'browser:nvidia:deepseek-ai/deepseek-v2.5', displayName: 'NVIDIA · DeepSeek V2.5 (browser)', capabilities: ['chat', 'code'], contextLen: 131072 },
  { modelId: 'browser:nvidia:mistralai/mistral-nemotron-70b-instruct', displayName: 'NVIDIA · Mistral Nemotron 70B (browser)', capabilities: ['chat', 'reasoning'], contextLen: 131072 },
  { modelId: 'browser:nvidia:mistralai/mixtral-8x22b-instruct-v0.1', displayName: 'NVIDIA · Mixtral 8x22B (browser)', capabilities: ['chat', 'code'], contextLen: 65536 },
  { modelId: 'browser:nvidia:mistralai/mistral-7b-instruct-v0.3', displayName: 'NVIDIA · Mistral 7B v0.3 (browser)', capabilities: ['chat'], contextLen: 32768 },
  { modelId: 'browser:nvidia:mistralai/codestral-22b-instruct-v0.1', displayName: 'NVIDIA · Codestral 22B (browser)', capabilities: ['code', 'chat'], contextLen: 32768 },
  { modelId: 'browser:nvidia:microsoft/phi-3-medium-4k-instruct', displayName: 'NVIDIA · Phi-3 Medium (browser)', capabilities: ['chat'], contextLen: 4096 },
  { modelId: 'browser:nvidia:microsoft/phi-3-mini-4k-instruct', displayName: 'NVIDIA · Phi-3 Mini (browser)', capabilities: ['chat'], contextLen: 4096 },
  { modelId: 'browser:nvidia:microsoft/phi-3.5-mini-instruct', displayName: 'NVIDIA · Phi-3.5 Mini (browser)', capabilities: ['chat'], contextLen: 131072 },
  { modelId: 'browser:nvidia:microsoft/phi-4', displayName: 'NVIDIA · Phi-4 (browser)', capabilities: ['reasoning', 'chat'], contextLen: 16384 },
  { modelId: 'browser:nvidia:google/gemma-2-9b-it', displayName: 'NVIDIA · Gemma 2 9B (browser)', capabilities: ['chat'], contextLen: 8192 },
  { modelId: 'browser:nvidia:google/gemma-2-27b-it', displayName: 'NVIDIA · Gemma 2 27B (browser)', capabilities: ['chat', 'reasoning'], contextLen: 8192 },
  { modelId: 'browser:nvidia:google/gemma-2-2b-it', displayName: 'NVIDIA · Gemma 2 2B (browser)', capabilities: ['chat'], contextLen: 8192 },
  { modelId: 'browser:nvidia:ibm/granite-3.0-8b-instruct', displayName: 'NVIDIA · IBM Granite 3.0 (browser)', capabilities: ['chat'], contextLen: 4096 },
  { modelId: 'browser:nvidia:ibm/granite-3.1-8b-instruct', displayName: 'NVIDIA · IBM Granite 3.1 (browser)', capabilities: ['chat'], contextLen: 131072 },
  { modelId: 'browser:nvidia:ai21labs/jamba-1.5-large-instruct', displayName: 'NVIDIA · Jamba 1.5 Large (browser)', capabilities: ['chat'], contextLen: 256000 },
  { modelId: 'browser:nvidia:ai21labs/jamba-1.5-mini-instruct', displayName: 'NVIDIA · Jamba 1.5 Mini (browser)', capabilities: ['chat'], contextLen: 256000 },
  { modelId: 'browser:nvidia:01-ai/yi-large', displayName: 'NVIDIA · Yi Large (browser)', capabilities: ['chat', 'reasoning'], contextLen: 32768 },
  // Legacy IDs
  { modelId: 'huggingface://meta-llama/Llama-3.3-70B-Instruct', displayName: 'HF Chat · Llama 3.3 70B', capabilities: ['chat'], contextLen: 131072 },
  { modelId: 'groq://llama-3.3-70b-versatile', displayName: 'Groq · Llama 3.3 70B', capabilities: ['chat', 'tool-use'], contextLen: 131072 },
]

// ─── FREE / LOCAL providers (z.ai-clone direction) ───────────────────────────
// GitHub Models — free with a GitHub Personal Access Token (no payment needed).
// OpenAI-compatible API. https://docs.github.com/en/github-models
export const GITHUB_MODELS: ModelDescriptor[] = [
  { modelId: 'gpt-4o', displayName: 'GPT-4o (GitHub Models)', capabilities: ['chat', 'vision', 'tool-use', 'reasoning'], contextLen: 128000 },
  { modelId: 'gpt-4o-mini', displayName: 'GPT-4o mini (GitHub Models)', capabilities: ['chat', 'vision', 'tool-use'], contextLen: 128000 },
  { modelId: 'gpt-4.1', displayName: 'GPT-4.1 (GitHub Models)', capabilities: ['chat', 'reasoning', 'tool-use'], contextLen: 1000000 },
  { modelId: 'gpt-4.1-mini', displayName: 'GPT-4.1 mini (GitHub Models)', capabilities: ['chat', 'tool-use'], contextLen: 1000000 },
  { modelId: 'gpt-4.1-nano', displayName: 'GPT-4.1 nano (GitHub Models)', capabilities: ['chat'], contextLen: 1000000 },
  { modelId: 'o1', displayName: 'o1 (GitHub Models)', capabilities: ['reasoning', 'chat'], contextLen: 200000 },
  { modelId: 'o1-mini', displayName: 'o1-mini (GitHub Models)', capabilities: ['reasoning', 'chat'], contextLen: 128000 },
  { modelId: 'o3-mini', displayName: 'o3-mini (GitHub Models)', capabilities: ['reasoning', 'chat', 'tool-use'], contextLen: 200000 },
  { modelId: 'Meta-Llama-3.3-70B-Instruct', displayName: 'Llama 3.3 70B (GitHub Models)', capabilities: ['chat', 'tool-use'], contextLen: 131072 },
  { modelId: 'meta-Llama-3.2-11B-Vision-Instruct', displayName: 'Llama 3.2 11B Vision (GitHub)', capabilities: ['vision', 'chat'], contextLen: 131072 },
  { modelId: 'meta-Llama-3.2-1B-Instruct', displayName: 'Llama 3.2 1B (GitHub)', capabilities: ['chat'], contextLen: 131072 },
  { modelId: 'meta-Llama-3.2-3B-Instruct', displayName: 'Llama 3.2 3B (GitHub)', capabilities: ['chat'], contextLen: 131072 },
  { modelId: 'Mistral-large-2411', displayName: 'Mistral Large (GitHub Models)', capabilities: ['chat', 'reasoning', 'tool-use'], contextLen: 128000 },
  { modelId: 'Mistral-Nemo', displayName: 'Mistral Nemo (GitHub Models)', capabilities: ['chat'], contextLen: 131072 },
  { modelId: 'mistral-small-2501', displayName: 'Mistral Small (GitHub Models)', capabilities: ['chat'], contextLen: 32768 },
  { modelId: 'codestral-2501', displayName: 'Codestral (GitHub Models)', capabilities: ['code', 'chat'], contextLen: 256000 },
  { modelId: 'microsoft/Phi-4', displayName: 'Phi-4 (GitHub Models)', capabilities: ['reasoning', 'chat'], contextLen: 16384 },
  { modelId: 'microsoft/Phi-3.5-mini-instruct', displayName: 'Phi-3.5 Mini (GitHub)', capabilities: ['chat'], contextLen: 131072 },
  { modelId: 'microsoft/Phi-3-medium-4k-instruct', displayName: 'Phi-3 Medium (GitHub)', capabilities: ['chat'], contextLen: 4096 },
  { modelId: 'AI21-Jamba-1.5-Large', displayName: 'Jamba 1.5 Large (GitHub Models)', capabilities: ['chat'], contextLen: 256000 },
  { modelId: 'AI21-Jamba-1.5-Mini', displayName: 'Jamba 1.5 Mini (GitHub Models)', capabilities: ['chat'], contextLen: 256000 },
  { modelId: 'cohere-command-r-plus-08-2024', displayName: 'Command R+ (GitHub Models)', capabilities: ['chat', 'tool-use'], contextLen: 128000 },
  { modelId: 'cohere-command-r-08-2024', displayName: 'Command R (GitHub Models)', capabilities: ['chat', 'tool-use'], contextLen: 128000 },
  { modelId: 'deepseek/DeepSeek-V3', displayName: 'DeepSeek V3 (GitHub Models)', capabilities: ['chat', 'reasoning'], contextLen: 64000 },
  { modelId: 'xai/grok-2-vision-1212', displayName: 'Grok 2 Vision (GitHub Models)', capabilities: ['vision', 'chat'], contextLen: 32768 },
  { modelId: 'xai/grok-3-beta', displayName: 'Grok 3 Beta (GitHub Models)', capabilities: ['chat', 'reasoning'], contextLen: 131072 },
  { modelId: 'xai/grok-3-mini-beta', displayName: 'Grok 3 Mini (GitHub Models)', capabilities: ['chat', 'reasoning'], contextLen: 131072 },
]

// HuggingFace Inference API — free tier, OpenAI-compatible router.
// https://huggingface.co/blog/inference-providers — uses HF token.
export const HUGGINGFACE_MODELS: ModelDescriptor[] = [
  { modelId: 'meta-llama/Llama-3.3-70B-Instruct', displayName: 'Llama 3.3 70B (HF)', capabilities: ['chat', 'tool-use'], contextLen: 131072 },
  { modelId: 'meta-llama/Llama-3.1-8B-Instruct', displayName: 'Llama 3.1 8B (HF)', capabilities: ['chat'], contextLen: 131072 },
  { modelId: 'meta-llama/Llama-3.1-70B-Instruct', displayName: 'Llama 3.1 70B (HF)', capabilities: ['chat', 'tool-use'], contextLen: 131072 },
  { modelId: 'meta-llama/Llama-3.2-1B-Instruct', displayName: 'Llama 3.2 1B (HF)', capabilities: ['chat'], contextLen: 131072 },
  { modelId: 'meta-llama/Llama-3.2-3B-Instruct', displayName: 'Llama 3.2 3B (HF)', capabilities: ['chat'], contextLen: 131072 },
  { modelId: 'Qwen/Qwen2.5-72B-Instruct', displayName: 'Qwen 2.5 72B (HF)', capabilities: ['chat', 'tool-use'], contextLen: 32768 },
  { modelId: 'Qwen/Qwen2.5-7B-Instruct', displayName: 'Qwen 2.5 7B (HF)', capabilities: ['chat'], contextLen: 32768 },
  { modelId: 'Qwen/Qwen2.5-14B-Instruct', displayName: 'Qwen 2.5 14B (HF)', capabilities: ['chat'], contextLen: 32768 },
  { modelId: 'Qwen/Qwen2.5-Coder-7B-Instruct', displayName: 'Qwen 2.5 Coder 7B (HF)', capabilities: ['code', 'chat'], contextLen: 32768 },
  { modelId: 'Qwen/Qwen2.5-Coder-32B-Instruct', displayName: 'Qwen 2.5 Coder 32B (HF)', capabilities: ['code', 'chat'], contextLen: 32768 },
  { modelId: 'deepseek-ai/DeepSeek-V3', displayName: 'DeepSeek V3 (HF)', capabilities: ['chat', 'reasoning'], contextLen: 64000 },
  { modelId: 'deepseek-ai/DeepSeek-R1', displayName: 'DeepSeek R1 (HF)', capabilities: ['reasoning', 'chat'], contextLen: 64000 },
  { modelId: 'deepseek-ai/DeepSeek-V2.5', displayName: 'DeepSeek V2.5 (HF)', capabilities: ['chat', 'code'], contextLen: 32768 },
  { modelId: 'mistralai/Mistral-7B-Instruct-v0.3', displayName: 'Mistral 7B v0.3 (HF)', capabilities: ['chat'], contextLen: 32768 },
  { modelId: 'mistralai/Mixtral-8x7B-Instruct-v0.1', displayName: 'Mixtral 8x7B (HF)', capabilities: ['chat', 'tool-use'], contextLen: 32768 },
  { modelId: 'mistralai/Mistral-Nemo-Instruct-2407', displayName: 'Mistral Nemo (HF)', capabilities: ['chat'], contextLen: 131072 },
  { modelId: 'mistralai/Codestral-22B-v0.1', displayName: 'Codestral 22B (HF)', capabilities: ['code', 'chat'], contextLen: 32768 },
  // FIX (H1 / audit 2026-07-10): Prefix HF model IDs that duplicate other providers
  // with 'hf:' namespace to prevent duplicate React keys in SelectContent.
  { modelId: 'hf:google/gemma-2-9b-it', displayName: 'Gemma 2 9B (HF)', capabilities: ['chat'], contextLen: 8192 },
  { modelId: 'hf:google/gemma-2-27b-it', displayName: 'Gemma 2 27B (HF)', capabilities: ['chat', 'reasoning'], contextLen: 8192 },
  { modelId: 'hf:google/gemma-2-2b-it', displayName: 'Gemma 2 2B (HF)', capabilities: ['chat'], contextLen: 8192 },
  { modelId: 'hf:microsoft/Phi-3.5-mini-instruct', displayName: 'Phi-3.5 Mini (HF)', capabilities: ['chat'], contextLen: 128000 },
  { modelId: 'microsoft/Phi-3.5-MoE-instruct', displayName: 'Phi-3.5 MoE (HF)', capabilities: ['chat', 'reasoning'], contextLen: 131072 },
  { modelId: 'hf:HuggingFaceH4/zephyr-7b-beta', displayName: 'Zephyr 7B Beta (HF)', capabilities: ['chat'], contextLen: 4096 },
  { modelId: 'hf:NousResearch/Hermes-3-Llama-3.1-8B', displayName: 'Hermes 3 Llama 8B (HF)', capabilities: ['chat', 'tool-use'], contextLen: 131072 },
  { modelId: 'hf:01-ai/Yi-1.5-34B-Chat', displayName: 'Yi 1.5 34B Chat (HF)', capabilities: ['chat'], contextLen: 4096 },
  { modelId: 'hf:tiiuae/falcon-180B-chat', displayName: 'Falcon 180B Chat (HF)', capabilities: ['chat'], contextLen: 8192 },
]

// Higgsfield — free-tier media generation (image + video).
// Stored as a provider so the dashboard can route generation requests to it.
export const HIGGSFIELD_MODELS: ModelDescriptor[] = [
  { modelId: 'higgsfield:diffuse-large', displayName: 'Higgsfield · Diffuse (I2V)', capabilities: ['vision'], contextLen: 0 },
  { modelId: 'higgsfield:flux-dev', displayName: 'Higgsfield · Flux Dev (Image)', capabilities: ['vision'], contextLen: 0 },
  { modelId: 'higgsfield:sd3.5-large', displayName: 'Higgsfield · SD 3.5 Large (Image)', capabilities: ['vision'], contextLen: 0 },
]

// ─── Groq — free, fastest inference (~500 tok/s), OpenAI-compatible ──────────
// Get key: https://console.groq.com/keys  ·  Free tier: 30 req/min, 14,400 req/day.
// Base URL: https://api.groq.com/openai/v1
export const GROQ_MODELS: ModelDescriptor[] = [
  { modelId: 'llama-3.3-70b-versatile', displayName: 'Llama 3.3 70B Versatile (Groq)', capabilities: ['chat', 'tool-use'], contextLen: 131072 },
  { modelId: 'llama-3.1-8b-instant', displayName: 'Llama 3.1 8B Instant (Groq)', capabilities: ['chat', 'tool-use'], contextLen: 131072 },
  { modelId: 'llama-3.1-70b-versatile', displayName: 'Llama 3.1 70B Versatile (Groq)', capabilities: ['chat', 'tool-use'], contextLen: 131072 },
  { modelId: 'llama3-70b-8192', displayName: 'Llama 3 70B (Groq)', capabilities: ['chat'], contextLen: 8192 },
  { modelId: 'llama3-8b-8192', displayName: 'Llama 3 8B (Groq)', capabilities: ['chat'], contextLen: 8192 },
  { modelId: 'mixtral-8x7b-32768', displayName: 'Mixtral 8x7B (Groq)', capabilities: ['chat', 'tool-use'], contextLen: 32768 },
  { modelId: 'gemma2-9b-it', displayName: 'Gemma 2 9B (Groq)', capabilities: ['chat'], contextLen: 8192 },
  { modelId: 'gemma-7b-it', displayName: 'Gemma 7B (Groq)', capabilities: ['chat'], contextLen: 8192 },
  { modelId: 'deepseek-r1-distill-llama-70b', displayName: 'DeepSeek R1 Distill Llama 70B (Groq)', capabilities: ['reasoning', 'chat'], contextLen: 131072 },
  { modelId: 'deepseek-r1-distill-qwen-32b', displayName: 'DeepSeek R1 Distill Qwen 32B (Groq)', capabilities: ['reasoning', 'chat'], contextLen: 131072 },
  { modelId: 'qwen-2.5-32b', displayName: 'Qwen 2.5 32B (Groq)', capabilities: ['chat', 'reasoning'], contextLen: 131072 },
  { modelId: 'qwen-2.5-coder-32b', displayName: 'Qwen 2.5 Coder 32B (Groq)', capabilities: ['code', 'chat'], contextLen: 131072 },
  { modelId: 'llama-3.2-1b-preview', displayName: 'Llama 3.2 1B Preview (Groq)', capabilities: ['chat'], contextLen: 8192 },
  { modelId: 'llama-3.2-3b-preview', displayName: 'Llama 3.2 3B Preview (Groq)', capabilities: ['chat'], contextLen: 8192 },
  { modelId: 'llama-3.2-11b-vision-preview', displayName: 'Llama 3.2 11B Vision (Groq)', capabilities: ['vision', 'chat'], contextLen: 8192 },
  { modelId: 'llama-3.2-90b-vision-preview', displayName: 'Llama 3.2 90B Vision (Groq)', capabilities: ['vision', 'chat', 'reasoning'], contextLen: 8192 },
]

// ─── OpenAI (paid) — GPT-4o / o-series, only enabled if OPENAI_API_KEY is set ─
export const OPENAI_MODELS: ModelDescriptor[] = [
  { modelId: 'gpt-4o', displayName: 'GPT-4o (OpenAI)', capabilities: ['chat', 'vision', 'tool-use', 'reasoning'], contextLen: 128000 },
  { modelId: 'gpt-4o-mini', displayName: 'GPT-4o mini (OpenAI)', capabilities: ['chat', 'vision', 'tool-use'], contextLen: 128000 },
  { modelId: 'gpt-4.1', displayName: 'GPT-4.1 (OpenAI)', capabilities: ['chat', 'reasoning', 'tool-use'], contextLen: 1000000 },
  { modelId: 'gpt-4.1-mini', displayName: 'GPT-4.1 mini (OpenAI)', capabilities: ['chat', 'tool-use'], contextLen: 1000000 },
  { modelId: 'o1', displayName: 'o1 (OpenAI)', capabilities: ['reasoning', 'chat'], contextLen: 200000 },
  { modelId: 'o1-mini', displayName: 'o1-mini (OpenAI)', capabilities: ['reasoning', 'chat'], contextLen: 128000 },
  { modelId: 'o3-mini', displayName: 'o3-mini (OpenAI)', capabilities: ['reasoning', 'chat', 'tool-use'], contextLen: 200000 },
]

// ─── Bytez — Free AI model gateway (OpenAI-compatible) ───────────────────────
// Get key: https://bytez.com/  ·  Free tier: access to 100+ open-source models
// Base URL: https://api.bytez.com/v1  ·  OpenAI-compatible chat/completions API
// Models are referenced by their HuggingFace model ID (e.g. "meta-llama/Llama-3.1-8B-Instruct")
export const BYTEZ_MODELS: ModelDescriptor[] = [
  { modelId: 'meta-llama/Llama-3.3-70B-Instruct', displayName: 'Llama 3.3 70B (Bytez)', capabilities: ['chat', 'tool-use'], contextLen: 131072 },
  { modelId: 'meta-llama/Llama-3.1-8B-Instruct', displayName: 'Llama 3.1 8B (Bytez)', capabilities: ['chat'], contextLen: 131072 },
  { modelId: 'meta-llama/Llama-3.1-70B-Instruct', displayName: 'Llama 3.1 70B (Bytez)', capabilities: ['chat', 'tool-use'], contextLen: 131072 },
  { modelId: 'Qwen/Qwen2.5-72B-Instruct', displayName: 'Qwen 2.5 72B (Bytez)', capabilities: ['chat', 'reasoning'], contextLen: 32768 },
  { modelId: 'Qwen/Qwen2.5-7B-Instruct', displayName: 'Qwen 2.5 7B (Bytez)', capabilities: ['chat'], contextLen: 32768 },
  { modelId: 'Qwen/Qwen2.5-Coder-32B-Instruct', displayName: 'Qwen 2.5 Coder 32B (Bytez)', capabilities: ['code', 'chat'], contextLen: 32768 },
  // FIX (H1 / audit 2026-07-10): Prefix Bytez model IDs that duplicate other providers
  // with 'bytez:' namespace to prevent duplicate React keys.
  { modelId: 'bytez:mistralai/Mistral-7B-Instruct-v0.3', displayName: 'Mistral 7B v0.3 (Bytez)', capabilities: ['chat'], contextLen: 32768 },
  { modelId: 'bytez:mistralai/Mixtral-8x7B-Instruct-v0.1', displayName: 'Mixtral 8x7B (Bytez)', capabilities: ['chat', 'tool-use'], contextLen: 32768 },
  { modelId: 'deepseek-ai/deepseek-v3', displayName: 'DeepSeek V3 (Bytez)', capabilities: ['chat', 'reasoning'], contextLen: 64000 },
  { modelId: 'deepseek-ai/deepseek-r1', displayName: 'DeepSeek R1 (Bytez)', capabilities: ['reasoning', 'chat'], contextLen: 64000 },
  { modelId: 'bytez:google/gemma-2-9b-it', displayName: 'Gemma 2 9B (Bytez)', capabilities: ['chat'], contextLen: 8192 },
  { modelId: 'bytez:google/gemma-2-27b-it', displayName: 'Gemma 2 27B (Bytez)', capabilities: ['chat', 'reasoning'], contextLen: 8192 },
  { modelId: 'bytez:microsoft/Phi-3.5-mini-instruct', displayName: 'Phi-3.5 Mini (Bytez)', capabilities: ['chat'], contextLen: 131072 },
  { modelId: 'bytez:HuggingFaceH4/zephyr-7b-beta', displayName: 'Zephyr 7B Beta (Bytez)', capabilities: ['chat'], contextLen: 4096 },
  { modelId: 'bytez:NousResearch/Hermes-3-Llama-3.1-8B', displayName: 'Hermes 3 Llama 8B (Bytez)', capabilities: ['chat', 'tool-use'], contextLen: 131072 },
]

// ─── OmniRoute — Free AI Gateway (231 providers, 50+ free, ~1.6B free tokens/mo) ─
// OpenAI-compatible endpoint. Install: `npm install -g omniroute` then `omniroute start`.
// Gives access to Claude, GPT, Gemini, and 230+ other models through one endpoint
// with RTK+Caveman compression (15-95% token savings) and smart auto-fallback.
// https://github.com/diegosouzapw/OmniRoute
export const OMNIROUTE_MODELS: ModelDescriptor[] = [
  { modelId: 'anthropic/claude-sonnet-4.5', displayName: 'Claude Sonnet 4.5 (OmniRoute)', capabilities: ['chat', 'reasoning', 'tool-use', 'code'], contextLen: 200000 },
  { modelId: 'anthropic/claude-3.5-haiku', displayName: 'Claude 3.5 Haiku (OmniRoute Free)', capabilities: ['chat', 'tool-use'], contextLen: 200000 },
  { modelId: 'openai/gpt-4o', displayName: 'GPT-4o (OmniRoute)', capabilities: ['chat', 'vision', 'tool-use', 'reasoning'], contextLen: 128000 },
  { modelId: 'openai/gpt-4o-mini', displayName: 'GPT-4o mini (OmniRoute Free)', capabilities: ['chat', 'vision', 'tool-use'], contextLen: 128000 },
  { modelId: 'google/gemini-2.0-flash', displayName: 'Gemini 2.0 Flash (OmniRoute Free)', capabilities: ['chat', 'vision', 'tool-use'], contextLen: 1000000 },
  { modelId: 'google/gemini-1.5-pro', displayName: 'Gemini 1.5 Pro (OmniRoute)', capabilities: ['chat', 'vision', 'reasoning'], contextLen: 2000000 },
  { modelId: 'qwen/qwen-max', displayName: 'Qwen Max (OmniRoute)', capabilities: ['chat', 'reasoning', 'tool-use'], contextLen: 32768 },
  { modelId: 'deepseek/deepseek-chat', displayName: 'DeepSeek Chat (OmniRoute Free)', capabilities: ['chat', 'code'], contextLen: 64000 },
  { modelId: 'meta-llama/llama-3.3-70b', displayName: 'Llama 3.3 70B (OmniRoute Free)', capabilities: ['chat', 'tool-use'], contextLen: 131072 },
  { modelId: 'mistral/mistral-large', displayName: 'Mistral Large (OmniRoute)', capabilities: ['chat', 'reasoning', 'tool-use'], contextLen: 128000 },
]


export const SILICONFLOW_MODELS: ModelDescriptor[] = [
  // ── Chat / reasoning models ──
  { modelId: "Qwen/Qwen2.5-72B-Instruct", displayName: "Qwen 2.5 72B (SiliconFlow)", capabilities: ["chat", "reasoning", "tool-use"], contextLen: 131072 },
  { modelId: "Qwen/Qwen2.5-7B-Instruct", displayName: "Qwen 2.5 7B (SiliconFlow)", capabilities: ["chat"], contextLen: 131072 },
  { modelId: "Qwen/Qwen2.5-Coder-32B-Instruct", displayName: "Qwen 2.5 Coder 32B (SiliconFlow)", capabilities: ["code", "chat"], contextLen: 131072 },
  { modelId: "Qwen/QwQ-32B-Preview", displayName: "Qwen QwQ 32B (SiliconFlow)", capabilities: ["reasoning", "chat"], contextLen: 32768 },
  { modelId: "deepseek-ai/DeepSeek-V3", displayName: "DeepSeek V3 (SiliconFlow)", capabilities: ["chat", "reasoning"], contextLen: 64000 },
  // ── Image generation models (verified available on SiliconFlow 2025-07-05) ──
  // These are invoked via POST /v1/images/generations with the model ID below.
  { modelId: "black-forest-labs/FLUX.1-schnell", displayName: "FLUX.1 Schnell (SiliconFlow Image — fast, free)", capabilities: ["vision"], contextLen: 0 },
  { modelId: "black-forest-labs/FLUX.1-dev", displayName: "FLUX.1 Dev (SiliconFlow Image — high quality)", capabilities: ["vision"], contextLen: 0 },
  { modelId: "black-forest-labs/FLUX-1.1-pro", displayName: "FLUX 1.1 Pro (SiliconFlow Image)", capabilities: ["vision"], contextLen: 0 },
  { modelId: "black-forest-labs/FLUX-1.1-pro-Ultra", displayName: "FLUX 1.1 Pro Ultra (SiliconFlow Image — highest quality)", capabilities: ["vision"], contextLen: 0 },
  { modelId: "black-forest-labs/FLUX.2-flex", displayName: "FLUX.2 Flex (SiliconFlow Image — newest)", capabilities: ["vision"], contextLen: 0 },
  { modelId: "black-forest-labs/FLUX.2-pro", displayName: "FLUX.2 Pro (SiliconFlow Image — premium)", capabilities: ["vision"], contextLen: 0 },
  { modelId: "Qwen/Qwen-Image", displayName: "Qwen Image (SiliconFlow)", capabilities: ["vision"], contextLen: 0 },
  { modelId: "Tongyi-MAI/Z-Image-Turbo", displayName: "Z-Image Turbo (SiliconFlow — fast)", capabilities: ["vision"], contextLen: 0 },
  // ── Video generation models ──
  // SiliconFlow hosts Wan 2.2 for text-to-video generation.
  // API: POST /v1/video/submit (submit) + POST /v1/video/status (poll)
  // Video generation is async — submit then poll for the result.
  { modelId: "Wan-AI/Wan2.2-T2V-A14B", displayName: "Wan 2.2 T2V A14B (SiliconFlow Video)", capabilities: ["vision"], contextLen: 0 },
  { modelId: "Wan-AI/Wan2.2-I2V-A14B", displayName: "Wan 2.2 I2V A14B (SiliconFlow Image-to-Video)", capabilities: ["vision"], contextLen: 0 },
]

// ───────────────────────────────────────────────────────────────────────────
// C-1 additions — major commercial providers (Anthropic, Google, Together,
// Fireworks, Mistral, Cohere, OpenRouter, DeepSeek, Local placeholder).
// These complete the 15+ provider matrix requested for the catalog seed.
// ───────────────────────────────────────────────────────────────────────────

export const ANTHROPIC_MODELS: ModelDescriptor[] = [
  { modelId: 'claude-opus-4-1', displayName: 'Claude Opus 4.1', capabilities: ['chat', 'reasoning', 'tool-use', 'code', 'vision'], contextLen: 200000, tier: 'strong' },
  { modelId: 'claude-opus-4-0', displayName: 'Claude Opus 4.0', capabilities: ['chat', 'reasoning', 'tool-use', 'code'], contextLen: 200000, tier: 'strong' },
  { modelId: 'claude-sonnet-4-5', displayName: 'Claude Sonnet 4.5', capabilities: ['chat', 'reasoning', 'tool-use', 'code', 'vision'], contextLen: 200000, tier: 'strong' },
  { modelId: 'claude-sonnet-4-0', displayName: 'Claude Sonnet 4.0', capabilities: ['chat', 'reasoning', 'tool-use', 'code', 'vision'], contextLen: 200000, tier: 'strong' },
  { modelId: 'claude-3-7-sonnet-20250219', displayName: 'Claude 3.7 Sonnet', capabilities: ['chat', 'reasoning', 'tool-use', 'code', 'vision'], contextLen: 200000, tier: 'strong' },
  { modelId: 'claude-3-5-sonnet-20241022', displayName: 'Claude 3.5 Sonnet (Oct)', capabilities: ['chat', 'reasoning', 'tool-use', 'code', 'vision'], contextLen: 200000, tier: 'strong' },
  { modelId: 'claude-3-5-haiku-20241022', displayName: 'Claude 3.5 Haiku', capabilities: ['chat', 'tool-use'], contextLen: 200000, tier: 'fast' },
  { modelId: 'claude-3-opus-20240229', displayName: 'Claude 3 Opus', capabilities: ['chat', 'reasoning', 'tool-use'], contextLen: 200000, tier: 'strong' },
  { modelId: 'claude-3-sonnet-20240229', displayName: 'Claude 3 Sonnet', capabilities: ['chat', 'reasoning'], contextLen: 200000, tier: 'fast' },
  { modelId: 'claude-3-haiku-20240307', displayName: 'Claude 3 Haiku', capabilities: ['chat'], contextLen: 200000, tier: 'fast' },
  { modelId: 'claude-2.1', displayName: 'Claude 2.1 (legacy)', capabilities: ['chat'], contextLen: 100000, tier: 'fast' },
  { modelId: 'claude-2-0', displayName: 'Claude 2.0 (legacy)', capabilities: ['chat'], contextLen: 100000, tier: 'fast' },
  { modelId: 'claude-instant-1.2', displayName: 'Claude Instant 1.2 (legacy)', capabilities: ['chat'], contextLen: 100000, tier: 'fast' },
]

export const GOOGLE_MODELS: ModelDescriptor[] = [
  { modelId: 'gemini-2.5-pro', displayName: 'Gemini 2.5 Pro', capabilities: ['chat', 'reasoning', 'tool-use', 'code', 'vision'], contextLen: 2000000, tier: 'strong' },
  { modelId: 'gemini-2.5-flash', displayName: 'Gemini 2.5 Flash', capabilities: ['chat', 'reasoning', 'tool-use', 'vision'], contextLen: 1000000, tier: 'fast' },
  { modelId: 'gemini-2.5-flash-lite', displayName: 'Gemini 2.5 Flash Lite', capabilities: ['chat', 'vision'], contextLen: 1000000, tier: 'fast' },
  { modelId: 'gemini-2.0-flash', displayName: 'Gemini 2.0 Flash', capabilities: ['chat', 'tool-use', 'vision'], contextLen: 1000000, tier: 'fast' },
  { modelId: 'gemini-2.0-flash-thinking', displayName: 'Gemini 2.0 Flash Thinking', capabilities: ['chat', 'reasoning', 'vision'], contextLen: 1000000, tier: 'reasoning' },
  { modelId: 'gemini-1.5-pro', displayName: 'Gemini 1.5 Pro', capabilities: ['chat', 'reasoning', 'tool-use', 'code', 'vision'], contextLen: 2000000, tier: 'strong' },
  { modelId: 'gemini-1.5-pro-vision', displayName: 'Gemini 1.5 Pro Vision', capabilities: ['vision', 'chat', 'reasoning'], contextLen: 2000000, tier: 'vision' },
  { modelId: 'gemini-1.5-flash', displayName: 'Gemini 1.5 Flash', capabilities: ['chat', 'tool-use', 'vision'], contextLen: 1000000, tier: 'fast' },
  { modelId: 'gemini-1.5-flash-8b', displayName: 'Gemini 1.5 Flash 8B', capabilities: ['chat', 'vision'], contextLen: 1000000, tier: 'fast' },
  { modelId: 'gemini-1.0-pro', displayName: 'Gemini 1.0 Pro (legacy)', capabilities: ['chat'], contextLen: 32768, tier: 'fast' },
  { modelId: 'gemini-1.0-ultra', displayName: 'Gemini 1.0 Ultra (legacy)', capabilities: ['chat', 'reasoning'], contextLen: 32768, tier: 'strong' },
  { modelId: 'gemma-3-27b-it', displayName: 'Gemma 3 27B', capabilities: ['chat', 'reasoning', 'vision'], contextLen: 8192, tier: 'fast' },
  { modelId: 'gemma-3-12b-it', displayName: 'Gemma 3 12B', capabilities: ['chat', 'vision'], contextLen: 8192, tier: 'fast' },
  { modelId: 'gemma-3-4b-it', displayName: 'Gemma 3 4B', capabilities: ['chat', 'vision'], contextLen: 8192, tier: 'fast' },
  { modelId: 'gemma-2-27b-it', displayName: 'Gemma 2 27B', capabilities: ['chat', 'reasoning'], contextLen: 8192, tier: 'fast' },
  { modelId: 'gemma-2-9b-it', displayName: 'Gemma 2 9B', capabilities: ['chat'], contextLen: 8192, tier: 'fast' },
  { modelId: 'text-embedding-004', displayName: 'Text Embedding 004', capabilities: ['embedding'], contextLen: 2048, tier: 'fast' },
  { modelId: 'text-multilingual-embedding-002', displayName: 'Multilingual Embedding 002', capabilities: ['embedding'], contextLen: 2048, tier: 'fast' },
]

export const TOGETHER_MODELS: ModelDescriptor[] = [
  { modelId: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', displayName: 'Llama 3.3 70B Turbo (Together)', capabilities: ['chat', 'tool-use'], contextLen: 131072, tier: 'strong' },
  { modelId: 'meta-llama/Meta-Llama-3.1-405B-Instruct-Turbo', displayName: 'Llama 3.1 405B Turbo (Together)', capabilities: ['chat', 'reasoning', 'tool-use'], contextLen: 131072, tier: 'strong' },
  { modelId: 'meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo', displayName: 'Llama 3.1 70B Turbo (Together)', capabilities: ['chat', 'tool-use'], contextLen: 131072, tier: 'strong' },
  { modelId: 'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo', displayName: 'Llama 3.1 8B Turbo (Together)', capabilities: ['chat'], contextLen: 131072, tier: 'fast' },
  { modelId: 'Qwen/Qwen2.5-72B-Instruct-Turbo', displayName: 'Qwen 2.5 72B Turbo (Together)', capabilities: ['chat', 'reasoning', 'tool-use'], contextLen: 131072, tier: 'strong' },
  { modelId: 'Qwen/Qwen2.5-7B-Instruct-Turbo', displayName: 'Qwen 2.5 7B Turbo (Together)', capabilities: ['chat'], contextLen: 131072, tier: 'fast' },
  { modelId: 'Qwen/Qwen2.5-Coder-32B-Instruct', displayName: 'Qwen 2.5 Coder 32B (Together)', capabilities: ['code', 'chat'], contextLen: 131072, tier: 'strong' },
  { modelId: 'deepseek-ai/DeepSeek-V3', displayName: 'DeepSeek V3 (Together)', capabilities: ['chat', 'reasoning'], contextLen: 64000, tier: 'strong' },
  { modelId: 'deepseek-ai/DeepSeek-R1', displayName: 'DeepSeek R1 (Together)', capabilities: ['reasoning', 'chat'], contextLen: 64000, tier: 'reasoning' },
  { modelId: 'mistralai/Mixtral-8x22B-Instruct-v0.1', displayName: 'Mixtral 8x22B (Together)', capabilities: ['chat', 'code'], contextLen: 65536, tier: 'strong' },
  { modelId: 'mistralai/Mistral-7B-Instruct-v0.3', displayName: 'Mistral 7B v0.3 (Together)', capabilities: ['chat'], contextLen: 32768, tier: 'fast' },
  { modelId: 'NousResearch/Hermes-3-Llama-3.1-405B', displayName: 'Hermes 3 405B (Together)', capabilities: ['chat', 'reasoning', 'tool-use'], contextLen: 131072, tier: 'strong' },
  { modelId: 'NousResearch/Nous-Hermes-2-Mixtral-8x7B-DPO', displayName: 'Nous Hermes 2 Mixtral (Together)', capabilities: ['chat', 'tool-use'], contextLen: 32768, tier: 'fast' },
  { modelId: 'databricks/dbrx-instruct', displayName: 'DBRX Instruct (Together)', capabilities: ['chat', 'code'], contextLen: 32768, tier: 'strong' },
  { modelId: 'allenai/OLMo-7B-Instruct', displayName: 'OLMo 7B Instruct (Together)', capabilities: ['chat'], contextLen: 2048, tier: 'fast' },
]

export const FIREWORKS_MODELS: ModelDescriptor[] = [
  { modelId: 'accounts/fireworks/models/llama-v3p1-405b-instruct', displayName: 'Llama 3.1 405B (Fireworks)', capabilities: ['chat', 'reasoning', 'tool-use'], contextLen: 131072, tier: 'strong' },
  { modelId: 'accounts/fireworks/models/llama-v3p1-70b-instruct', displayName: 'Llama 3.1 70B (Fireworks)', capabilities: ['chat', 'tool-use'], contextLen: 131072, tier: 'strong' },
  { modelId: 'accounts/fireworks/models/llama-v3p1-8b-instruct', displayName: 'Llama 3.1 8B (Fireworks)', capabilities: ['chat'], contextLen: 131072, tier: 'fast' },
  { modelId: 'accounts/fireworks/models/llama-v3p2-1b-instruct', displayName: 'Llama 3.2 1B (Fireworks)', capabilities: ['chat'], contextLen: 131072, tier: 'fast' },
  { modelId: 'accounts/fireworks/models/llama-v3p2-3b-instruct', displayName: 'Llama 3.2 3B (Fireworks)', capabilities: ['chat'], contextLen: 131072, tier: 'fast' },
  { modelId: 'accounts/fireworks/models/llama4-scout-instruct-basic', displayName: 'Llama 4 Scout (Fireworks)', capabilities: ['chat', 'vision', 'tool-use'], contextLen: 131072, tier: 'strong' },
  { modelId: 'accounts/fireworks/models/llama4-maverick-instruct-basic', displayName: 'Llama 4 Maverick (Fireworks)', capabilities: ['chat', 'vision', 'tool-use'], contextLen: 1000000, tier: 'strong' },
  { modelId: 'accounts/fireworks/models/qwen2p5-72b-instruct', displayName: 'Qwen 2.5 72B (Fireworks)', capabilities: ['chat', 'reasoning', 'tool-use'], contextLen: 131072, tier: 'strong' },
  { modelId: 'accounts/fireworks/models/qwen2p5-coder-32b-instruct', displayName: 'Qwen 2.5 Coder 32B (Fireworks)', capabilities: ['code', 'chat'], contextLen: 131072, tier: 'strong' },
  { modelId: 'accounts/fireworks/models/deepseek-v3', displayName: 'DeepSeek V3 (Fireworks)', capabilities: ['chat', 'reasoning'], contextLen: 64000, tier: 'strong' },
  { modelId: 'accounts/fireworks/models/deepseek-r1', displayName: 'DeepSeek R1 (Fireworks)', capabilities: ['reasoning', 'chat'], contextLen: 64000, tier: 'reasoning' },
  { modelId: 'accounts/fireworks/models/firefunction-v2', displayName: 'FireFunction V2 (Fireworks)', capabilities: ['chat', 'tool-use'], contextLen: 32768, tier: 'fast' },
  { modelId: 'accounts/fireworks/models/mixtral-8x22b-instruct', displayName: 'Mixtral 8x22B (Fireworks)', capabilities: ['chat', 'code'], contextLen: 65536, tier: 'strong' },
  { modelId: 'accounts/fireworks/models/mistral-7b-instruct-v3', displayName: 'Mistral 7B v3 (Fireworks)', capabilities: ['chat'], contextLen: 32768, tier: 'fast' },
]

export const MISTRAL_MODELS: ModelDescriptor[] = [
  { modelId: 'mistral-large-latest', displayName: 'Mistral Large (latest)', capabilities: ['chat', 'reasoning', 'tool-use', 'code'], contextLen: 131072, tier: 'strong' },
  { modelId: 'mistral-large-2411', displayName: 'Mistral Large 2411', capabilities: ['chat', 'reasoning', 'tool-use', 'code'], contextLen: 131072, tier: 'strong' },
  { modelId: 'mistral-large-2407', displayName: 'Mistral Large 2407', capabilities: ['chat', 'reasoning', 'tool-use'], contextLen: 131072, tier: 'strong' },
  { modelId: 'codestral-latest', displayName: 'Codestral (latest)', capabilities: ['code', 'chat', 'tool-use'], contextLen: 256000, tier: 'strong' },
  { modelId: 'codestral-2501', displayName: 'Codestral 2501', capabilities: ['code', 'chat'], contextLen: 256000, tier: 'strong' },
  { modelId: 'mistral-nemo', displayName: 'Mistral Nemo', capabilities: ['chat', 'reasoning', 'tool-use'], contextLen: 131072, tier: 'fast' },
  { modelId: 'mistral-small-latest', displayName: 'Mistral Small (latest)', capabilities: ['chat', 'tool-use'], contextLen: 32768, tier: 'fast' },
  { modelId: 'mistral-small-2501', displayName: 'Mistral Small 2501', capabilities: ['chat', 'tool-use'], contextLen: 32768, tier: 'fast' },
  { modelId: 'open-mistral-7b', displayName: 'Open Mistral 7B', capabilities: ['chat'], contextLen: 32768, tier: 'fast' },
  { modelId: 'open-mixtral-8x7b', displayName: 'Open Mixtral 8x7B', capabilities: ['chat', 'code'], contextLen: 32768, tier: 'fast' },
  { modelId: 'open-mixtral-8x22b', displayName: 'Open Mixtral 8x22B', capabilities: ['chat', 'code'], contextLen: 65536, tier: 'strong' },
  { modelId: 'mistral-embed', displayName: 'Mistral Embed', capabilities: ['embedding'], contextLen: 8192, tier: 'fast' },
  { modelId: 'pixtral-large-latest', displayName: 'Pixtral Large (Vision)', capabilities: ['vision', 'chat', 'reasoning'], contextLen: 131072, tier: 'vision' },
  { modelId: 'pixtral-12b-2409', displayName: 'Pixtral 12B (Vision)', capabilities: ['vision', 'chat'], contextLen: 131072, tier: 'vision' },
  { modelId: 'ministral-8b-latest', displayName: 'Ministral 8B', capabilities: ['chat'], contextLen: 131072, tier: 'fast' },
  { modelId: 'ministral-3b-latest', displayName: 'Ministral 3B', capabilities: ['chat'], contextLen: 131072, tier: 'fast' },
]

export const COHERE_MODELS: ModelDescriptor[] = [
  { modelId: 'command-r-plus', displayName: 'Command R+', capabilities: ['chat', 'reasoning', 'tool-use'], contextLen: 128000, tier: 'strong' },
  { modelId: 'command-r-plus-08-2024', displayName: 'Command R+ 08-2024', capabilities: ['chat', 'reasoning', 'tool-use'], contextLen: 128000, tier: 'strong' },
  { modelId: 'command-r', displayName: 'Command R', capabilities: ['chat', 'tool-use'], contextLen: 128000, tier: 'fast' },
  { modelId: 'command-r-08-2024', displayName: 'Command R 08-2024', capabilities: ['chat', 'tool-use'], contextLen: 128000, tier: 'fast' },
  { modelId: 'command-r7b-12-2024', displayName: 'Command R7B', capabilities: ['chat', 'reasoning'], contextLen: 128000, tier: 'fast' },
  { modelId: 'command', displayName: 'Command (legacy)', capabilities: ['chat'], contextLen: 4000, tier: 'fast' },
  { modelId: 'command-light', displayName: 'Command Light (legacy)', capabilities: ['chat'], contextLen: 4000, tier: 'fast' },
  { modelId: 'embed-english-v3.0', displayName: 'Embed English v3.0', capabilities: ['embedding'], contextLen: 512, tier: 'fast' },
  { modelId: 'embed-multilingual-v3.0', displayName: 'Embed Multilingual v3.0', capabilities: ['embedding'], contextLen: 512, tier: 'fast' },
  { modelId: 'embed-english-light-v3.0', displayName: 'Embed English Light v3.0', capabilities: ['embedding'], contextLen: 512, tier: 'fast' },
  { modelId: 'rerank-english-v3.0', displayName: 'Rerank English v3.0', capabilities: ['embedding'], contextLen: 4096, tier: 'fast' },
  { modelId: 'rerank-multilingual-v3.0', displayName: 'Rerank Multilingual v3.0', capabilities: ['embedding'], contextLen: 4096, tier: 'fast' },
  { modelId: 'aya-expanse-8b', displayName: 'Aya Expanse 8B', capabilities: ['chat'], contextLen: 8000, tier: 'fast' },
  { modelId: 'aya-expanse-32b', displayName: 'Aya Expanse 32B', capabilities: ['chat', 'reasoning'], contextLen: 8000, tier: 'strong' },
]

export const OPENROUTER_MODELS: ModelDescriptor[] = [
  // Aggregator that proxies 200+ upstream providers. Only the most popular
  // routes are listed here — the full list lives at openrouter.ai/models.
  { modelId: 'anthropic/claude-opus-4.1', displayName: 'Claude Opus 4.1 (OpenRouter)', capabilities: ['chat', 'reasoning', 'tool-use', 'code', 'vision'], contextLen: 200000, tier: 'strong' },
  { modelId: 'anthropic/claude-3.5-sonnet', displayName: 'Claude 3.5 Sonnet (OpenRouter)', capabilities: ['chat', 'reasoning', 'tool-use', 'vision'], contextLen: 200000, tier: 'strong' },
  { modelId: 'anthropic/claude-3.5-haiku', displayName: 'Claude 3.5 Haiku (OpenRouter)', capabilities: ['chat', 'tool-use'], contextLen: 200000, tier: 'fast' },
  { modelId: 'openai/gpt-4o', displayName: 'GPT-4o (OpenRouter)', capabilities: ['chat', 'reasoning', 'tool-use', 'vision'], contextLen: 128000, tier: 'strong' },
  { modelId: 'openai/gpt-4o-mini', displayName: 'GPT-4o mini (OpenRouter)', capabilities: ['chat', 'tool-use', 'vision'], contextLen: 128000, tier: 'fast' },
  { modelId: 'openai/gpt-4-turbo', displayName: 'GPT-4 Turbo (OpenRouter)', capabilities: ['chat', 'reasoning', 'tool-use', 'vision'], contextLen: 128000, tier: 'strong' },
  { modelId: 'google/gemini-pro-1.5', displayName: 'Gemini 1.5 Pro (OpenRouter)', capabilities: ['chat', 'reasoning', 'vision'], contextLen: 2000000, tier: 'strong' },
  { modelId: 'google/gemini-flash-1.5', displayName: 'Gemini 1.5 Flash (OpenRouter)', capabilities: ['chat', 'vision'], contextLen: 1000000, tier: 'fast' },
  { modelId: 'meta-llama/llama-3.3-70b-instruct', displayName: 'Llama 3.3 70B (OpenRouter)', capabilities: ['chat', 'tool-use'], contextLen: 131072, tier: 'strong' },
  { modelId: 'meta-llama/llama-3.1-405b-instruct', displayName: 'Llama 3.1 405B (OpenRouter)', capabilities: ['chat', 'reasoning'], contextLen: 131072, tier: 'strong' },
  { modelId: 'meta-llama/llama-3.1-70b-instruct', displayName: 'Llama 3.1 70B (OpenRouter)', capabilities: ['chat'], contextLen: 131072, tier: 'fast' },
  { modelId: 'meta-llama/llama-3.1-8b-instruct', displayName: 'Llama 3.1 8B (OpenRouter)', capabilities: ['chat'], contextLen: 131072, tier: 'fast' },
  { modelId: 'qwen/qwen-2.5-72b-instruct', displayName: 'Qwen 2.5 72B (OpenRouter)', capabilities: ['chat', 'reasoning', 'tool-use'], contextLen: 131072, tier: 'strong' },
  { modelId: 'qwen/qwen-2.5-coder-32b-instruct', displayName: 'Qwen 2.5 Coder 32B (OpenRouter)', capabilities: ['code', 'chat'], contextLen: 131072, tier: 'strong' },
  { modelId: 'qwen/qwen-2.5-7b-instruct', displayName: 'Qwen 2.5 7B (OpenRouter)', capabilities: ['chat'], contextLen: 131072, tier: 'fast' },
  { modelId: 'deepseek/deepseek-chat', displayName: 'DeepSeek V3 (OpenRouter)', capabilities: ['chat', 'reasoning'], contextLen: 64000, tier: 'strong' },
  { modelId: 'deepseek/deepseek-r1', displayName: 'DeepSeek R1 (OpenRouter)', capabilities: ['reasoning', 'chat'], contextLen: 64000, tier: 'reasoning' },
  { modelId: 'mistralai/mistral-large', displayName: 'Mistral Large (OpenRouter)', capabilities: ['chat', 'reasoning', 'tool-use'], contextLen: 131072, tier: 'strong' },
  { modelId: 'mistralai/mistral-nemo', displayName: 'Mistral Nemo (OpenRouter)', capabilities: ['chat'], contextLen: 131072, tier: 'fast' },
  { modelId: 'mistralai/codestral', displayName: 'Codestral (OpenRouter)', capabilities: ['code', 'chat'], contextLen: 256000, tier: 'strong' },
  { modelId: 'x-ai/grok-2-1212', displayName: 'Grok 2 (OpenRouter)', capabilities: ['chat', 'reasoning'], contextLen: 131072, tier: 'strong' },
  { modelId: 'x-ai/grok-beta', displayName: 'Grok Beta (OpenRouter)', capabilities: ['chat'], contextLen: 131072, tier: 'fast' },
  { modelId: 'cohere/command-r-plus', displayName: 'Command R+ (OpenRouter)', capabilities: ['chat', 'tool-use'], contextLen: 128000, tier: 'strong' },
  { modelId: 'nousresearch/hermes-3-llama-405b', displayName: 'Hermes 3 405B (OpenRouter)', capabilities: ['chat', 'reasoning', 'tool-use'], contextLen: 131072, tier: 'strong' },
  { modelId: 'perplexity/llama-3.1-sonar-large-128k-online', displayName: 'Sonar Large Online (OpenRouter)', capabilities: ['chat', 'tool-use'], contextLen: 127072, tier: 'strong' },
  { modelId: 'perplexity/llama-3.1-sonar-small-128k-online', displayName: 'Sonar Small Online (OpenRouter)', capabilities: ['chat'], contextLen: 127072, tier: 'fast' },
  { modelId: 'microsoft/phi-3-medium-128k-instruct', displayName: 'Phi-3 Medium 128K (OpenRouter)', capabilities: ['chat'], contextLen: 128000, tier: 'fast' },
  { modelId: 'liquid/lfm-40b', displayName: 'Liquid LFM 40B (OpenRouter)', capabilities: ['chat'], contextLen: 32768, tier: 'fast' },
]

export const DEEPSEEK_MODELS: ModelDescriptor[] = [
  { modelId: 'deepseek-chat', displayName: 'DeepSeek V3 (deepseek-chat)', capabilities: ['chat', 'reasoning', 'tool-use'], contextLen: 64000, tier: 'strong' },
  { modelId: 'deepseek-reasoner', displayName: 'DeepSeek R1 (deepseek-reasoner)', capabilities: ['reasoning', 'chat'], contextLen: 64000, tier: 'reasoning' },
  { modelId: 'deepseek-coder', displayName: 'DeepSeek Coder (deepseek-coder)', capabilities: ['code', 'chat'], contextLen: 128000, tier: 'strong' },
  { modelId: 'deepseek-v3', displayName: 'DeepSeek V3 (direct)', capabilities: ['chat', 'reasoning'], contextLen: 64000, tier: 'strong' },
  { modelId: 'deepseek-r1', displayName: 'DeepSeek R1 (direct)', capabilities: ['reasoning', 'chat'], contextLen: 64000, tier: 'reasoning' },
  { modelId: 'deepseek-r1-distill-llama-70b', displayName: 'DeepSeek R1 Distill Llama 70B', capabilities: ['reasoning', 'chat'], contextLen: 131072, tier: 'reasoning' },
  { modelId: 'deepseek-r1-distill-qwen-32b', displayName: 'DeepSeek R1 Distill Qwen 32B', capabilities: ['reasoning', 'chat'], contextLen: 131072, tier: 'reasoning' },
  { modelId: 'deepseek-r1-distill-qwen-14b', displayName: 'DeepSeek R1 Distill Qwen 14B', capabilities: ['reasoning', 'chat'], contextLen: 131072, tier: 'reasoning' },
  { modelId: 'deepseek-r1-distill-qwen-7b', displayName: 'DeepSeek R1 Distill Qwen 7B', capabilities: ['reasoning', 'chat'], contextLen: 131072, tier: 'fast' },
  { modelId: 'deepseek-r1-distill-qwen-1.5b', displayName: 'DeepSeek R1 Distill Qwen 1.5B', capabilities: ['reasoning', 'chat'], contextLen: 131072, tier: 'fast' },
]

export const LOCAL_MODELS: ModelDescriptor[] = [
  // Placeholder provider for on-device / embedded models (e.g. a future
  // llama.cpp or MLC-LLM bridge). All entries default to enabled:false so
  // the router will skip them until a local bridge is wired up.
  { modelId: 'local:phi-3-mini', displayName: 'Phi-3 Mini (local)', capabilities: ['chat'], contextLen: 4096, tier: 'local' },
  { modelId: 'local:tinyllama', displayName: 'TinyLlama 1.1B (local)', capabilities: ['chat'], contextLen: 2048, tier: 'local' },
  { modelId: 'local:qwen2.5-0.5b', displayName: 'Qwen 2.5 0.5B (local)', capabilities: ['chat'], contextLen: 32768, tier: 'local' },
  { modelId: 'local:stub-chat', displayName: 'Stub Chat (local — echo)', capabilities: ['chat'], contextLen: 4096, tier: 'local' },
  { modelId: 'local:stub-embed', displayName: 'Stub Embedder (local — zero vec)', capabilities: ['embedding'], contextLen: 512, tier: 'local' },
  { modelId: 'local:stub-vision', displayName: 'Stub Vision (local — placeholder)', capabilities: ['vision'], contextLen: 4096, tier: 'local' },
  { modelId: 'local:llama3.2-1b', displayName: 'Llama 3.2 1B (local)', capabilities: ['chat'], contextLen: 131072, tier: 'local' },
  { modelId: 'local:gemma-2-2b', displayName: 'Gemma 2 2B (local)', capabilities: ['chat'], contextLen: 8192, tier: 'local' },
]

export const PROVIDER_SEEDS: ProviderSeed[] = [
  {
    name: 'ollama',
    kind: 'local',
    baseUrl: 'http://127.0.0.1:11434',
    enabled: true,
    models: OLLAMA_MODELS,
  },
  {
    name: 'ollama-cloud',
    kind: 'cloud-api',
    baseUrl: 'http://127.0.0.1:11434',
    enabled: true,
    models: OLLAMA_CLOUD_MODELS,
  },
  {
    name: 'nvidia-nim',
    kind: 'cloud-api',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    enabled: true, // Phase 18: all providers ON by default — toggle off in UI if a key is missing
    models: NVIDIA_NIM_MODELS,
  },
  {
    name: 'zai',
    kind: 'cloud-api',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    enabled: true,
    models: ZAI_MODELS,
  },
  {
    name: 'qwen-playground',
    kind: 'cloud-api',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    enabled: true,
    models: QWEN_PLAYGROUND_MODELS,
  },
  { name: 'siliconflow', kind: 'cloud-api', baseUrl: 'https://api.siliconflow.com/v1', enabled: true, models: SILICONFLOW_MODELS },
  {
    name: 'browser-login',
    kind: 'browser',
    enabled: true,
    models: BROWSER_LOGIN_MODELS,
  },
  // ─── Free / local providers (work without payment) ───────────────────────
  {
    name: 'github-models',
    kind: 'cloud-api',
    baseUrl: 'https://models.inference.ai.azure.com',
    enabled: true, // free with a GitHub token; enable by default
    models: GITHUB_MODELS,
  },
  {
    name: 'huggingface',
    kind: 'cloud-api',
    baseUrl: 'https://api-inference.huggingface.co/v1',
    enabled: true, // free HF tier
    models: HUGGINGFACE_MODELS,
  },
  {
    name: 'higgsfield',
    kind: 'cloud-api',
    baseUrl: 'https://api.higgsfield.com/v1',
    enabled: true, // Phase 18: ON by default
    models: HIGGSFIELD_MODELS,
  },
  // ─── Groq — free, ~500 tok/s. Auto-enabled when GROQ_API_KEY is set. ─────────
  {
    name: 'groq',
    kind: 'cloud-api',
    baseUrl: 'https://api.groq.com/openai/v1',
    enabled: true, // Phase 18: ON by default — toggle off in UI if key is missing
    models: GROQ_MODELS,
  },
  // ─── OpenAI (paid) — auto-enabled when OPENAI_API_KEY is set. ─────────────────
  {
    name: 'openai',
    kind: 'cloud-api',
    baseUrl: 'https://api.openai.com/v1',
    enabled: true, // Phase 18: ON by default — toggle off in UI if key is missing
    models: OPENAI_MODELS,
  },
  // ─── Bytez — free AI model gateway (OpenAI-compatible). ─────────────────────
  {
    name: 'bytez',
    kind: 'cloud-api',
    baseUrl: 'https://api.bytez.com/v1',
    enabled: true, // Phase 18: ON by default — toggle off in UI if key is missing
    models: BYTEZ_MODELS,
  },
  {
    name: 'omniroute',
    kind: 'cloud-api',
    baseUrl: 'http://127.0.0.1:4100/v1', // local OmniRoute gateway (npm install -g omniroute)
    enabled: true, // free gateway — 231 providers, 50+ free, ~1.6B free tokens/mo
    models: OMNIROUTE_MODELS,
  },
  // ─── C-1 additions: major commercial providers ────────────────────────────
  {
    name: 'anthropic',
    kind: 'cloud-api',
    baseUrl: 'https://api.anthropic.com/v1',
    enabled: true,
    models: ANTHROPIC_MODELS,
  },
  {
    name: 'google',
    kind: 'cloud-api',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    enabled: true,
    models: GOOGLE_MODELS,
  },
  {
    name: 'together',
    kind: 'cloud-api',
    baseUrl: 'https://api.together.xyz/v1',
    enabled: true,
    models: TOGETHER_MODELS,
  },
  {
    name: 'fireworks',
    kind: 'cloud-api',
    baseUrl: 'https://api.fireworks.ai/inference/v1',
    enabled: true,
    models: FIREWORKS_MODELS,
  },
  {
    name: 'mistral',
    kind: 'cloud-api',
    baseUrl: 'https://api.mistral.ai/v1',
    enabled: true,
    models: MISTRAL_MODELS,
  },
  {
    name: 'cohere',
    kind: 'cloud-api',
    baseUrl: 'https://api.cohere.com/v1',
    enabled: true,
    models: COHERE_MODELS,
  },
  {
    name: 'openrouter',
    kind: 'cloud-api',
    baseUrl: 'https://openrouter.ai/api/v1',
    enabled: true, // aggregator — needs OPENROUTER_API_KEY; toggle off in UI if missing
    models: OPENROUTER_MODELS,
  },
  {
    name: 'deepseek',
    kind: 'cloud-api',
    baseUrl: 'https://api.deepseek.com/v1',
    enabled: true,
    models: DEEPSEEK_MODELS,
  },
  {
    name: 'local',
    kind: 'local',
    baseUrl: 'http://127.0.0.1:8080/v1', // placeholder for a future on-device bridge
    enabled: false, // disabled until a local inference bridge is wired up
    models: LOCAL_MODELS,
  },
]

// ─── Flattened catalog ──────────────────────────────────────────────────────
// Pairs every model in PROVIDER_SEEDS with its owning providerKey + enabled
// flag. Used by the seed script and the /api/models route to populate the DB
// and to drive routing decisions.
export const MODEL_CATALOG: CatalogEntry[] = PROVIDER_SEEDS.flatMap((p) =>
  p.models.map((m) => ({
    ...m,
    providerKey: p.name,
    enabled: p.enabled,
  })),
)

// Re-export the LIAFON services catalog (defined in company-config.ts) so
// catalog.ts is the single import point for the seeder. R-3 already expanded
// LIAFON_SERVICES to 20 services — we just re-export it here.
export { LIAFON_SERVICES } from './company-config'
export type { LiafonService } from './company-config'

// --- Agent catalog ---

// CrewAI-style role triple + per-agent execution limits (Phase 8A+8D).
// Stored inside Agent.config JSON blob — no DB migration needed.
export interface AgentSeedConfig {
  role: string
  goal: string
  backstory: string
  maxIter: number        // max iterations per task (default 10)
  maxRpm: number         // max requests per minute (default 30)
  maxExecutionTime: number // max seconds per task (default 300)
}

export interface AgentSeed {
  name: string
  kind: AgentKind
  description: string
  recommendedModel: string
  skills: string[]
  installCmd?: string
  repoUrl?: string
  config: AgentSeedConfig
}

export const AGENT_SEEDS: AgentSeed[] = [
  {
    name: 'Hermes',
    kind: 'hermes',
    description: '[Catalog example — NOT auto-installed] Self-improving AI agent framework. Terminal, files, memory, browser-use. Native to macOS/Win/Linux. JARVIS has its own built-in orchestrator; this entry is for reference.',
    recommendedModel: 'mistral:latest',
    skills: ['terminal', 'filesystem', 'memory', 'browser-use', 'web-search'],
    repoUrl: 'https://github.com/nousresearch/hermes-agent',
    installCmd: 'pip install hermes-agent',
    config: {
      role: 'general-purpose assistant',
      goal: 'Answer user questions accurately and concisely using available tools and knowledge',
      backstory: 'You are Hermes, a versatile AI assistant with broad knowledge across software engineering, data analysis, and creative writing. You prefer concrete, actionable answers.',
      maxIter: 10,
      maxRpm: 30,
      maxExecutionTime: 300,
    },
  },
  {
    name: 'Open Interpreter',
    kind: 'open-interpreter',
    description: '[Catalog example — NOT auto-installed] OS Mode — visual mouse/keyboard control + local code execution. Best for VSCode/PowerShell automation. Install separately only if you want OS-level control.',
    recommendedModel: 'llava:latest',
    skills: ['terminal', 'filesystem', 'os-mode', 'code-exec'],
    repoUrl: 'https://github.com/OpenInterpreter/openinterpreter',
    installCmd: 'pip install open-interpreter',
    config: {
      role: 'os-mode code executor',
      goal: 'Execute code locally and drive the operating system visually to complete automation tasks',
      backstory: 'You are Open Interpreter, an agent that runs code in the user\'s local environment and controls the OS via screen capture and mouse/keyboard input for end-to-end automation.',
      maxIter: 15,
      maxRpm: 30,
      maxExecutionTime: 600,
    },
  },
  {
    name: 'Microsoft UFO',
    kind: 'ufo',
    description: '[Catalog example — NOT auto-installed] Windows-native dual-agent GUI controller. Uses GPT-Vision to click through native Windows apps. Windows-only. Not integrated with JARVIS.',
    recommendedModel: 'qwen2.5vl:3b',
    skills: ['windows-gui', 'vision', 'appcontrol'],
    repoUrl: 'https://github.com/microsoft/UFO',
    installCmd: 'pip install ufo-agent',
    config: {
      role: 'windows-gui controller',
      goal: 'Drive native Windows applications through vision-guided clicking and typing',
      backstory: 'You are Microsoft UFO, a dual-agent (AppAgent + ActAgent) system that uses GPT-Vision to perceive the screen and select/click controls in native Win32 apps step-by-step.',
      maxIter: 12,
      maxRpm: 20,
      maxExecutionTime: 300,
    },
  },
  {
    name: 'OpenClaw',
    kind: 'openclaw',
    description: '[Catalog example — NOT auto-installed] 24/7 proactive assistant. Hooks into Telegram, Discord, browser. Runs multiple specialized sub-agents. Reference only — JARVIS has its own 24/7 mini-services.',
    recommendedModel: 'llama3.1:8b',
    skills: ['messaging', 'browser-use', 'memory', 'scheduler'],
    repoUrl: 'https://github.com/OpenClaw/openclaw',
    installCmd: 'git clone https://github.com/OpenClaw/openclaw',
    config: {
      role: '24/7 proactive assistant',
      goal: 'Coordinate messaging, scheduling, and browser tasks around the clock via Telegram/Discord',
      backstory: 'You are OpenClaw, a persistent assistant that hooks into Telegram, Discord, and the browser, dispatching specialized sub-agents and reacting to events proactively.',
      maxIter: 20,
      maxRpm: 60,
      maxExecutionTime: 600,
    },
  },
  {
    name: 'CrewAI',
    kind: 'crewai',
    description: '[Catalog example — NOT auto-installed] Multi-agent orchestration (Python). JARVIS has its own TypeScript port of this pattern built in — no install needed.',
    recommendedModel: 'qwen2.5:7b',
    skills: ['orchestration', 'roles', 'memory'],
    repoUrl: 'https://github.com/crewAIInc/crewAI',
    installCmd: 'pip install crewai',
    config: {
      role: 'multi-agent orchestrator',
      goal: 'Decompose tasks into specialized roles (researcher, coder, writer, reviewer) and assemble their outputs',
      backstory: 'You are CrewAI, a multi-agent orchestration framework that assigns role/goal/backstory to each crew member and pipelines their outputs through manager-reviewed tasks.',
      maxIter: 25,
      maxRpm: 60,
      maxExecutionTime: 900,
    },
  },
  {
    name: 'Browser-Use',
    kind: 'browser-use',
    description: '[Catalog example — NOT auto-installed] Standalone web automation agent. Autonomous browsing without APIs. JARVIS uses Crawlee + Playwright directly for web scraping.',
    recommendedModel: 'qwen2.5-coder:7b',
    skills: ['browser-use', 'web-search'],
    repoUrl: 'https://github.com/browser-use/browser-use',
    installCmd: 'pip install browser-use',
    config: {
      role: 'web automation specialist',
      goal: 'Autonomously navigate websites and complete web-based workflows without external APIs',
      backstory: 'You are Browser-Use, a web automation agent that drives a real browser (Playwright/CDP) to click, type, and extract information from live web pages.',
      maxIter: 15,
      maxRpm: 30,
      maxExecutionTime: 300,
    },
  },
]

// Skill catalog (for the Skills Marketplace tab)
export interface SkillSeed {
  name: string
  description: string
  category: 'browser' | 'filesystem' | 'terminal' | 'vision' | 'memory' | 'messaging' | 'code'
}

export const SKILL_SEEDS: SkillSeed[] = [
  { name: 'terminal', description: 'Execute shell commands (PowerShell/bash) and capture output', category: 'terminal' },
  { name: 'filesystem', description: 'Read/write/list local files with sandboxing', category: 'filesystem' },
  { name: 'memory', description: 'Persistent vector memory via nomic-embed-text embeddings', category: 'memory' },
  { name: 'browser-use', description: 'Autonomous web navigation via Playwright/CDP', category: 'browser' },
  { name: 'web-search', description: 'Real-time web search (DuckDuckGo / SearXNG)', category: 'browser' },
  { name: 'os-mode', description: 'Visual mouse/keyboard control via screen capture (requires llava/qwen-vl)', category: 'vision' },
  { name: 'windows-gui', description: 'Native Win32 UI automation (UFO/PyAutoGUI)', category: 'vision' },
  { name: 'code-exec', description: 'Sandboxed Python/PowerShell execution with persistent REPL', category: 'code' },
  { name: 'messaging', description: 'Send/receive on Telegram, Discord, Slack', category: 'messaging' },
  { name: 'scheduler', description: 'Cron-style 24/7 task scheduling', category: 'code' },
  { name: 'orchestration', description: 'CrewAI role-based multi-agent coordination', category: 'code' },
  { name: 'roles', description: 'Predefined agent roles (Researcher, Coder, Writer, Reviewer)', category: 'code' },
  { name: 'appcontrol', description: 'Launch/inspect native OS apps via accessibility APIs', category: 'vision' },
]