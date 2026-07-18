# PENDING_TASKS.md — Living log of all pending works

> **Rule**: This file MUST be updated every run. Agents check this file at the start of each session to know what to work on. Completed items are marked ✅ and kept for history. New items are added at the bottom.

> **Last updated**: 2026-07-18 (Session: Autonomous Pipeline + Documentation)

---

## ✅ Completed (Recent)

1. ✅ ~~WebSocket mini-service for real-time updates~~ — Done (port 3003).
2. ✅ ~~Wire skill execution to invoke web-search/web-reader~~ — Done.
3. ✅ ~~PDF export for reports~~ — Done (print-friendly HTML).
4. ✅ ~~Drag-and-drop task reordering within Kanban~~ — Done (sortOrder field).
5. ✅ ~~Notification click-to-navigate from desktop~~ — Done.
6. ✅ ~~Agent comparison export (JSON/CSV)~~ — Done.
7. ✅ ~~Tab consolidation (41→25 tabs)~~ — Done (11 merged tab wrappers).
8. ✅ ~~Email reports stub~~ — Done.
9. ✅ ~~Input validation on 12 API routes~~ — Done.
10. ✅ ~~global-error.tsx root boundary~~ — Done.
11. ✅ ~~Audit log + backup rotate + cron history~~ — Done (ported from jarvis zip).
12. ✅ ~~Orion as default shell on app open~~ — Done.
13. ✅ ~~Tab pinning/hiding from command palette~~ — Done.
14. ✅ ~~Notifications settings (sound/desktop/mute-by-type)~~ — Done.
15. ✅ ~~Sound alerts (Web Audio API)~~ — Done.
16. ✅ ~~Desktop notifications (Notification API)~~ — Done.
17. ✅ ~~Notification grouping/batching~~ — Done (2s debounce).
18. ✅ ~~Agent comparison radar chart~~ — Done.
19. ✅ ~~Agent comparison timeline chart~~ — Done (14-day, 4 metrics).
20. ✅ ~~Enhanced EmptyState component~~ — Done.
21. ✅ ~~Keyboard shortcuts overlay~~ — Done (press ?).
22. ✅ ~~Bulk task operations~~ — Done (5 actions, checkbox selection).
23. ✅ ~~Agent configuration templates~~ — Done (10 presets, 6 categories).
24. ✅ ~~Teach duplicate removed~~ — Done.
25. ✅ ~~Chat wired to smart router~~ — Done (23 intents).
26. ✅ ~~Orion hands-free + undo + command logging~~ — Done.
27. ✅ ~~Context-aware system prompt~~ — Done (live fleet/memory/skills/rules).
28. ✅ ~~Auto-save code files~~ — Done ([FILE:] marker → writeSandboxed).
29. ✅ ~~Chat delete actually deletes~~ — Done (DELETE /api/chat).
30. ✅ ~~OS execution (shell commands)~~ — Done (os-executor.ts, block-list).
31. ✅ ~~File operations (read/write/edit/list/delete)~~ — Done (fs-sandbox.ts).
32. ✅ ~~Browser automation~~ — Done (/api/browser/action via agent-browser).
33. ✅ ~~CRM & Business (clients/leads/support)~~ — Done (3 models, 6 APIs, CRMTab).
34. ✅ ~~CEO agent (tab monitoring + task generation)~~ — Done (ceoSweep every 30 min).
35. ✅ ~~Earning method research pipeline~~ — Done (idea→research→12-step→lead-gen).
36. ✅ ~~Approval system~~ — Done (/api/approvals, Telegram-compatible).
37. ✅ ~~Task decomposition (make-plan)~~ — Done (LLM decompose + auto-create tasks).
38. ✅ ~~App documentation~~ — Done (APP_DOCUMENTATION.md, 3,557 lines).
39. ✅ ~~Rules 15-18~~ — Done (never build from scratch, CEO autonomous, Telegram, system access).
40. ✅ ~~Live activity ticker~~ — Done (scrolling marquee in header).
41. ✅ ~~Global search (9 entity types)~~ — Done.
42. ✅ ~~Command palette (recent/frequent/pin/hide)~~ — Done.
43. ✅ ~~Enhanced notifications panel~~ — Done (filter chips, timestamps, mark-read/unread).
44. ✅ ~~Light theme polish~~ — Done.

---

## 🔴 Pending (High Priority)

### Execution Layer
1. **Terminal tab** — Interactive shell (xterm.js) with allow-list enforcement. Currently commands run via chat only, no visual terminal.
2. **Files/IDE tab** — Monaco editor for viewing/editing project files with syntax highlighting. Currently file ops are API-only.
3. **Browser tab** — Live screenshot view + step log for browser automation actions.

### Planning Layer
4. **Plan + PlanStep Prisma models** — Formal plan table with steps, dependencies, checkpoints, verification.
5. **Plan executor mini-service** (port 3005) — Polls pending steps, respects dependencies, retries with backoff.
6. **Plan pause/resume** — Persist in-progress state to DB, resume across server restarts.
7. **Verification gate** — After plan execution, LLM verifies if the goal was achieved.

### Multi-Agent Discussion
8. **Multi-agent discussion system** — Multiple agents monitor tabs, discuss findings, vote on actions, then implement.
9. **Agent-to-agent delegation** — CEO → C-Suite → specialist hierarchy with structured reports.
10. **Consensus mechanism** — Agents propose actions, discuss, reach consensus before executing.

### Communication Layer
11. **Telegram bot webhook** — External command intake + approval buttons.
12. **Telegram mini-service** (port 3004) — Long-polling bridge for Telegram bot.
13. **Email egress** — SMTP wiring for sending emails to clients.
14. **Phone calling** — VoIP integration for client calls (Twilio/alternative).

### Context Layer
15. **Embedding-based memory retrieval** — Use z-ai SDK embeddings for similarity search in memory.
16. **Token-budget-aware truncation** — Smart context window management.
17. **Per-agent memory store** — Each agent has its own memory + context.

### Business Layer
18. **Lead generation automation** — Agents search for leads, create Lead records, score them, assign follow-up tasks.
19. **Marketing automation** — Social media posting, content generation, SEO optimization.
20. **Client outreach automation** — Email sequences, proposal generation, negotiation support.
21. **Revenue tracking** — Payment attribution to agents, earning reports.

### System Layer
22. **Action Bus** — Unified handler registry that all entry points (chat, Orion, cron, CEO, Telegram) call into.
23. **File watcher** — Monitor workspace for changes, notify agents.
24. **System scanner** — With owner permission, log all files/folders on the laptop.
25. **Rollback system wiring** — Auto-snapshot before destructive ops, rollback on failure.

### Models/Routes/Skills
26. **55 more Prisma models** — RBAC, tenant, compliance, eval, AgentInstance, etc. (have 37, target 89).
27. **130+ more API routes** — Mostly mini-service routes (have 124+, target 240+).
28. **58+ more skills** — Port from skills/ directory (have 20 in DB, 65 available).

---

## 📊 Stats
- **Orion intents**: 23
- **Tabs**: 26
- **API routes**: 124+
- **Cron jobs**: 30
- **Prisma models**: 37
- **Agents**: 68
- **Skills**: 20 (in DB)
- **Providers**: 23
- **Models**: 453
- **Rules**: 18
- **Documentation**: 3,557 lines (APP_DOCUMENTATION.md)
