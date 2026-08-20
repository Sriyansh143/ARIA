# ARIA Mission Control — Safety Controls Matrix

> **The 12-layer defense-in-depth matrix.** Every control, what it does, where
> it's enforced, and how it was verified.

**Version:** v61.2-bugfixed · **Last Updated:** 2026-08-17

---

## Matrix

| # | Control | What it blocks | Enforced at (file:line) | Verified by |
|---|---|---|---|---|
| 1 | **AutonomyTag enum** | Unauthorized auto-execution of HUMAN_LED/HUMAN_ASSISTED workflows | `conductor/router.ts:95-122` (workflows) + `:140-157` (skills); called at `workflow-engine.ts:340` + `hermes/skills.ts:93,156` | `tests/conductor-router.test.ts` (25 tests) |
| 2 | **Kill Switch** | All autonomous actions when paused | `autonomy-control.ts:49`; wired in `cron-scheduler.ts:909-911` + `workflow-engine.ts:300-312` | Manual: `POST /api/autonomy/pause` |
| 3 | **Zero-Assumption Guard** | Execution with missing required context | `zero-assumption-guard.ts:41-96`; invoked at `workflow-engine.ts:607-644` | Manual: trigger a tool_call with missing params |
| 4 | **Production Gate** | TODO/FIXME/DRAFT/secret-laden outputs | `production-gate.ts:37-107`; invoked at `step-debate.ts:101,166,169` + `workflow-engine.ts:588,591,606-627` | `tests/production-gate.test.ts` (16 tests) |
| 5 | **Agent Blackboard** | Two agents claiming the same resource | `agent-blackboard.ts:54-179`; invoked at `dispatcher.ts:97-140` + `outreach-executor.ts:283-328` | `tests/agent-blackboard.test.ts` (7 tests) |
| 6 | **Payment Isolation** | Auto-decision on spend; `/approve` on payments; <60s cooldown | `approval-decision.ts:344-351` + `telegram-bot.ts:335-355,527-619` | Manual: trigger a spend approval |
| 7 | **Business Hours** | Customer outreach outside 9-18 recipient tz | `business-hours.ts:29-54` + `outreach-executor.ts:213-240` | Manual: trigger outreach at night |
| 8 | **Quality Supervisor** | Shipping code that fails execution validation | `quality-supervisor.ts:37,133-240,378-428`; invoked at `services/builder.ts:420` | `tests/conductor-router.test.ts` (trajectory tests) |
| 9 | **Council Pattern** | Solo decisions on high-complexity tasks | `council.ts:76-99,114-163`; invoked at `router.ts:69-90` | Manual: dispatch a >6-step workflow |
| 10 | **Step-Debate** | Blind jumps (no prior-step injection) | `step-debate.ts:113-134,79-84`; invoked at `workflow-engine.ts:544-563` | Manual: dispatch a high-complexity step |
| 11 | **2-Hour Deferral & Pivot** | Fleet stalling on blocked approvals | `cron-scheduler.ts:566-627` + `simulation/engine.ts:441-470` + `dispatcher.ts:329` | Manual: leave an approval pending >2h |
| 12 | **Rules-Auditor** | Repeating the same failure (no learning) | `cron-scheduler.ts:633-755` + `execution-trace.ts:80-121` | Manual: trigger 2+ failures on the same skill |

---

## Defense-in-Depth Flow

```
Incoming task
    │
    ▼
[1] AutonomyTag gate ─── HUMAN_LED? → REFUSE
    │                        HUMAN_ASSISTED? → Telegram approval queue
    │                        FULLY_AUTONOMOUS? → proceed
    ▼
[2] Kill Switch ──── paused? → HALT
    ▼
[9] Council (if high complexity) ── convene 3-4 agents → brief
    ▼
[3] Zero-Assumption Guard ── missing context? → HALT + /answer
    ▼
[10] Step-Debate ── Proposer → Critic → Refiner
    ▼
[4] Production Gate ── TODO/FIXME/secrets? → 3× retry → NEEDS_CONTEXT HALT
    ▼
[5] Agent Blackboard ── resource claimed? → BLOCK + PIVOT
    ▼
[8] Quality Supervisor ── execution fails? → MAX_RETRIES=2 → escalate
    ▼
Output committed
    │
    ▼
[7] Business Hours ── outside 9-18? → DEFER to next 9 AM
    ▼
[6] Payment Isolation ── spend? → /pay-approve only, 60s cooldown
    ▼
[11] 2-Hour Deferral ── stalled >2h? → mark deferred + PIVOT
    ▼
[12] Rules-Auditor ── failed traces? → propose code change (HUMAN_ASSISTED)
```

---

## Bypass Paths (known gaps, documented)

1. **Pattern-only skills** (no DB row) bypass the AutonomyTag router
   (`hermes/skills.ts:151-165`). Mitigation: seed all skills to the DB via
   `skill-loader.ts` on boot.
2. **Fail-open on DB error** — Kill Switch (`cron-scheduler.ts:913`,
   `workflow-engine.ts:314`) + AutonomyTag router (`workflow-engine.ts:371-380`)
   swallow errors and proceed. Mitigation: ensure DB is highly available.
3. **Council brief not consumed** — `conveneCouncil()` runs fire-and-forget;
   the brief is logged but not injected into execution. Mitigation: future
   hardening to `await` + inject `brief.conductorSynthesis`.

---

*End of Safety Controls Matrix.*
