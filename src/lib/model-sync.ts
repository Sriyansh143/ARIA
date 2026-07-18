// =====================================================================
// model-sync.ts — Model Provider Sync Engine (Task ID 12 / PARALLEL-D)
// =====================================================================
// Discovers models from cloud providers (using stored API keys), detects
// locally downloaded Ollama models, runs minimal health-check probes, and
// purges models flagged as broken (rate-limited models are PRESERVED).
//
// All network calls have a 10s timeout and graceful error handling — a
// single provider failing never crashes the sync.
// =====================================================================

import { db } from '@/lib/db';
import { decryptPassword, encryptPassword } from '@/lib/credential-vault';

// ─── Types ────────────────────────────────────────────────────────────

export interface SyncProviderResult {
  provider: string;
  discovered: string[];
  added: { id: string; modelId: string }[];
  skipped: string[];
  broken: { id: string; modelId: string }[];
  error?: string;
}

export interface LocalSyncResult {
  discovered: string[];
  added: { id: string; modelId: string }[];
  updated: { id: string; modelId: string }[];
  error?: string;
}

export interface HealthCheckResult {
  modelId: string;
  providerKey: string;
  status: 'active' | 'broken' | 'rate-limited' | 'unknown';
  latencyMs: number | null;
  error?: string;
}

export interface PurgeResult {
  deleted: number;
  remaining: number;
}

export interface SyncAllReport {
  providers: SyncProviderResult[];
  local: LocalSyncResult;
  healthChecks: HealthCheckResult[];
  purge?: PurgeResult;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  totalAdded: number;
  totalBroken: number;
  totalRateLimited: number;
}

export interface ActivityEvent {
  id: string;
  ts: string;
  kind: 'sync' | 'health-check' | 'purge' | 'local' | 'sync-all';
  target?: string;
  message: string;
  severity: 'info' | 'success' | 'warn' | 'error';
}

// ─── In-memory activity ring buffer (last 50 events) ──────────────────

const ACTIVITY_BUFFER: ActivityEvent[] = [];
const ACTIVITY_MAX = 50;

export function logActivity(ev: Omit<ActivityEvent, 'id' | 'ts'>): void {
  ACTIVITY_BUFFER.unshift({
    ...ev,
    id: `act_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    ts: new Date().toISOString(),
  });
  if (ACTIVITY_BUFFER.length > ACTIVITY_MAX) ACTIVITY_BUFFER.length = ACTIVITY_MAX;
}

export function getActivityLog(limit = 20): ActivityEvent[] {
  return ACTIVITY_BUFFER.slice(0, Math.min(limit, ACTIVITY_BUFFER.length));
}

// ─── Provider endpoint registry ───────────────────────────────────────
// Maps a provider key → { listUrl, authHeader } for fetching the live
// model catalog. Providers without a public list endpoint (anthropic,
// local) are handled by dedicated code paths.

interface ProviderEndpoint {
  url: string;
  authPrefix: string; // 'Bearer' | 'token' etc.
  /** Pluck the model id list from the provider response. */
  extract: (json: unknown) => string[];
}

const PROVIDER_ENDPOINTS: Record<string, ProviderEndpoint> = {
  openai: {
    url: 'https://api.openai.com/v1/models',
    authPrefix: 'Bearer',
    extract: (j) => {
      const arr = (j as { data?: Array<{ id: string }> })?.data ?? [];
      return arr.map((m) => m.id).filter(Boolean);
    },
  },
  groq: {
    url: 'https://api.groq.com/openai/v1/models',
    authPrefix: 'Bearer',
    extract: (j) => {
      const arr = (j as { data?: Array<{ id: string }> })?.data ?? [];
      return arr.map((m) => m.id).filter(Boolean);
    },
  },
  together: {
    url: 'https://api.together.xyz/v1/models',
    authPrefix: 'Bearer',
    extract: (j) => {
      const arr = (j as Array<{ id?: string; name?: string }>) ?? [];
      return arr.map((m) => m.id ?? m.name ?? '').filter(Boolean);
    },
  },
  openrouter: {
    url: 'https://openrouter.ai/api/v1/models',
    authPrefix: 'Bearer',
    extract: (j) => {
      const arr = (j as { data?: Array<{ id: string }> })?.data ?? [];
      return arr.map((m) => m.id).filter(Boolean);
    },
  },
  deepseek: {
    url: 'https://api.deepseek.com/models',
    authPrefix: 'Bearer',
    extract: (j) => {
      const arr = (j as { data?: Array<{ id: string }> })?.data ?? [];
      return arr.map((m) => m.id).filter(Boolean);
    },
  },
  mistral: {
    url: 'https://api.mistral.ai/v1/models',
    authPrefix: 'Bearer',
    extract: (j) => {
      const arr = (j as { data?: Array<{ id: string }> })?.data ?? [];
      return arr.map((m) => m.id).filter(Boolean);
    },
  },
  cohere: {
    url: 'https://api.cohere.ai/v1/models',
    authPrefix: 'Bearer',
    extract: (j) => {
      const arr = (j as { models?: Array<{ name?: string; id?: string }> })?.models ?? [];
      return arr.map((m) => m.name ?? m.id ?? '').filter(Boolean);
    },
  },
};

// Anthropic has no public list-models endpoint. We hardcode their known
// catalog and compare against the DB; new entries become Model rows.
const ANTHROPIC_KNOWN_MODELS = [
  'claude-opus-4-6',
  'claude-sonnet-4-5',
  'claude-haiku-4-5',
  'claude-3-7-sonnet-20250219',
  'claude-3-5-haiku-20241022',
  'claude-3-5-sonnet-20241022',
  'claude-3-opus-20240229',
  'claude-3-haiku-20240307',
];

// ─── Helpers ──────────────────────────────────────────────────────────

const TEN_S_TIMEOUT = 10_000;

async function fetchWithTimeout(url: string, opts: RequestInit = {}, timeoutMs = TEN_S_TIMEOUT): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Read a provider's decrypted API key from the DB. Returns null if unset or unreadable. */
async function readProviderApiKey(providerKey: string): Promise<string | null> {
  const p = await db.provider.findUnique({ where: { key: providerKey } });
  if (!p || !p.apiKeyEnc || !p.apiKeyIv || !p.apiKeyTag) return null;
  try {
    return decryptPassword(p.apiKeyEnc, p.apiKeyIv, p.apiKeyTag);
  } catch {
    return null;
  }
}

/** Encrypt and persist a provider API key (called from the providers API). */
export async function setProviderApiKey(providerKey: string, plainKey: string): Promise<void> {
  const enc = encryptPassword(plainKey);
  await db.provider.update({
    where: { key: providerKey },
    data: { apiKeyEnc: enc.encrypted, apiKeyIv: enc.iv, apiKeyTag: enc.tag },
  });
}

/** Heuristically pick a tier for a freshly discovered model id. */
function guessTier(modelId: string): string {
  const id = modelId.toLowerCase();
  if (id.includes('mini') || id.includes('flash') || id.includes('haiku') || id.includes('small') || id.includes('nano')) return 'fast';
  if (id.includes('vision') || id.includes('image') || id.includes('vl')) return 'vision';
  if (id.includes('opus') || id.includes('ultra') || id.includes('giant') || id.includes('405b') || id.includes('o1')) return 'giant';
  if (id.includes('local') || id.includes('ollama') || id.includes('llama') || id.includes('qwen')) return 'local';
  return 'strong';
}

/** Heuristic capability tags for a model id (used for newly discovered rows). */
function guessCapabilities(modelId: string): string {
  const id = modelId.toLowerCase();
  const caps: string[] = ['text'];
  if (id.includes('vision') || id.includes('vl') || id.includes('image')) caps.push('vision');
  if (id.includes('embed')) caps.push('embeddings');
  if (id.includes('audio') || id.includes('whisper') || id.includes('tts')) caps.push('audio');
  if (id.includes('code') || id.includes('codestral')) caps.push('code');
  if (id.includes('reason') || id.includes('o1') || id.includes('thinking')) caps.push('reasoning');
  if (id.includes('rerank')) caps.push('rerank');
  return JSON.stringify(caps);
}

// ─── syncProviderModels ───────────────────────────────────────────────

export async function syncProviderModels(providerKey: string): Promise<SyncProviderResult> {
  const result: SyncProviderResult = {
    provider: providerKey,
    discovered: [],
    added: [],
    skipped: [],
    broken: [],
  };

  // Local is handled by detectLocalModels.
  if (providerKey === 'local') {
    result.error = 'Use detectLocalModels() for local models';
    return result;
  }

  // Anthropic has no public list endpoint — use the hardcoded catalog.
  if (providerKey === 'anthropic') {
    result.discovered = [...ANTHROPIC_KNOWN_MODELS];
  } else {
    const ep = PROVIDER_ENDPOINTS[providerKey];
    if (!ep) {
      result.error = `No sync endpoint registered for provider '${providerKey}'`;
      return result;
    }
    const apiKey = await readProviderApiKey(providerKey);
    if (!apiKey) {
      result.error = `No API key stored for provider '${providerKey}'`;
      return result;
    }
    try {
      const res = await fetchWithTimeout(ep.url, {
        headers: { Authorization: `${ep.authPrefix} ${apiKey}` },
      });
      if (res.status === 401 || res.status === 403) {
        result.error = `Auth failed (${res.status}) for ${providerKey} — key invalid or revoked`;
        return result;
      }
      if (res.status === 429) {
        result.error = `Rate-limited (429) listing models for ${providerKey} — try again later`;
        return result;
      }
      if (!res.ok) {
        result.error = `HTTP ${res.status} from ${providerKey} list endpoint`;
        return result;
      }
      const json = await res.json();
      const ids = ep.extract(json);
      result.discovered = ids;
    } catch (err) {
      result.error = `Fetch failed for ${providerKey}: ${err instanceof Error ? err.message : String(err)}`;
      return result;
    }
  }

  if (result.discovered.length === 0) {
    return result;
  }

  // Compare against DB.
  const existing = await db.model.findMany({ where: { providerKey } });
  const existingIds = new Set(existing.map((m) => m.modelId));
  const discoveredSet = new Set(result.discovered);

  // Add new models.
  for (const id of result.discovered) {
    if (existingIds.has(id)) {
      result.skipped.push(id);
      continue;
    }
    try {
      const created = await db.model.create({
        data: {
          providerKey,
          modelId: id,
          tier: guessTier(id),
          capabilities: guessCapabilities(id),
          enabled: true,
          source: 'provider',
          status: 'active',
          lastChecked: new Date(),
        },
      });
      result.added.push({ id: created.id, modelId: created.modelId });
    } catch (err) {
      // Most likely a unique constraint race — skip gracefully.
      result.skipped.push(id);
      void err;
    }
  }

  // Mark models in DB but NOT in the discovered list as broken.
  for (const m of existing) {
    if (!discoveredSet.has(m.modelId) && m.source !== 'seed') {
      // Don't break seed models — they're our baseline; the provider API may
      // legitimately not list them (e.g. deprecated names still functional).
      // Only flag provider-sourced rows that have disappeared.
      if (m.status !== 'broken') {
        await db.model.update({ where: { id: m.id }, data: { status: 'broken', lastChecked: new Date() } });
        result.broken.push({ id: m.id, modelId: m.modelId });
      }
    }
  }

  logActivity({
    kind: 'sync',
    target: providerKey,
    message: `${providerKey}: discovered ${result.discovered.length}, added ${result.added.length}, marked broken ${result.broken.length}${result.error ? ` — ${result.error}` : ''}`,
    severity: result.error ? 'warn' : 'success',
  });

  return result;
}

// ─── detectLocalModels (Ollama) ───────────────────────────────────────

export async function detectLocalModels(): Promise<LocalSyncResult> {
  const result: LocalSyncResult = { discovered: [], added: [], updated: [] };
  try {
    const res = await fetchWithTimeout('http://localhost:11434/api/tags', {}, 5000);
    if (!res.ok) {
      result.error = `Ollama responded HTTP ${res.status}`;
      logActivity({ kind: 'local', message: `Ollama tags endpoint returned ${res.status}`, severity: 'warn' });
      return result;
    }
    const json = (await res.json()) as { models?: Array<{ name?: string; model?: string }> };
    const tags = json.models ?? [];
    result.discovered = tags.map((t) => t.name ?? t.model ?? '').filter(Boolean);
  } catch (err) {
    result.error = `Ollama unreachable: ${err instanceof Error ? err.message : String(err)}`;
    logActivity({ kind: 'local', message: `Ollama unreachable: ${result.error}`, severity: 'warn' });
    return result;
  }

  if (result.discovered.length === 0) {
    return result;
  }

  for (const modelId of result.discovered) {
    const existing = await db.model.findFirst({ where: { providerKey: 'local', modelId } });
    if (existing) {
      await db.model.update({
        where: { id: existing.id },
        data: { status: 'active', source: 'local', lastChecked: new Date(), enabled: true },
      });
      result.updated.push({ id: existing.id, modelId });
    } else {
      try {
        const created = await db.model.create({
          data: {
            providerKey: 'local',
            modelId,
            tier: 'local',
            capabilities: guessCapabilities(modelId),
            enabled: true,
            source: 'local',
            status: 'active',
            lastChecked: new Date(),
          },
        });
        result.added.push({ id: created.id, modelId: created.modelId });
      } catch {
        // Race / unique constraint — ignore.
      }
    }
  }

  logActivity({
    kind: 'local',
    message: `Ollama: detected ${result.discovered.length}, added ${result.added.length}, refreshed ${result.updated.length}`,
    severity: 'success',
  });

  return result;
}

// ─── healthCheckModel ─────────────────────────────────────────────────

export async function healthCheckModel(
  modelId: string,
  providerKey: string,
): Promise<HealthCheckResult> {
  const start = Date.now();
  const r: HealthCheckResult = {
    modelId,
    providerKey,
    status: 'unknown',
    latencyMs: null,
  };

  // Local (Ollama) — ping the model with a 1-token generation.
  if (providerKey === 'local') {
    try {
      const res = await fetchWithTimeout(
        'http://localhost:11434/api/generate',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: modelId, prompt: 'ping', stream: false, options: { num_predict: 1 } }),
        },
        8000,
      );
      r.latencyMs = Date.now() - start;
      if (res.status === 404) {
        r.status = 'broken';
        r.error = 'Model not found locally (pulled but missing)';
      } else if (res.status === 429) {
        r.status = 'rate-limited';
      } else if (res.ok) {
        r.status = 'active';
      } else {
        r.status = 'broken';
        r.error = `HTTP ${res.status}`;
      }
    } catch (err) {
      r.status = 'broken';
      r.error = err instanceof Error ? err.message : String(err);
    }
    await applyHealthResult(modelId, providerKey, r);
    return r;
  }

  // Anthropic — has a separate messages API + header auth. Check this BEFORE
  // the generic OpenAI-compatible path (anthropic isn't in PROVIDER_ENDPOINTS).
  if (providerKey === 'anthropic') {
    const apiKey = await readProviderApiKey(providerKey);
    if (!apiKey) {
      r.error = 'No API key for anthropic';
      r.status = 'unknown';
      await applyHealthResult(modelId, providerKey, r);
      return r;
    }
    try {
      const res = await fetchWithTimeout(
        'https://api.anthropic.com/v1/messages',
        {
          method: 'POST',
          headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: modelId,
            max_tokens: 1,
            messages: [{ role: 'user', content: 'ping' }],
          }),
        },
        8000,
      );
      r.latencyMs = Date.now() - start;
      if (res.status === 429) r.status = 'rate-limited';
      else if (res.status === 401 || res.status === 403) {
        r.status = 'broken';
        r.error = 'Auth failed';
      } else if (res.status === 404 || res.status === 400) {
        r.status = 'broken';
        r.error = `HTTP ${res.status}`;
      } else if (res.ok) r.status = 'active';
      else {
        r.status = 'broken';
        r.error = `HTTP ${res.status}`;
      }
    } catch (err) {
      r.status = 'broken';
      r.error = err instanceof Error ? err.message : String(err);
    }
    await applyHealthResult(modelId, providerKey, r);
    return r;
  }

  // Cloud providers — use the chat-completions endpoint with a 1-token cap.
  const ep = PROVIDER_ENDPOINTS[providerKey];
  if (!ep) {
    r.error = `No health-check endpoint for provider '${providerKey}'`;
    await applyHealthResult(modelId, providerKey, r);
    return r;
  }

  // OpenAI-compatible chat completions.
  const apiKey = await readProviderApiKey(providerKey);
  if (!apiKey) {
    r.error = `No API key for ${providerKey}`;
    r.status = 'unknown';
    await applyHealthResult(modelId, providerKey, r);
    return r;
  }

  // Build the completions URL from the provider's list URL origin.
  const origin = new URL(ep.url).origin;
  const chatUrl =
    providerKey === 'openrouter'
      ? 'https://openrouter.ai/api/v1/chat/completions'
      : providerKey === 'mistral'
        ? 'https://api.mistral.ai/v1/chat/completions'
        : providerKey === 'cohere'
          ? 'https://api.cohere.ai/v2/chat'
          : `${origin}/v1/chat/completions`;

  try {
    const body =
      providerKey === 'cohere'
        ? JSON.stringify({ model: modelId, messages: [{ role: 'user', content: 'ping' }], max_tokens: 1 })
        : JSON.stringify({ model: modelId, messages: [{ role: 'user', content: 'ping' }], max_tokens: 1 });
    const res = await fetchWithTimeout(
      chatUrl,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body,
      },
      8000,
    );
    r.latencyMs = Date.now() - start;
    if (res.status === 429) r.status = 'rate-limited';
    else if (res.status === 401 || res.status === 403) {
      r.status = 'broken';
      r.error = 'Auth failed';
    } else if (res.status === 404 || res.status === 400) {
      r.status = 'broken';
      r.error = `HTTP ${res.status}`;
    } else if (res.ok) r.status = 'active';
    else if (res.status >= 500) {
      r.status = 'broken';
      r.error = `HTTP ${res.status} (server error)`;
    } else {
      r.status = 'unknown';
      r.error = `HTTP ${res.status}`;
    }
  } catch (err) {
    r.status = 'broken';
    r.error = err instanceof Error ? err.message : String(err);
  }

  await applyHealthResult(modelId, providerKey, r);
  return r;
}

async function applyHealthResult(modelId: string, providerKey: string, r: HealthCheckResult): Promise<void> {
  try {
    await db.model.updateMany({
      where: { providerKey, modelId },
      data: { status: r.status, lastChecked: new Date(), latencyMs: r.latencyMs ?? undefined },
    });
    logActivity({
      kind: 'health-check',
      target: `${providerKey}/${modelId}`,
      message: `${r.status} (${r.latencyMs ?? '?'}ms)${r.error ? ` — ${r.error}` : ''}`,
      severity: r.status === 'active' ? 'success' : r.status === 'rate-limited' ? 'warn' : r.status === 'broken' ? 'error' : 'info',
    });
  } catch {
    // ignore DB write failures
  }
}

// ─── purgeBrokenModels ────────────────────────────────────────────────

export async function purgeBrokenModels(): Promise<PurgeResult> {
  const deleted = await db.model.deleteMany({ where: { status: 'broken' } });
  const remaining = await db.model.count();
  logActivity({
    kind: 'purge',
    message: `Purged ${deleted.count} broken models; ${remaining} remain (rate-limited preserved)`,
    severity: deleted.count > 0 ? 'success' : 'info',
  });
  return { deleted: deleted.count, remaining };
}

// ─── syncAll ──────────────────────────────────────────────────────────

export async function syncAll(): Promise<SyncAllReport> {
  const startedAt = new Date();
  const startMs = Date.now();

  // Find every provider with an API key stored + the special local + anthropic.
  const providers = await db.provider.findMany();
  const syncable = providers.filter((p) => {
    if (p.key === 'anthropic') return true; // uses hardcoded list
    return !!(p.apiKeyEnc && p.apiKeyIv && p.apiKeyTag);
  });

  // Run provider syncs in parallel batches of 4 to avoid overwhelming the
  // network / tripping rate limits.
  const providerResults: SyncProviderResult[] = [];
  const batchSize = 4;
  for (let i = 0; i < syncable.length; i += batchSize) {
    const batch = syncable.slice(i, i + batchSize);
    const rs = await Promise.all(batch.map((p) => syncProviderModels(p.key)));
    providerResults.push(...rs);
  }

  // Local detection.
  const local = await detectLocalModels();

  // Health-check a sample of 10 active provider-sourced models.
  const sampleCandidates = await db.model.findMany({
    where: { status: 'active', source: 'provider' },
    take: 50,
  });
  // shuffle + take 10
  const shuffled = sampleCandidates.sort(() => Math.random() - 0.5).slice(0, 10);
  const healthChecks = await Promise.all(
    shuffled.map((m) => healthCheckModel(m.modelId, m.providerKey)),
  );

  const totalAdded = providerResults.reduce((s, r) => s + r.added.length, 0) + local.added.length;
  const totalBroken = providerResults.reduce((s, r) => s + r.broken.length, 0);
  const totalRateLimited = healthChecks.filter((h) => h.status === 'rate-limited').length;

  const finishedAt = new Date();
  logActivity({
    kind: 'sync-all',
    message: `Sync all complete: ${totalAdded} added, ${totalBroken} broken, ${totalRateLimited} rate-limited (of ${healthChecks.length} health-checked)`,
    severity: 'success',
  });

  return {
    providers: providerResults,
    local,
    healthChecks,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: Date.now() - startMs,
    totalAdded,
    totalBroken,
    totalRateLimited,
  };
}

// ─── aggregateStatusSummary (used by the UI banner) ───────────────────

export interface ModelStatusSummary {
  total: number;
  active: number;
  broken: number;
  rateLimited: number;
  unknown: number;
  local: number;
  providerSourced: number;
  seed: number;
  byProvider: Array<{ providerKey: string; total: number; active: number; broken: number; rateLimited: number; lastChecked: string | null; hasKey: boolean }>;
  lastSyncAt: string | null;
}

export async function getModelStatusSummary(): Promise<ModelStatusSummary> {
  const [total, active, broken, rateLimited, unknown, local, providerSourced, seed] = await Promise.all([
    db.model.count(),
    db.model.count({ where: { status: 'active' } }),
    db.model.count({ where: { status: 'broken' } }),
    db.model.count({ where: { status: 'rate-limited' } }),
    db.model.count({ where: { status: 'unknown' } }),
    db.model.count({ where: { source: 'local' } }),
    db.model.count({ where: { source: 'provider' } }),
    db.model.count({ where: { source: 'seed' } }),
  ]);

  const providers = await db.provider.findMany();
  const models = await db.model.findMany({ select: { providerKey: true, status: true, lastChecked: true } });

  const byProvider = providers.map((p) => {
    const list = models.filter((m) => m.providerKey === p.key);
    const lastChecked = list
      .map((m) => m.lastChecked)
      .filter((x): x is Date => !!x)
      .sort((a, b) => b.getTime() - a.getTime())[0];
    return {
      providerKey: p.key,
      total: list.length,
      active: list.filter((m) => m.status === 'active').length,
      broken: list.filter((m) => m.status === 'broken').length,
      rateLimited: list.filter((m) => m.status === 'rate-limited').length,
      lastChecked: lastChecked ? lastChecked.toISOString() : null,
      hasKey: !!(p.apiKeyEnc && p.apiKeyIv && p.apiKeyTag),
    };
  });

  // Last sync = most recent activity log entry tagged 'sync' or 'sync-all'.
  const lastSync = ACTIVITY_BUFFER.find((e) => e.kind === 'sync' || e.kind === 'sync-all' || e.kind === 'local');

  return {
    total,
    active,
    broken,
    rateLimited,
    unknown,
    local,
    providerSourced,
    seed,
    byProvider,
    lastSyncAt: lastSync?.ts ?? null,
  };
}
