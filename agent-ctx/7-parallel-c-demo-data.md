# Task ID: 7 — Agent: parallel-C Demo Data

## Task
Build a full Demo Data Management system for JARVIS Mission Control: in-app UI panel + admin API (GET/POST/DELETE) for seeding and clearing demo data, with all seed scripts refactored to export callable functions.

## Files Created
- `src/app/api/admin/data/route.ts` — Admin API: GET (counts + seed script catalog), POST (run a seed script inline via dynamic `import()`), DELETE (clear demo data by scope).
- `src/app/api/admin/data/counts/route.ts` — Lightweight GET endpoint returning only per-table row counts (for 20s polling).
- `src/components/tabs/DataManagementTab.tsx` — Full UI panel: inventory grid (25 tables color-coded), 8 seed buttons, 7 remove buttons, confirmation dialogs, typed "RESET" confirmation for the Reset-All action, warning banner.
- `scripts/seed-learning.ts` — Thin CLI wrapper around `seedLearning()` exported from seed-agents.ts.

## Files Modified (refactor: export callable functions, keep CLI block intact)
- `scripts/seed-agents.ts` — exports `seedAgentsRoster()` and `seedLearning()`; wraps `main()` in `if (require.main === module)`.
- `scripts/seed-cron.ts` — exports `seedCronJobs()`.
- `scripts/seed-providers-models.ts` — exports `seedProvidersModels()`.
- `scripts/seed-rules.ts` — exports `seedRules()`.
- `scripts/seed-earning-methods.ts` — exports `seedEarningMethods()`.
- `scripts/seed-add.ts` — exports `seedCommsAndPayments()`.

## Files Modified (surgical)
- `src/app/page-client.tsx` — added import for `DataManagementTab`, added `'data-mgmt'` to the `TabKey` union, added the tab entry `{ key: 'data-mgmt', label: 'Data Mgmt', icon: Database, group: 'Operations', accent: JARVIS.colors.amber }` to `TABS`, added `'data-mgmt': DataManagementTab` to `TAB_MAP`. No other changes.

## API Shapes
- `GET /api/admin/data` → `{ counts: Record<string, number>, seedScripts: SeedScriptMeta[], ts }`
- `GET /api/admin/data/counts` → `{ counts, ts }` (lightweight, for polling)
- `POST /api/admin/data { script }` → `{ ok, message, counts, elapsed }`
- `DELETE /api/admin/data { scope }` → `{ ok, deleted, total, message, counts, elapsed }`

## Verification
- All 8 seed scripts callable via POST: agents (232ms), cron (41ms), providers-models (509ms), rules (122ms), earning-methods (40ms), comms-payments (15ms), learning (34ms), all (682ms).
- DELETE works for all 7 scopes: transactions, logs, comms, telemetry, notifications, spawned, all (cleared 157 rows in 10ms).
- `bun run lint` → exit 0, 0 errors, 0 warnings.
- Dev server healthy, page renders HTTP 200, no errors in dev.log.
- All 25 demo-able tables counted correctly: agents=66, skills=20, cronJobs=27, providers=23, models=453, rules=33, earningMethods=28, payments=13, comms=10, memoryItems=24, notifications=0, telemetry=0, tasks=15, artifacts=6, spawnedAgents=0, workforceAgents=64, credentials=1, learningItems=15, goals=0, plugins=8, blackboxLogs=0, scheduledAutonomy=1, autonomyTemplates=1, pipelines=1, agentLogs=82.

## Safety
- All seed actions open a confirmation dialog ("This will ADD demo data. Continue?").
- All remove actions open a confirmation dialog ("This will permanently delete...").
- The "Reset ALL" action requires typing "RESET" to confirm (AlertDialog with text input).
- Warning banner at top: "These actions modify the database directly. Use with caution in production."
- Reference data (providers, models, rules, earning methods, agents, plugins, skills, departments, workforce, credentials, memoryItems, skillLearning, artifacts, tasks, pipelines, scheduledAutonomy, autonomyTemplates) is preserved by the `all` delete scope.

## Notes
- The seed scripts are dynamically `import()`-ed in the API route (NOT executed as subprocesses). Turbopack's static analyzer required us to use literal `await import('...')` calls in a switch statement — variable-path imports fall back to an 'unknown' stub at build time. Path resolution: 5 `../` segments from `src/app/api/admin/data/route.ts` reaches the project root.
- `seed-learning.ts` is a CLI-only wrapper script (it imports `seedLearning` from `seed-agents.ts` and runs it). The API route imports `seedLearning` directly from `seed-agents.ts` to avoid double-loading.
- Counts poll every 20s via `useApi(url, 20000)`.
