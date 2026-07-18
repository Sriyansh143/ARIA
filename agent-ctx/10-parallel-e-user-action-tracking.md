# Task ID 10 — PARALLEL-E — User Action Tracking + Agent Monitoring

**Agent:** parallel-E User Action Tracking
**Scope:** Add USER action tracking (operator clicks/navigations/errors) + a server-side AGENT monitoring layer that watches every tab for bugs/perf issues/UX friction and surfaces findings as actionable items linked to tasks.

## Files Created (12 NEW)
- `src/lib/action-tracker.ts` — client-side fire-and-forget tracker + `useActionTracker()` hook + `useAutoTrackNavigations()` + `installGlobalTrackers()` (`window.__track*`).
- `src/lib/agent-monitors.ts` — 8 monitor agents registry (`fleet-watchdog`, `api-sentinel`, `health-monitor`, `task-watcher`, `comm-watcher`, `cron-monitor`, `payment-monitor`, `model-watchdog`) + `runMonitor()` / `runAllMonitors()` with 24h dedupe.
- `src/app/api/user-actions/route.ts` — GET (list with filters) + POST (create).
- `src/app/api/user-actions/stats/route.ts` — GET last-24h aggregated stats (by type/tab/severity + top 5 tabs).
- `src/app/api/agent-monitors/route.ts` — GET (registry + open counts + last-run) + POST (run all).
- `src/app/api/agent-monitors/[key]/route.ts` — POST (run single monitor by key).
- `src/app/api/agent-monitors/findings/route.ts` — GET (list with filters status/severity/tab/monitorKey).
- `src/app/api/agent-monitors/findings/[id]/route.ts` — PATCH (update status: acknowledged/resolved/dismissed + optional auto-create-task).
- `src/app/api/agent-monitors/findings/[id]/create-task/route.ts` — POST (create a Task from a finding, link finding.linkedTaskId, set status=acknowledged, emit notification).
- `src/components/jarvis/ActionTrackerProvider.tsx` — wraps the app; installs `window.__track*`, subscribes to nav store for navigation tracking, listens to window error + unhandledrejection.
- `src/components/tabs/AgentMonitorTab.tsx` — full tab UI (header + monitor registry grid + high-priority findings + filterable table + user activity stats). Polls every 15s.

## Files Modified (4 SURGICAL ADDITIVE)
- `prisma/schema.prisma` — appended `UserAction` + `AgentMonitorFinding` models.
- `src/app/layout.tsx` — added ActionTrackerProvider import + wrapped `{children}`.
- `src/app/page-client.tsx` — added import + `| 'agent-monitor'` to TabKey + TABS entry (Operations group, icon `ShieldCheck`, accent `JARVIS.colors.red`) + TAB_MAP entry.
- `src/lib/cron-dispatcher.ts` — added `'agent-monitors'` dispatcher case (calls `runAllMonitors()`, emits notification if findings created).
- `scripts/seed-cron.ts` — added `EXTRA_CRON_ROSTER` array + ensures `agent-monitors` + `model-sync` jobs are upserted into DB on every seed run.

## Prisma Schema Changes
- `UserAction`: id, sessionId, actor, type (navigate|click|submit|toggle|create|delete|error|search|command), tab?, target?, label?, meta (JSON), severity (info|warn|error|critical), duration?, createdAt. Indexes on [createdAt], [tab], [type], [severity].
- `AgentMonitorFinding`: id, monitorKey, tab, severity, category (bug|performance|ux|security|opportunity|error-rate), title, detail, evidence (JSON), suggestedAction?, actionTab?, actionMeta (JSON), status (open|acknowledged|resolved|dismissed), linkedTaskId?, createdAt, updatedAt. Indexes on [monitorKey], [tab], [severity], [status].

## API Shapes
- `GET /api/user-actions?type=&tab=&severity=&limit=` → `{ actions: UserAction[], total, count, filters }`
- `POST /api/user-actions` body `{ type, target?, label?, tab?, meta?, severity?, duration?, actor?, sessionId? }` → `{ ok, id, createdAt }` (201) or `{ ok:false, error }` (400)
- `GET /api/user-actions/stats` → `{ window, total, errorCount, errorRate, byType, byTab, bySeverity, topTabs[], sampledAt }`
- `GET /api/agent-monitors` → `{ monitors: [{key,name,description,intervalMs,lastRun,openFindings}], summary: {totalMonitors, totalOpenFindings, criticalOpen, errorOpen}, sampledAt }`
- `POST /api/agent-monitors` → `{ ok, ranAt, results: MonitorRunResult[], summary }`
- `POST /api/agent-monitors/[key]` → `MonitorRunResult { key, ok, ranAt, durationMs, findingsCreated, findingsDeduped, error? }`
- `GET /api/agent-monitors/findings?status=&severity=&tab=&monitorKey=&limit=` → `{ findings: Finding[], total, count, filters }`
- `PATCH /api/agent-monitors/findings/[id]` body `{ status, createTask? }` → `{ ok, finding, createdTaskId? }`
- `POST /api/agent-monitors/findings/[id]/create-task` → `{ ok, task, findingId, message }` (201)

## Smoke Tests (all passed)
- `GET /api/agent-monitors` → 200, 8 monitors listed, summary correct.
- `POST /api/agent-monitors` (Run All) → 200, ran 8 monitors, 0 new / 3 deduped on first run; 1 new / 2 deduped on cron-triggered run.
- `POST /api/agent-monitors/fleet-watchdog` → 200, single monitor ran.
- `POST /api/agent-monitors/nonexistent` → 404, error handled gracefully.
- `GET /api/agent-monitors/findings` → 200, returned real findings: api-sentinel flagged 33% error rate (critical), payment-monitor flagged 2 stale pending payments ₹19,998, cron-monitor flagged 20 stale cron jobs.
- `PATCH /api/agent-monitors/findings/[id] {status:"acknowledged"}` → 200, status updated.
- `POST /api/agent-monitors/findings/[id]/create-task` → 201, Task created with priority=critical (mapped from finding severity), finding linked, notification emitted.
- `GET /api/user-actions?type=error&limit=2` → 200, returned 2 error events (including a real `AgentMonitorTab is not defined` ReferenceError captured by the error listener before the file existed — proving the error tracker works end-to-end).
- `GET /api/user-actions/stats` → 200, returned aggregated counts (8 total actions, 3 errors, 37.5% error rate, top 5 tabs).
- `POST /api/user-actions` (invalid type) → 400, validation rejects unknown types.
- `POST /api/cron/[id]/run` for `agent-monitors` cron job → 200, dispatcher invoked `runAllMonitors()`, returned `{ok:true, detail:"Ran 8 monitors: 1 new findings, 2 deduped, 0 failed", recordsAffected:1}`.
- `bun run lint` → 0 errors, 0 warnings.

## Notable Behaviour
- ActionTrackerProvider auto-tracked the very first user navigation events (to fleet, fleet-topology, overview, spawned, workforce) AND caught a real `ReferenceError` that occurred before AgentMonitorTab.tsx was created — proving the tracker + error listener work end-to-end without any manual calls.
- All monitor findings are based on REAL database state — no hardcoded sample data.
- Findings auto-dedupe within 24h if a finding with the same (monitorKey, title) is still open, preventing spam.
- `window.__track`, `window.__trackNav`, `window.__trackErr` are now available globally for ad-hoc tracking from anywhere (including the DevTools console).
- The cron job `agent-monitors` (schedule `*/10 * * * *`) will run the sweep automatically every 10 min and emit a notification if any new findings are created.

## Pending Works
- None from this task scope. All 8 file-scope items completed.
