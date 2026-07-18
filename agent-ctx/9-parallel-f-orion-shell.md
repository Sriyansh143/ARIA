# Task 9 — parallel-F (Orion Shell Intent Routing)

**Scope:** Make the Orion Shell smarter with intent routing for the JARVIS Mission Control Next.js app.

## Files Created / Modified

| File | Status | Lines |
|---|---|---|
| `src/lib/orion-intent.ts` | NEW | 786 |
| `src/app/api/orion/command/route.ts` | NEW | 828 |
| `src/components/jarvis/OrionShell.tsx` | REWRITE (818 → 1566) | +748 |

Total: 3 files, ~3,180 lines.

## Intent Taxonomy (14 intents)

| Intent | Trigger examples | Server action | Client action |
|---|---|---|---|
| `navigate` | "show fleet", "open tasks", "go to payments" | Returns `tab` key | `useTabNav()(tab)` |
| `create-task` | "create a task to ship the API", "add a high priority task to..." | Inserts Task row | Shows task card |
| `create-agent` | "spawn an agent under orion for research" | Calls `spawnSubAgent()` | Shows agent card |
| `run-skill` | "run skill summarize on <text>", "use web-search for..." | Executes skill inline (LLM / web functions) + persists SkillRun | Shows skill result |
| `send-comms` | "send message to vega: ...", "broadcast: ..." | Inserts AgentMessage row (uppercased codenames) | Shows message card |
| `health-check` | "health check", "system status" | Direct DB aggregation (no self-fetch) | Renders 3-bar chart |
| `sync-models` | "sync models", "update model list" | try/catch dynamic import `@/lib/model-sync` | — |
| `query-fleet` | "fleet status", "how are agents doing?" | Aggregates by status + top-loaded | Renders 4-bar chart |
| `query-revenue` | "revenue today", "how much money" | Sums confirmed payments | Renders 3-bar chart |
| `query-tasks` | "what's pending?", "blocked tasks" | Groups by status + priority + blocked | Renders 4-bar chart |
| `set-theme` | "dark mode", "light mode", "switch theme" | Returns action payload | `document.documentElement.classList` + `localStorage('jarvis-theme')` |
| `search` | "search for orion", "find vega" | Returns action payload | Dispatches `orion:search` window event |
| `help` | "help", "what can you do?" | Returns catalog text | Opens HelpPanel |
| `chat` (fallback) | anything else | Calls `chat()` from `@/lib/llm` | Renders text response |

## API Shape

**POST `/api/orion/command`**
- Request: `{ text: string, sessionId?: string }`
- Response: `{ intent, response, latencyMs, sessionId, confidence?, tab?, action?, params?, suggestions?, graph?, task?, agent?, message?, skillResult?, summary?, report?, error? }`
- HTTP 200 on success (even when an intent action throws — caught + reported via `error` field)
- HTTP 400 on empty text
- All handlers wrapped in try/catch — single failure does not crash the endpoint

## OrionShell UI Enhancements (all 14 spec items)

1. ✅ **Command palette overlay** — `filterPalette(typed2)` dropdown above input, Arrow↑↓ + Enter + Tab autocomplete. 20 palette entries across all intents.
2. ✅ **Contextual follow-up suggestions** — `suggestions` from API response rendered as amber chips below the response card (max 4). Clicking re-sends as a command.
3. ✅ **Action visualizer** — success/error card with green/red border, intent label, title, details, and expandable `<details>` payload viewer.
4. ✅ **"What can I say?" help panel** — full-screen modal with all 14 intents from `INTENT_CATALOG`, each with icon + label + 4-5 example phrases. Click an example to run it.
5. ✅ **Proactive prompts** — rotates through `PROACTIVE_PROMPTS` every 5s when idle > 30s. Shown in amber below the orb.
6. ✅ **Multi-turn context chip** — `detectContext(text)` returns "fleet discussion", "revenue discussion", etc. Rendered as a violet pill in the header.
7. ✅ **Enhanced orb — 6 states** — idle/listening/processing/speaking + **success** (green pulse + CheckCircle2 icon, 1.8s) + **error** (red shake x: [-4,4,-3,3,0] + AlertCircle icon, 2.4s).
8. ✅ **Mini-graph for structured responses** — API returns `graph[]` for fleet/health/revenue/tasks → rendered via existing Recharts BarChart (preserved from old shell).
9. ✅ **Keyboard shortcuts overlay** — press `?` to open. Lists 10 shortcuts (Ctrl+Shift+O, Esc, ?, Ctrl+K, arrows, Enter, Tab, Space, M, L). Esc closes.
10. ✅ **Wire navigation** — `navigate` intent → `useTabNav()(tab)` actually switches the active tab.
11. ✅ **Wire action execution** — POST `/api/orion/command` → action visualizer card → speak response via TTS.
12. ✅ **Persist history to localStorage** — `jarvis-orion-history` key, last 50 commands. Restored on mount. UI shows last 12.
13. ✅ **Command log toggle** — Terminal-style log view (button in header). Each entry: timestamp, intent, ✓/✗, prompt, response preview, latency. Toggle between history/log views in the right rail.
14. ✅ **Enhanced quick command chips (8)** — Fleet Status, Revenue Today, Pending Tasks, Health Check, Sync Models, Create Task…, Open Fleet Tab, Help. Each has icon + color hover.

## Retained Voice Features

- ✅ Wake-word detection ("orion"/"aria")
- ✅ Continuous listening mode toggle
- ✅ Push-to-talk (one-shot 8s window)
- ✅ TTS via `speechSynthesis` (prefers en-US female voices)
- ✅ Animated orb (now 6 states, was 4)
- ✅ Mini live metrics (CPU/MEM/LAT) in header
- ✅ Mute toggle (persisted to `jarvis-orion-muted`)
- ✅ Web Speech API unsupported fallback (all intents still work via text input)
- ✅ Interim transcript display
- ✅ Wake-word-required toggle (Switch component)

## Smoke Tests (all HTTP 200)

- `help` → 1ms, returns full 14-intent catalog text
- `fleet status` → 6ms, returns 66 agents summary + 4-bar graph
- `open tasks` → 2ms, returns `tab:"tasks"` for client nav
- `health check` → 7ms, returns OPERATIONAL + 96% providers + 3-bar graph
- `what is pending?` → 6ms, returns 17 tasks summary + 4-bar graph
- `revenue today` → 38ms, returns ₹10,998 today + ₹38,290 all-time + 3-bar graph
- `dark mode` / `light mode` → 1ms, returns theme action
- `search for orion` → 1ms, returns search action
- `create a high priority task to review the API` → 3ms, **Task created in DB** (title="review the api", priority="high", tags=["orion","voice"])
- `send message to vega: deploy now` → 2ms, **AgentMessage inserted** (toAgent="VEGA", fromAgent="ORION", subject="deploy now")
- `broadcast: standup in 5` → 2ms, **Broadcast inserted** (toAgent="BROADCAST")
- `spawn an agent under orion for research` → 13ms, **SpawnedAgent created** (codename="ORIO-RESE-3108", role="research")
- `run skill summarize on the quick brown fox...` → 1150ms, **SkillRun persisted**, summary returned
- `summarize today` (chat fallback) → 3398ms, LLM responded with fleet summary
- `sync models` → 38ms, gracefully handled when `@/lib/model-sync` exists but has its own bug (caught + reported)

## Lint Status

`bun run lint` → **clean (0 errors, 0 warnings)** across all 3 files.

## Dev Server

Healthy — all routes return 200, no compile errors. The dev server had a transient Turbopack "Persisting failed" / ENOENT manifest issue mid-test (caused by concurrent file edits from multiple parallel agents) but self-recovered after restart.

## Design Decisions

1. **No self-fetch** — `health-check` queries the DB directly instead of fetching `/api/health` to avoid an HTTP loop and keep latency <10ms.
2. **In-process skill execution** — `run-skill` mirrors `/api/skills/run` logic inline (same ZAI client + same prompts) to avoid a self-fetch and to share the latency budget.
3. **Optional imports wrapped in try/catch** — `@/lib/model-sync` is dynamically imported with `.catch(() => null)` so the endpoint boots even if that lib is mid-flight in another agent's branch.
4. **Optimistic local parse** — `sendCommand` calls `parseIntent()` client-side first for instant ack (the orb can flash before the API responds). The full response from `/api/orion/command` is the source of truth.
5. **Codename normalization** — `parentCodename` and `toAgent` are uppercased before DB lookup/insert because the seeded roster uses uppercase codenames (ORION, VEGA, ATLAS, …) but users speak them lowercase.
6. **localStorage persistence** — history (50) and log (100) are persisted on every command and restored on mount. Clear button wipes both state + localStorage.
7. **6 orb states** — added `success` (green pulse + CheckCircle2, 1.8s flash) and `error` (red x-shake + AlertCircle, 2.4s flash). Both auto-revert to idle/listening via `successTimerRef`.
8. **Multi-turn context chip** — `detectContext()` is keyword-based (fleet/revenue/task/health/model/comms). Sets the chip on every command and persists for the session.
9. **Command palette behavior** — fully-formed prompts (e.g. "Fleet status") send immediately on click; partial prompts (ending in space, e.g. "Create a task to ") fill the input for editing. Arrow keys cycle, Tab autocompletes, Enter sends.
