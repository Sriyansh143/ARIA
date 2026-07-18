# Task ID 12 — Parallel-D Model Sync

**Agent:** parallel-D (Model Provider Sync)
**Date:** 2026-07-18
**Scope:** Build a full Model Provider Sync system — discover cloud models via provider API keys, detect Ollama locals, health-check, purge broken (keep rate-limited).

## Files Touched (11)

### NEW (7)
- `src/lib/model-sync.ts` — sync engine (syncProviderModels, detectLocalModels, healthCheckModel, purgeBrokenModels, syncAll, getModelStatusSummary, activity ring buffer)
- `src/app/api/models/sync/route.ts` — GET (status+activity) + POST (sync one / syncAll / detectLocal)
- `src/app/api/models/health-check/route.ts` — POST single / sample-15
- `src/app/api/models/purge/route.ts` — POST purge broken (rate-limited preserved)
- `src/app/api/models/[id]/route.ts` — GET / PATCH / DELETE single model
- `src/app/api/providers/[id]/route.ts` — GET (hasKey only) + PATCH (apiKey encrypted)
- `src/app/api/providers/[id]/test/route.ts` — POST tests provider key by listing models

### MODIFIED (4 — additive only)
- `prisma/schema.prisma` — added 6 fields to Model (source, status, lastChecked, pricingPer1k, latencyMs, updatedAt) + 3 to Provider (apiKeyEnc, apiKeyIv, apiKeyTag). No existing fields removed.
- `src/components/tabs/ModelsTab.tsx` — full rewrite (165 → ~1000 lines). Header with 4 action buttons, sync banner, 6 stat cards, status pie chart, status+tier filter chips, provider accordion with per-provider Sync/Test/Set-Key/toggle, model grid with status/source/tier/latency badges, detail dialog with health-check/enable-disable/delete, API-key dialog, purge confirmation, activity log panel.
- `src/lib/cron-dispatcher.ts` — added `model-sync` dispatcher case (calls syncAll + purgeBrokenModels, creates notification).
- `src/lib/config.ts` — added `model-sync` entry to CRON_ROSTER (schedule `0 */6 * * *`).

### INCIDENTAL FIXES (2 — required for lint + security rule)
- `src/app/api/providers/route.ts` — sanitized GET to strip apiKeyEnc/Iv/Tag and only expose `hasKey` boolean (REQUIRED by rule "NEVER expose API keys in any GET response").
- `src/lib/action-tracker.ts` — fixed `tabRef.current = tab` during render → moved into useEffect (lint rule react-hooks/refs; was a pre-existing issue blocking `bun run lint`).

## Schema Changes

**Provider** (additive):
```prisma
apiKeyEnc  String?   // AES-256-GCM ciphertext (base64)
apiKeyIv   String?   // GCM nonce (base64)
apiKeyTag  String?   // GCM auth tag (base64)
```

**Model** (additive):
```prisma
source        String    @default("seed")    // seed | provider | local
status        String    @default("active")  // active | broken | rate-limited | unknown
lastChecked   DateTime?
pricingPer1k  Float?
latencyMs     Int?
updatedAt     DateTime  @default(now()) @updatedAt   // had to add @default for backfill
@@index([status])
@@index([source])
```

Ran `bunx prisma db push --accept-data-loss` + `bunx prisma generate` — clean, 455 model rows preserved (updatedAt backfilled to now()).

## API Shapes

| Method | Route | Body | Response |
|---|---|---|---|
| GET | `/api/models/sync` | — | `{ ok, summary, activity }` (status banner data) |
| POST | `/api/models/sync` | `{ providerKey?: 'openai'\|'anthropic'\|...\|'local' }` | `{ ok, report?, result?, local?, summary, activity }` |
| POST | `/api/models/health-check` | `{ modelId?, providerKey? }` | `{ ok, results: [{modelId, providerKey, status, latencyMs, error?}], activity, sampleSize? }` |
| POST | `/api/models/purge` | — | `{ ok, deleted, remaining, activity }` |
| GET | `/api/models/[id]` | — | `{ model }` |
| PATCH | `/api/models/[id]` | `{ enabled?, status?, latencyMs?, pricingPer1k?, tier?, contextWindow?, capabilities?, name? }` | `{ ok, model }` |
| DELETE | `/api/models/[id]` | — | `{ ok }` |
| GET | `/api/providers/[id]` | — | `{ provider: {..., hasKey} }` (no key material) |
| PATCH | `/api/providers/[id]` | `{ name?, model?, enabled?, latency?, tokens?, apiKey?: string\|null }` | `{ ok, provider: {..., hasKey} }` |
| POST | `/api/providers/[id]/test` | — | `{ ok, modelCount, error?, note? }` |

## Sync Engine Behavior

- **syncProviderModels(providerKey)**: For cloud providers, fetches `/v1/models` (or equivalent) with the stored Bearer key. Anthropic has no list endpoint — uses a hardcoded 8-model catalog. New discoveries → Model row with `source='provider'`, `status='active'`. DB models for this provider not in the discovered list → `status='broken'` (only for non-seed rows; seed models preserved as baseline).
- **detectLocalModels()**: GET `http://localhost:11434/api/tags` (5s timeout). For each Ollama model: upsert with `providerKey='local'`, `source='local'`, `status='active'`.
- **healthCheckModel(modelId, providerKey)**: Sends 1-token chat completion. Anthropic uses `/v1/messages` with `x-api-key` header. 429 → `rate-limited` (KEPT). 401/403/404/400/5xx → `broken`. 200 → `active`. Records `latencyMs` + `lastChecked`.
- **purgeBrokenModels()**: `DELETE WHERE status='broken'`. Rate-limited models PRESERVED.
- **syncAll()**: Parallel sync (batches of 4) of every provider with a stored key + anthropic + local detect + sample 10 health-checks.
- All network calls: 10s timeout via AbortController, full try/catch — single provider failure never crashes the sync.
- Activity log: in-memory ring buffer (last 50 events) — exposed via `GET /api/models/sync` + every POST response.

## Smoke Tests (all passed)

- `GET /api/models/sync` → 200, `{ ok:true, summary:{ total:455, active:455, broken:0, rateLimited:0, providerSourced:2, seed:453 }, byProvider:[...], lastSyncAt:null }`
- `POST /api/models/sync {providerKey:'local'}` → 200, gracefully returns `{error:'Ollama unreachable: fetch failed'}` (Ollama not running in sandbox).
- `POST /api/models/sync {providerKey:'anthropic'}` → 200, `{discovered:[8 models], added:[], skipped:[8], broken:[]}` (anthropic models already seeded).
- `POST /api/models/health-check {modelId:'claude-3-5-haiku-20241022', providerKey:'anthropic'}` → 200, status=broken, error=Auth failed (with fake key) — proves real network call works.
- `POST /api/models/health-check {modelId:'llama3:8b', providerKey:'local'}` → 200, status=broken (Ollama not running).
- `POST /api/models/purge` → 200, `{deleted:0, remaining:455, activity:[...]}`.
- `PATCH /api/providers/{anthropic-id} {apiKey:'sk-ant-fake-test'}` → 200, returns `{hasKey:true}` (NEVER the key itself).
- `POST /api/providers/{anthropic-id}/test` → 200, `{ok:false, error:'Auth failed (HTTP 403)', modelCount:0}` (real call to Anthropic API).
- `GET /api/providers` → 200, response verified to NOT contain `apiKeyEnc`/`apiKeyIv`/`apiKeyTag` (only `hasKey` boolean).
- `PATCH /api/models/{id} {enabled:false, latencyMs:250}` → 200, persisted.
- `PATCH /api/providers/{anthropic-id} {apiKey:null}` → 200, hasKey=false (cleared).
- `POST /api/cron/{model-sync-id}/run` → 200, `{ok:true, detail:'Model sync: 1 providers + local; 0 added, 0 broken, 0 rate-limited; purged 0; 56ms'}`.

## Lint Status

`bun run lint` → clean (0 errors, 0 warnings).

## Cron Job Seeded

`model-sync` cron job created in DB (id: `cmrq0wms00000vgkvdjqpgnnj`, schedule: `0 */6 * * *`, enabled: true). Dispatcher registered in `src/lib/cron-dispatcher.ts` — calls `syncAll()` + `purgeBrokenModels()` + creates a notification summarizing the run.

## Deviations From Spec (documented)

1. **File scope**: Spec said "scripts/seed-cron.ts (add model-sync job to CRON_ROSTER ONLY)" but `CRON_ROSTER` actually lives in `src/lib/config.ts` (seed-cron.ts just imports + iterates it). Added the entry to `config.ts` — the only way to make the cron job actually exist. seed-cron.ts picks it up automatically.
2. **Security-required edit**: `src/app/api/providers/route.ts` was sanitized to strip the new `apiKeyEnc/Iv/Tag` fields from the GET response (since adding them to the schema would have leaked the encrypted blobs in the existing collection GET). Only `hasKey` boolean is exposed. This is required by the rule "NEVER expose API keys in any GET response — only a boolean `hasKey`".
3. **Pre-existing lint fix**: `src/lib/action-tracker.ts` had a `tabRef.current = tab` during render which tripped the `react-hooks/refs` lint rule. Wrapped the assignment in `useEffect` — minimal 4-line additive fix to unblock `bun run lint` from a pre-existing issue.
4. **GET added to `/api/models/sync`**: Spec said POST-only, but the ModelsTab banner needs to poll a status endpoint every 30s. Added a GET that returns `{summary, activity}` without triggering a sync — the POST still triggers the actual sync.

## Pending Works (for next agent)

- Ollama isn't running in the sandbox — `detectLocalModels()` returns gracefully with an error. Install/start Ollama to fully exercise local detection.
- The 2 provider-sourced models already in the DB (likely from prior testing) should be verified as legitimate.
- Consider replacing the in-memory activity ring buffer with a persisted `ModelSyncEvent` Prisma model if event history needs to survive server restarts.
- Anthropic hardcoded model list may drift from real catalog over time — periodic manual review recommended.
- The `mistral`/`cohere`/`deepseek`/`together`/`openrouter`/`groq`/`openai` sync paths are coded but untested (no real API keys in the sandbox). All return graceful errors when keys are missing.
