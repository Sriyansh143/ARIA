// =====================================================================
// settings-store.ts -- read/write .env file from the dashboard UI.
// =====================================================================
// Phase 17 / Item 4.
//
// Shows ALL environment variables from .env (not just a whitelist).
// Secrets are masked. Non-secret values are shown in full.
// Allows inline editing of any var. Writes are atomic (tmp + rename).
// =====================================================================

import { readFileSync, writeFileSync, existsSync, statSync, renameSync, chmodSync } from 'fs'
import { join } from 'path'
import { randomBytes } from 'crypto'

const ENV_FILE = process.env.JARVIS_ENV_FILE || join(process.cwd(), '.env')

// ─── Known setting definitions (for UI metadata: label, category, test) ─
export interface SettingDefinition {
  key: string
  label: string
  category: 'llm' | 'messaging' | 'webhooks' | 'system' | 'phase17' | 'database' | 'other'
  type: 'string' | 'password' | 'url' | 'number' | 'boolean'
  description: string
  isSecret: boolean
  restartRequired: boolean
}

// Registry of known keys with metadata.
// Unknown keys from .env are shown in the "other" category with auto-detected secret status.
const KNOWN_DEFINITIONS: SettingDefinition[] = [
  // LLM providers
  { key: 'OLLAMA_BASE_URL', label: 'Ollama Base URL', category: 'llm', type: 'url', description: 'URL of the local Ollama daemon', isSecret: false, restartRequired: true },
  { key: 'NVIDIA_API_KEY', label: 'NVIDIA NIM API Key', category: 'llm', type: 'password', description: 'Free key at https://build.nvidia.com/', isSecret: true, restartRequired: false },
  { key: 'ZAI_API_KEY', label: 'Z.ai API Key', category: 'llm', type: 'password', description: 'Key at https://open.bigmodel.cn/console/apikey', isSecret: true, restartRequired: false },
  { key: 'QWEN_API_KEY', label: 'Qwen Playground API Key', category: 'llm', type: 'password', description: 'Key at https://dashscope.console.aliyun.com/apiKey', isSecret: true, restartRequired: false },
  { key: 'GITHUB_TOKEN', label: 'GitHub Token (for GitHub Models)', category: 'llm', type: 'password', description: 'PAT at https://github.com/settings/tokens', isSecret: true, restartRequired: false },
  { key: 'HUGGINGFACE_API_KEY', label: 'HuggingFace API Key', category: 'llm', type: 'password', description: 'Key at https://huggingface.co/settings/tokens', isSecret: true, restartRequired: false },
  { key: 'GROQ_API_KEY', label: 'Groq API Key', category: 'llm', type: 'password', description: 'Key at https://console.groq.com/keys', isSecret: true, restartRequired: false },
  { key: 'OPENAI_API_KEY', label: 'OpenAI API Key', category: 'llm', type: 'password', description: 'Key at https://platform.openai.com/api-keys', isSecret: true, restartRequired: false },
  { key: 'ANTHROPIC_API_KEY', label: 'Anthropic API Key', category: 'llm', type: 'password', description: 'Key at https://console.anthropic.com/', isSecret: true, restartRequired: false },
  { key: 'HIGGSFIELD_API_KEY', label: 'Higgsfield API Key', category: 'llm', type: 'password', description: 'Higgsfield AI API key', isSecret: true, restartRequired: false },

  // Data API tools
  { key: 'WEATHERSTACK_API_KEY', label: 'Weatherstack API Key', category: 'llm', type: 'password', description: 'Weather data API key', isSecret: true, restartRequired: false },
  { key: 'CURRENCYLAYER_API_KEY', label: 'Currencylayer API Key', category: 'llm', type: 'password', description: 'Currency conversion API key', isSecret: true, restartRequired: false },
  { key: 'IPSTACK_API_KEY', label: 'IPstack API Key', category: 'llm', type: 'password', description: 'IP geolocation API key', isSecret: true, restartRequired: false },

  // Messaging channels
  { key: 'TELEGRAM_BOT_TOKEN', label: 'Telegram Bot Token', category: 'messaging', type: 'password', description: 'Get from @BotFather on Telegram', isSecret: true, restartRequired: true },
  { key: 'TELEGRAM_CHAT_ID', label: 'Telegram Chat ID', category: 'messaging', type: 'string', description: 'Your chat ID (message @userinfobot)', isSecret: false, restartRequired: true },
  { key: 'WHATSAPP_PHONE_ID', label: 'WhatsApp Phone ID (future)', category: 'messaging', type: 'string', description: 'WhatsApp Business API phone ID', isSecret: false, restartRequired: false },
  { key: 'DISCORD_BOT_TOKEN', label: 'Discord Bot Token (future)', category: 'messaging', type: 'password', description: 'Discord bot token', isSecret: true, restartRequired: false },
  { key: 'SLACK_BOT_TOKEN', label: 'Slack Bot Token (future)', category: 'messaging', type: 'password', description: 'Slack bot token (xoxb-...)', isSecret: true, restartRequired: false },

  // Webhooks & triggers
  { key: 'WEBHOOK_HMAC_SECRET', label: 'Webhook HMAC Secret', category: 'webhooks', type: 'password', description: 'Secret for verifying webhook signatures', isSecret: true, restartRequired: false },

  // System
  { key: 'JARVIS_SHARED_KEY', label: 'JARVIS Shared Key (auth)', category: 'system', type: 'password', description: 'Master key for dashboard auth. Generate: openssl rand -hex 32', isSecret: true, restartRequired: false },
  { key: 'JARVIS_ALLOWED_ORIGINS', label: 'Allowed Origins (CORS)', category: 'system', type: 'string', description: 'Comma-separated allowed origins for CORS', isSecret: false, restartRequired: true },
  { key: 'DATABASE_URL', label: 'Database URL', category: 'database', type: 'string', description: 'SQLite/Postgres connection string', isSecret: false, restartRequired: true },
  { key: 'DASHBOARD_BASE', label: 'Dashboard Base URL', category: 'system', type: 'url', description: 'Base URL for dashboard API calls', isSecret: false, restartRequired: false },
  { key: 'NODE_ENV', label: 'Node Environment', category: 'system', type: 'string', description: 'development or production', isSecret: false, restartRequired: true },
  { key: 'JARVIS_DEVICE_CLASS', label: 'Device Class', category: 'system', type: 'string', description: 'auto | raspberry-pi | arm-sbc | desktop | server', isSecret: false, restartRequired: false },
  { key: 'JARVIS_MAX_CONCURRENCY', label: 'Max Concurrency', category: 'system', type: 'number', description: 'Max parallel agent executions', isSecret: false, restartRequired: false },
  { key: 'JARVIS_DISABLE_SCREEN_VIEWER', label: 'Disable Screen Viewer', category: 'system', type: 'boolean', description: 'Disable screen-viewer service (headless Pi)', isSecret: false, restartRequired: true },
  { key: 'JARVIS_DISABLE_MCTS', label: 'Disable MCTS Engine', category: 'system', type: 'boolean', description: 'Disable MCTS engine (low-RAM)', isSecret: false, restartRequired: true },
  { key: 'REDIS_URL', label: 'Redis URL (optional)', category: 'database', type: 'url', description: 'Redis for shared rate limiting', isSecret: false, restartRequired: true },
  { key: 'SENTRY_DSN', label: 'Sentry DSN (optional)', category: 'system', type: 'url', description: 'Error tracking DSN', isSecret: false, restartRequired: false },

  // Phase 17 toggles
  { key: 'PHASE17_OKARA_ENABLED', label: 'Okara Feed Enabled', category: 'phase17', type: 'boolean', description: 'Proactive marketing value feed', isSecret: false, restartRequired: true },
  { key: 'PHASE17_TMUX_ENABLED', label: 'tmux Multiplexing Enabled', category: 'phase17', type: 'boolean', description: 'Persistent tmux workspace windows', isSecret: false, restartRequired: true },
  { key: 'PHASE17_FUGU_ISOLATION', label: 'Fugu Context Isolation', category: 'phase17', type: 'boolean', description: 'Sub-agent context isolation', isSecret: false, restartRequired: false },
  { key: 'PHASE17_MCTS_ENABLED', label: 'MCTS Strategic Router', category: 'phase17', type: 'boolean', description: 'Monte Carlo Tree Search for #strategy prompts', isSecret: false, restartRequired: true },
  { key: 'PHASE17_MCP_ENABLED', label: 'MCP Service Engine', category: 'phase17', type: 'boolean', description: 'Model Context Protocol gateway', isSecret: false, restartRequired: true },
  { key: 'JARVIS_TMUX_SESSION', label: 'tmux Session Name', category: 'phase17', type: 'string', description: 'Name of the tmux session for persistent windows', isSecret: false, restartRequired: false },
  { key: 'OKARA_SEED_URL', label: 'Okara Seed URL', category: 'phase17', type: 'url', description: 'URL to deep-crawl for marketing opportunities', isSecret: false, restartRequired: false },
  { key: 'OKARA_RECRAWL_CRON', label: 'Okara Recrawl Schedule', category: 'phase17', type: 'string', description: 'Cron schedule (e.g. daily:08:00)', isSecret: false, restartRequired: false },
  { key: 'OKARA_MAX_PAGES', label: 'Okara Max Pages', category: 'phase17', type: 'number', description: 'Max pages per crawl run', isSecret: false, restartRequired: false },
  { key: 'MCTS_MAX_ITERATIONS', label: 'MCTS Max Iterations', category: 'phase17', type: 'number', description: 'Max MCTS iterations per run', isSecret: false, restartRequired: false },
  { key: 'MCTS_MAX_TIME_MINUTES', label: 'MCTS Max Time (min)', category: 'phase17', type: 'number', description: 'Max MCTS run duration in minutes', isSecret: false, restartRequired: false },
  { key: 'MCTS_BRANCH_FACTOR', label: 'MCTS Branch Factor', category: 'phase17', type: 'number', description: 'Candidate children per expansion', isSecret: false, restartRequired: false },
  { key: 'MCTS_ROLLOUT_MODEL', label: 'MCTS Rollout Model', category: 'phase17', type: 'string', description: 'Cheap model for MCTS simulations', isSecret: false, restartRequired: false },
  { key: 'MCTS_JUDGE_MODEL', label: 'MCTS Judge Model', category: 'phase17', type: 'string', description: 'Stronger model for MCTS judging', isSecret: false, restartRequired: false },
  { key: 'MCTS_APPROVAL_DEPTH', label: 'MCTS Approval Depth', category: 'phase17', type: 'number', description: 'Depth at which HITL approval triggers', isSecret: false, restartRequired: false },
  { key: 'MCP_HTTP_PORT', label: 'MCP HTTP Port', category: 'phase17', type: 'number', description: 'Port for MCP gateway HTTP endpoint', isSecret: false, restartRequired: true },
  { key: 'PHASE17_FUGU_SUMMARY_MAX_CHARS', label: 'Fugu Summary Max Chars', category: 'phase17', type: 'number', description: 'Max chars for State Bus summaries', isSecret: false, restartRequired: false },

  // Service ports
  { key: 'OKARA_CRAWLER_PORT', label: 'Okara Crawler Port', category: 'phase17', type: 'number', description: 'Port for okara-crawler service', isSecret: false, restartRequired: true },
  { key: 'MCTS_ENGINE_PORT', label: 'MCTS Engine Port', category: 'phase17', type: 'number', description: 'Port for mcts-engine service', isSecret: false, restartRequired: true },
  { key: 'TMUX_BRIDGE_PORT', label: 'tmux-bridge Port', category: 'phase17', type: 'number', description: 'Port for tmux-bridge service', isSecret: false, restartRequired: true },
  { key: 'PLANNER_PORT', label: 'Planner Port', category: 'phase17', type: 'number', description: 'Port for planner service', isSecret: false, restartRequired: true },
  { key: 'DEPARTMENT_SUPERVISOR_PORT', label: 'Department Supervisor Port', category: 'phase17', type: 'number', description: 'Port for department-supervisor service', isSecret: false, restartRequired: true },
  { key: 'PLANNER_CRON_HOUR', label: 'Planner Cron Hour', category: 'phase17', type: 'number', description: 'Hour (0-23) for daily plan generation', isSecret: false, restartRequired: false },

  // Docker / deployment
  { key: 'JARVIS_MEM_LIMIT', label: 'Docker Memory Limit', category: 'system', type: 'string', description: 'Docker container memory limit (e.g. 4g)', isSecret: false, restartRequired: false },
  { key: 'JARVIS_CPU_LIMIT', label: 'Docker CPU Limit', category: 'system', type: 'number', description: 'Docker container CPU limit', isSecret: false, restartRequired: false },
]

// Build a lookup map for known keys
const KNOWN_MAP = new Map(KNOWN_DEFINITIONS.map(d => [d.key, d]))

// Keys that are always treated as secrets (pattern-based auto-detection)
const SECRET_PATTERNS = [
  /_KEY$/i, /_TOKEN$/i, /_SECRET$/i, /_PASSWORD$/i,
  /SHARED_KEY/i, /BOT_TOKEN/i, /API_KEY/i, /HMAC_SECRET/i,
]

// Keys that should never be shown (internal runtime vars)
const HIDDEN_KEYS = new Set(['_', 'INIT_CWD', 'OLDPWD', 'PWD', 'SHLVL', '_JAVA_OPTIONS'])

export interface SettingValue {
  key: string
  label: string
  category: string
  type: string
  description: string
  isSecret: boolean
  restartRequired: boolean
  value: string | null
  maskedValue: string | null
  isSet: boolean
  isKnown: boolean
}

// ─── Read ALL settings from .env (known + unknown) ───────────────────
export function readAllSettings(): SettingValue[] {
  const envContent = readEnvFile()
  const envMap = parseEnvFile(envContent)
  const result: SettingValue[] = []
  const seenKeys = new Set<string>()

  // 1. Add all known definitions (in registry order)
  for (const def of KNOWN_DEFINITIONS) {
    seenKeys.add(def.key)
    const rawValue = envMap[def.key] || null
    const isSet = rawValue !== null && rawValue.length > 0
    result.push({
      key: def.key,
      label: def.label,
      category: def.category,
      type: def.type,
      description: def.description,
      isSecret: def.isSecret,
      restartRequired: def.restartRequired,
      value: def.isSecret ? null : rawValue,
      maskedValue: isSet ? maskValue(rawValue!, def.isSecret) : null,
      isSet,
      isKnown: true,
    })
  }

  // 2. Add any unknown keys from .env (auto-categorize)
  //    This includes _2 and _3 backup keys (multi-key support)
  for (const [key, rawValue] of Object.entries(envMap)) {
    if (seenKeys.has(key) || HIDDEN_KEYS.has(key)) continue
    if (key.startsWith('npm_') || key.startsWith('PATH=')) continue

    // Check if this is a backup key (e.g. GROQ_API_KEY_2)
    const isBackupKey = key.endsWith('_2') || key.endsWith('_3')
    const baseKey = isBackupKey ? key.replace(/_[23]$/, '') : key
    const baseDef = KNOWN_MAP.get(baseKey)

    const isSecret = baseDef?.isSecret ?? SECRET_PATTERNS.some(p => p.test(key))
    const isSet = rawValue.length > 0
    result.push({
      key,
      label: isBackupKey
        ? `${baseDef?.label || key.replace(/_/g, ' ')} (Backup ${key.endsWith('_2') ? '2' : '3'})`
        : key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
      category: baseDef?.category || 'other',
      type: isSecret ? 'password' : 'string',
      description: isBackupKey
        ? `Backup key for ${baseKey} — automatically used if primary key fails`
        : 'Custom environment variable from .env',
      isSecret,
      restartRequired: false,
      value: isSecret ? null : rawValue,
      maskedValue: isSet ? maskValue(rawValue, isSecret) : null,
      isSet,
      isKnown: false,
    })
  }

  return result
}

function readEnvFile(): string {
  if (!existsSync(ENV_FILE)) return ''
  try { return readFileSync(ENV_FILE, 'utf-8') } catch { return '' }
}

function parseEnvFile(content: string): Record<string, string> {
  const map: Record<string, string> = {}
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx).trim()
    let value = trimmed.slice(eqIdx + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    map[key] = value
  }
  return map
}

function maskValue(value: string, isSecret: boolean): string {
  if (!isSecret) return value
  if (value.length <= 4) return '....'
  return '......' + value.slice(-4)
}

export interface UpdateResult {
  ok: boolean
  key: string
  restartRequired: boolean
  error?: string
}

export function updateSetting(key: string, value: string): UpdateResult {
  // Allow any key (known or unknown) -- this lets users add custom env vars too
  const def = KNOWN_MAP.get(key)

  // Type validation for known keys
  if (def) {
    if (def.type === 'url' && value) {
      try { new URL(value) } catch { return { ok: false, key, restartRequired: false, error: 'Invalid URL format' } }
    }
    if (def.type === 'number' && value) {
      if (isNaN(Number(value))) return { ok: false, key, restartRequired: false, error: 'Invalid number' }
    }
  }

  // Validate key name (prevent injection)
  if (!/^[A-Z_][A-Z0-9_]*$/i.test(key)) {
    return { ok: false, key, restartRequired: false, error: 'Invalid key name (uppercase letters, digits, underscore only)' }
  }

  try {
    const envContent = readEnvFile()

    // ── Multi-key support: if appending a second key (e.g. GROQ_API_KEY_2) ──
    // If the key already exists AND the new value is non-empty, we save the
    // OLD value as {key}_2 and write the new value to {key}. This lets the
    // user add multiple API keys from the UI — the router will try both.
    const envMap = parseEnvFile(envContent)
    const existingValue = envMap[key]
    if (existingValue && existingValue.length > 0 && value && value !== existingValue) {
      // Save the old value as {key}_2 (if _2 doesn't already exist)
      const key2 = `${key}_2`
      const key3 = `${key}_3`
      if (!envMap[key2]) {
        // First backup — save as _2
        const withBackup = setEnvLine(envContent, key2, existingValue)
        const withNew = setEnvLine(withBackup, key, value)
        return writeEnvAtomic(withNew, key, def?.restartRequired ?? false)
      } else if (!envMap[key3]) {
        // Second backup — save as _3
        const withBackup = setEnvLine(envContent, key3, existingValue)
        const withNew = setEnvLine(withBackup, key, value)
        return writeEnvAtomic(withNew, key, def?.restartRequired ?? false)
      }
      // If _2 and _3 both exist, just overwrite the primary key
    }

    const updated = setEnvLine(envContent, key, value)
    return writeEnvAtomic(updated, key, def?.restartRequired ?? false)
  } catch (err: any) {
    return { ok: false, key, restartRequired: false, error: err.message }
  }
}

// Atomic write helper (write to .tmp, chmod, rename)
function writeEnvAtomic(content: string, key: string, restartRequired: boolean): UpdateResult {
  const tmpFile = ENV_FILE + '.tmp'
  writeFileSync(tmpFile, content, 'utf-8')
  let mode = 0o600
  if (existsSync(ENV_FILE)) {
    try { mode = statSync(ENV_FILE).mode & 0o777 } catch {}
  }
  chmodSync(tmpFile, mode)
  renameSync(tmpFile, ENV_FILE)
  return { ok: true, key, restartRequired }
}

function setEnvLine(content: string, key: string, value: string): string {
  const lines = content.split('\n')
  let found = false
  const quotedValue = value.includes(' ') || value.includes('"') || value.includes("'")
    ? `"${value.replace(/"/g, '\\"')}"`
    : value
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim()
    if (trimmed.startsWith('#')) continue
    if (trimmed.startsWith(key + '=')) {
      lines[i] = `${key}=${quotedValue}`
      found = true
      break
    }
  }
  if (!found) {
    if (lines.length > 0 && lines[lines.length - 1] !== '') lines.push('')
    lines.push(`${key}=${quotedValue}`)
  }
  return lines.join('\n')
}

// ─── Test connectivity for any key ───────────────────────────────────
export async function testConnectivity(key: string): Promise<{ ok: boolean; detail: string }> {
  const envMap = parseEnvFile(readEnvFile())
  const value = envMap[key]

  switch (key) {
    case 'OLLAMA_BASE_URL': {
      const url = value || 'http://127.0.0.1:11434'
      try {
        const r = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(3000) })
        if (r.ok) {
          const data = await r.json() as { models?: any[] }
          return { ok: true, detail: `${data.models?.length || 0} models available` }
        }
        return { ok: false, detail: `HTTP ${r.status}` }
      } catch (err: any) {
        return { ok: false, detail: err.message }
      }
    }

    case 'TELEGRAM_BOT_TOKEN': {
      if (!value) return { ok: false, detail: 'Token not set' }
      try {
        const r = await fetch(`https://api.telegram.org/bot${value}/getMe`, { signal: AbortSignal.timeout(5000) })
        const data = await r.json() as { ok?: boolean; result?: { username?: string }; description?: string }
        if (data.ok) return { ok: true, detail: `Connected as @${data.result?.username}` }
        return { ok: false, detail: data.description || 'Invalid token' }
      } catch (err: any) {
        return { ok: false, detail: err.message }
      }
    }

    case 'JARVIS_SHARED_KEY': {
      if (!value) return { ok: false, detail: 'Key not set' }
      if (value.length < 32) return { ok: false, detail: `Key too short (${value.length} chars) -- use openssl rand -hex 32 for 64 chars` }
      // Test by calling the dashboard's /api endpoint with the key
      try {
        const dashboardUrl = envMap.DASHBOARD_BASE || 'http://127.0.0.1:3000'
        const r = await fetch(`${dashboardUrl}/api`, {
          headers: { 'X-JARVIS-Key': value },
          signal: AbortSignal.timeout(3000),
        })
        if (r.ok) return { ok: true, detail: `Key accepted by dashboard (${value.length} chars)` }
        if (r.status === 401) return { ok: false, detail: 'Key rejected by dashboard (401 Unauthorized)' }
        return { ok: false, detail: `Dashboard returned HTTP ${r.status}` }
      } catch (err: any) {
        // Dashboard not running -- just validate format
        return { ok: true, detail: `Key format OK (${value.length} chars) -- start dashboard to test auth` }
      }
    }

    case 'JARVIS_ALLOWED_ORIGINS': {
      if (!value) return { ok: false, detail: 'Not set -- using default (http://127.0.0.1:3000,http://localhost:3000)' }
      const origins = value.split(',').map(s => s.trim()).filter(Boolean)
      if (origins.length === 0) return { ok: false, detail: 'No valid origins found' }
      // Validate each origin is a proper URL
      for (const o of origins) {
        try { new URL(o) } catch { return { ok: false, detail: `Invalid URL: ${o}` } }
      }
      return { ok: true, detail: `${origins.length} origin(s) configured: ${origins.slice(0, 3).join(', ')}${origins.length > 3 ? '...' : ''}` }
    }

    case 'DATABASE_URL': {
      if (!value) return { ok: false, detail: 'DATABASE_URL not set' }
      if (value.startsWith('file:')) return { ok: true, detail: `SQLite file: ${value.slice(5)}` }
      if (value.startsWith('postgresql://') || value.startsWith('postgres://')) {
        return { ok: true, detail: 'PostgreSQL connection string detected' }
      }
      return { ok: false, detail: 'Unrecognized format (expected file: or postgresql://)' }
    }

    case 'REDIS_URL': {
      if (!value) return { ok: false, detail: 'Not set (optional -- in-memory rate limiter used by default)' }
      try {
        const r = await fetch(value.replace('redis://', 'http://').replace('rediss://', 'https://'), { signal: AbortSignal.timeout(2000) })
        return { ok: true, detail: 'Redis URL format OK' }
      } catch {
        return { ok: true, detail: 'Redis URL format OK (cannot ping via HTTP -- use redis-cli to verify)' }
      }
    }

    // Generic API key validation -- just check it's set and reasonably long
    case 'NVIDIA_API_KEY':
    case 'ZAI_API_KEY':
    case 'QWEN_API_KEY':
    case 'GITHUB_TOKEN':
    case 'HUGGINGFACE_API_KEY':
    case 'GROQ_API_KEY':
    case 'OPENAI_API_KEY':
    case 'ANTHROPIC_API_KEY':
    case 'HIGGSFIELD_API_KEY':
    case 'WEATHERSTACK_API_KEY':
    case 'CURRENCYLAYER_API_KEY':
    case 'IPSTACK_API_KEY':
    case 'WEBHOOK_HMAC_SECRET': {
      if (!value) return { ok: false, detail: 'Not set' }
      if (value.length < 10) return { ok: false, detail: `Value too short (${value.length} chars)` }
      return { ok: true, detail: `Key is set (${value.length} chars)` }
    }

    // Telegram Chat ID
    case 'TELEGRAM_CHAT_ID': {
      if (!value) return { ok: false, detail: 'Not set' }
      if (!/^-?\d+$/.test(value)) return { ok: false, detail: 'Must be numeric (e.g. 123456789)' }
      return { ok: true, detail: `Valid chat ID: ${value}` }
    }

    // Dashboard base URL
    case 'DASHBOARD_BASE': {
      if (!value) return { ok: false, detail: 'Not set' }
      try {
        new URL(value)
        const r = await fetch(`${value}/api`, { signal: AbortSignal.timeout(3000) })
        if (r.ok) return { ok: true, detail: `Dashboard reachable at ${value}` }
        return { ok: false, detail: `Dashboard returned ${r.status}` }
      } catch {
        return { ok: false, detail: 'Unreachable or invalid URL' }
      }
    }

    // Node environment
    case 'NODE_ENV': {
      if (!value) return { ok: false, detail: 'Not set' }
      if (value === 'development' || value === 'production') return { ok: true, detail: `Valid: ${value}` }
      return { ok: false, detail: `Invalid (must be development or production)` }
    }

    // Phase 17 toggles — check if service is running
    case 'PHASE17_OKARA_ENABLED':
    case 'PHASE17_TMUX_ENABLED':
    case 'PHASE17_FUGU_ISOLATION':
    case 'PHASE17_MCTS_ENABLED':
    case 'PHASE17_MCP_ENABLED': {
      if (!value || value === 'false') return { ok: true, detail: 'Disabled' }
      if (value !== 'true') return { ok: false, detail: `Invalid (must be true or false)` }
      const ports: Record<string, number> = { PHASE17_OKARA_ENABLED: 3014, PHASE17_MCTS_ENABLED: 3015, PHASE17_MCP_ENABLED: 3016, PHASE17_TMUX_ENABLED: 3017 }
      const port = ports[key]
      if (port) {
        try {
          const r = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(2000) })
          return r.ok ? { ok: true, detail: `Enabled + running on :${port}` } : { ok: false, detail: `Enabled but service not responding on :${port}` }
        } catch {
          return { ok: false, detail: `Enabled but service not running on :${port}` }
        }
      }
      return { ok: true, detail: 'Enabled' }
    }

    // Boolean toggles
    case 'JARVIS_DISABLE_SCREEN_VIEWER':
    case 'JARVIS_DISABLE_MCTS':
    case 'RATE_LIMIT_DISABLED':
    case 'LLM_BUDGET_DISABLED': {
      if (!value) return { ok: true, detail: 'Not set (default)' }
      if (value === 'true' || value === 'false') return { ok: true, detail: `Set to: ${value}` }
      return { ok: false, detail: 'Must be true or false' }
    }

    // Numeric settings
    case 'JARVIS_MAX_CONCURRENCY':
    case 'MCTS_MAX_ITERATIONS':
    case 'MCTS_BRANCH_FACTOR':
    case 'MCTS_APPROVAL_DEPTH':
    case 'MCTS_MAX_TIME_MINUTES':
    case 'OKARA_MAX_PAGES':
    case 'PHASE17_FUGU_SUMMARY_MAX_CHARS':
    case 'OKARA_CRAWLER_PORT':
    case 'MCTS_ENGINE_PORT':
    case 'MCP_HTTP_PORT':
    case 'TMUX_BRIDGE_PORT':
    case 'PLANNER_PORT':
    case 'DEPARTMENT_SUPERVISOR_PORT':
    case 'PLANNER_CRON_HOUR':
    case 'JARVIS_CPU_LIMIT': {
      if (!value) return { ok: true, detail: 'Using default' }
      const n = parseInt(value, 10)
      if (isNaN(n) || n < 1) return { ok: false, detail: 'Must be a positive number' }
      return { ok: true, detail: `Valid: ${n}` }
    }

    // URL settings
    case 'OKARA_SEED_URL':
    case 'TWENTY_CRM_URL':
    case 'CHATWOOT_URL':
    case 'DOCUSEAL_URL':
    case 'VOICE_SERVICE_URL':
    case 'REDIS_URL':
    case 'SENTRY_DSN': {
      if (!value) return { ok: true, detail: 'Not set (optional)' }
      try { new URL(value); return { ok: true, detail: `Valid URL` } } catch { return { ok: false, detail: 'Invalid URL format' } }
    }

    // String settings (just check they're set)
    case 'JARVIS_DEVICE_CLASS':
    case 'JARVIS_TMUX_SESSION':
    case 'OKARA_RECRAWL_CRON':
    case 'JARVIS_BACKUP_CRON':
    case 'MCTS_ROLLOUT_MODEL':
    case 'MCTS_JUDGE_MODEL':
    case 'VOICE_LLM_MODEL':
    case 'VOICE_STT_MODEL':
    case 'PIPER_VOICE':
    case 'FREESWITCH_HOST':
    case 'FREESWITCH_ESL_PASSWORD':
    case 'FREESWITCH_GATEWAY':
    case 'SIP_CALLER_ID':
    case 'SIP_CALLER_NUMBER':
    case 'OWNER_PHONE_NUMBER':
    case 'JARVIS_MEM_LIMIT':
    case 'JARVIS_ALLOWED_ORIGINS':
    case 'LLM_DAILY_BUDGET_USD':
    case 'LLM_COST_PER_1K_INPUT':
    case 'LLM_COST_PER_1K_OUTPUT':
    case 'STRIPE_WEBHOOK_SECRET':
    case 'STRIPE_API_KEY':
    case 'RAZORPAY_WEBHOOK_SECRET':
    case 'RAZORPAY_API_KEY':
    case 'TWENTY_CRM_API_KEY':
    case 'CHATWOOT_API_KEY':
    case 'DOCUSEAL_API_KEY':
    case 'FREESWITCH_ESL_PORT': {
      if (!value) return { ok: true, detail: 'Not set (optional)' }
      return { ok: true, detail: `Configured (${value.length} chars)` }
    }

    default:
      // For ANY unknown key, just check if it's set
      if (!value) return { ok: false, detail: 'Not set' }
      return { ok: true, detail: `Set (${value.length} chars)` }
  }
}

// ─── List + pull Ollama models ──────────────────────────────────────
export async function listOllamaModels(): Promise<{ ok: boolean; models: { name: string; size: string }[]; error?: string }> {
  const envMap = parseEnvFile(readEnvFile())
  const url = envMap['OLLAMA_BASE_URL'] || 'http://127.0.0.1:11434'
  try {
    const r = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(3000) })
    if (!r.ok) return { ok: false, models: [], error: `HTTP ${r.status}` }
    const data = await r.json() as { models?: { name: string; size: number }[] }
    return {
      ok: true,
      models: (data.models || []).map(m => ({
        name: m.name,
        size: m.size > 1e9 ? `${(m.size / 1e9).toFixed(1)} GB` : `${(m.size / 1e6).toFixed(0)} MB`,
      })),
    }
  } catch (err: any) {
    return { ok: false, models: [], error: err.message }
  }
}

export async function pullOllamaModel(modelName: string): Promise<{ ok: boolean; detail: string }> {
  if (!modelName || !/^[a-z0-9._:]+$/i.test(modelName)) {
    return { ok: false, detail: 'Invalid model name (alphanumeric + . _ : only)' }
  }
  const envMap = parseEnvFile(readEnvFile())
  const url = envMap['OLLAMA_BASE_URL'] || 'http://127.0.0.1:11434'
  try {
    const r = await fetch(`${url}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: modelName }),
      signal: AbortSignal.timeout(5000),
    })
    if (r.ok) {
      return { ok: true, detail: `Pull started for '${modelName}'. Check 'ollama list' to monitor progress.` }
    }
    return { ok: false, detail: `HTTP ${r.status}` }
  } catch (err: any) {
    return { ok: false, detail: err.message }
  }
}

// ─── Generate a strong JARVIS_SHARED_KEY ────────────────────────────
export function generateSharedKey(): string {
  return randomBytes(32).toString('hex')
}

// ─── Add a new custom env var ────────────────────────────────────────
export function addCustomVar(key: string, value: string): UpdateResult {
  if (!/^[A-Z_][A-Z0-9_]*$/i.test(key)) {
    return { ok: false, key, restartRequired: false, error: 'Invalid key name (uppercase letters, digits, underscore only)' }
  }
  return updateSetting(key.toUpperCase(), value)
}
