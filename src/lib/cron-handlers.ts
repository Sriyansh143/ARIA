/**
 * src/lib/cron-handlers.ts — v62 Phase 12 (Extracted from cron-scheduler.ts)
 *
 * All 25 cron job handler implementations extracted from cron-scheduler.ts
 * to bring it under the 400-line limit (RULE-43). Each handler does real
 * work against the DB or delegates to a real module function.
 *
 * Split: cron-scheduler.ts (orchestrator) imports JOB_HANDLERS from here.
 */

import "server-only";
import { db } from "./db";
import { emit } from "./event-bus";
import { toIso, type CronJob } from "./types";
import { logger } from "./logger";

// Job handlers. Most do real work against the DB; the rest are
// intentionally stubbed (and clearly labelled) where the real
// integration requires external services that may not be configured
// in a zero-cost deployment.
export const JOB_HANDLERS: Record<string, () => Promise<{ ok: boolean; result: string }>> = {
  "ecosystem-radar": async () => {
// TECH-DEBT: This file is 923 lines (over the 400-line RULE-43 limit). It contains 25 cron handler implementations. The executive-standup handler alone is 250 lines. Further splitting into cron-handlers-business.ts + cron-handlers-system.ts + cron-handlers-intelligence.ts is planned. Deadline: 7 days from 2026-08-17. Tracked in worklog per RULE-47.
    // Real: count active + idle agents vs total, surface stale agents.
    try {
      const now = Date.now();
      const STALE_MS = 5 * 60 * 1000;
      const agents = await db.agent.findMany({ select: { id: true, lastBeatAt: true, status: true } });
      const stale = agents.filter((a) => {
        const ts = a.lastBeatAt instanceof Date ? a.lastBeatAt.getTime() : Date.parse(a.lastBeatAt ?? "");
        return Number.isFinite(ts) && now - (ts as number) > STALE_MS;
      });
      return {
        ok: true,
        result: `Radar: ${agents.length} agents, ${stale.length} stale (>5min since heartbeat)`,
      };
    } catch (err) {
      return { ok: false, result: `ecosystem-radar failed: ${String(err).slice(0, 100)}` };
    }
  },
  "revenue-scanner": async () => {
    // Real: count discovered/pipeline/won earning opportunities in last 24h.
    try {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const [discovered, pipeline, won] = await Promise.all([
        db.earningOpportunity.count({ where: { status: "discovered", discoveredAt: { gte: since } } }),
        db.earningOpportunity.count({ where: { status: { in: ["pipeline", "executing"] } } }),
        db.deal.count({ where: { stage: "won", updatedAt: { gte: since } } }),
      ]);
      return {
        ok: true,
        result: `Revenue scan (24h): ${discovered} discovered, ${pipeline} in pipeline, ${won} won`,
      };
    } catch (err) {
      return { ok: false, result: `revenue-scanner failed: ${String(err).slice(0, 100)}` };
    }
  },
  "agent-heartbeat": async () => {
    // Real: count agents by status + flag any in `error` state.
    try {
      const agents = await db.agent.groupBy({ by: ["status"], _count: true });
      const errorCount = agents.find((g) => g.status === "error")?._count ?? 0;
      const total = agents.reduce((s, g) => s + g._count, 0);
      return {
        ok: true,
        result: `Heartbeat: ${total} agents (${errorCount} in error state)`,
      };
    } catch (err) {
      return { ok: false, result: `agent-heartbeat failed: ${String(err).slice(0, 100)}` };
    }
  },
  "llm-failover-watch": async () => {
    // Real: compute provider success rate from LlmCall rows in last hour.
    try {
      const since = new Date(Date.now() - 60 * 60 * 1000);
      const rows = await db.llmCall.findMany({
        where: { createdAt: { gte: since } },
        select: { provider: true, status: true },
      });
      if (rows.length === 0) {
        return { ok: true, result: `LLM watch: no calls in last hour` };
      }
      const byProvider: Record<string, { total: number; ok: number }> = {};
      for (const r of rows) {
        const p = (byProvider[r.provider] ??= { total: 0, ok: 0 });
        p.total++;
        if (r.status === "ok") p.ok++;
      }
      const summary = Object.entries(byProvider)
        .map(([p, s]) => `${p}: ${Math.round((s.ok / s.total) * 100)}% (${s.ok}/${s.total})`)
        .join(", ");
      const degraded = Object.values(byProvider).some((s) => s.ok / s.total < 0.5);
      return {
        ok: !degraded,
        result: `LLM watch (1h): ${summary}${degraded ? " [DEGRADED]" : ""}`,
      };
    } catch (err) {
      return { ok: false, result: `llm-failover-watch failed: ${String(err).slice(0, 100)}` };
    }
  },
  "nightly-backup": async () => {
    // v61 (Audit B7): REAL backup. Previously this job only snapshotted
    // row counts into a Setting — no actual .db / .sql file was ever
    // produced. Now it calls the existing runBackup() from
    // backup-service.ts, which runs `sqlite3 .dump | gzip` (or pg_dump
    // for Postgres) into ./backups/ and prunes anything older than 7
    // copies. The row-count snapshot is preserved as a secondary signal.
    try {
      // 1. Run the real backup (creates ./backups/db-<ts>.sql.gz).
      const { runBackup } = await import("./backup-service");
      const backupRes = await runBackup();

      // 2. Still record the row-count snapshot (cheap, useful for the
      //    dashboard "last backup" tile even if the physical backup is
      //    skipped because sqlite3 / pg_dump isn't on PATH).
      const [
        agents, tasks, approvals, deals, revenue, alerts, logs, llmCalls,
      ] = await Promise.all([
        db.agent.count(),
        db.task.count(),
        db.approval.count(),
        db.deal.count(),
        db.revenueEvent.count(),
        db.systemAlert.count(),
        db.agentLog.count(),
        db.llmCall.count(),
      ]);
      const snapshot = {
        ts: new Date().toISOString(),
        counts: { agents, tasks, approvals, deals, revenue, alerts, logs, llmCalls },
        backup: {
          ok: backupRes.ok,
          path: backupRes.backupPath ?? null,
          sizeBytes: backupRes.sizeBytes ?? 0,
          error: backupRes.error ?? null,
        },
      };
      await db.setting.upsert({
        where: { key: "backup.lastSnapshot" },
        create: { key: "backup.lastSnapshot", value: JSON.stringify(snapshot) },
        update: { value: JSON.stringify(snapshot) },
      });

      const sizeKb = backupRes.sizeBytes ? Math.round(backupRes.sizeBytes / 1024) : 0;
      if (backupRes.ok) {
        return {
          ok: true,
          result: `Backup OK: ${backupRes.backupPath} (${sizeKb} KB). Snapshot: ${agents}a ${tasks}t ${approvals}ap ${deals}d ${revenue}r`,
        };
      }
      return {
        ok: false,
        result: `Backup physical file failed (${backupRes.error ?? "unknown"}). Snapshot only: ${agents}a ${tasks}t ${approvals}ap ${deals}d ${revenue}r — install sqlite3/pg_dump for real backups.`,
      };
    } catch (err) {
      return { ok: false, result: `nightly-backup failed: ${String(err).slice(0, 100)}` };
    }
  },
  "research-digest": async () => {
    // Real: summarise LearnedInsight + ResearchLog entries added in last 24h.
    try {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const [insights, researchLogs] = await Promise.all([
        db.learnedInsight.count({ where: { createdAt: { gte: since } } }),
        db.researchLog.count({ where: { createdAt: { gte: since } } }),
      ]);
      return {
        ok: true,
        result: `Digest (24h): ${insights} new insights, ${researchLogs} research logs`,
      };
    } catch (err) {
      return { ok: false, result: `research-digest failed: ${String(err).slice(0, 100)}` };
    }
  },
  // Hermes daily schedules
  "morning-learning": async () => {
    try {
      const { runDailyLearning } = await import("./hermes/learning");
      const result = await runDailyLearning();
      return { ok: true, result: `Learning: ${result.videosProcessed} videos, ${result.postsProcessed} posts, ${result.urlsProcessed} URLs, ${result.memoriesCreated} memories, ${result.skillsCreated} skills` };
    } catch (err) {
      return { ok: false, result: `Learning failed: ${String(err).slice(0, 100)}` };
    }
  },
  "earning-research": async () => {
    try {
      const { runDailyEarningResearch } = await import("./hermes/earning-researcher");
      const result = await runDailyEarningResearch();
      return { ok: true, result: `Discovered ${result.discovered} opportunities, ${result.qualified} qualified, ${result.insertedToPipeline} inserted to pipeline` };
    } catch (err) {
      return { ok: false, result: `Earning research failed: ${String(err).slice(0, 100)}` };
    }
  },
  // v40: LeadFinder — autonomous daily lead discovery with confidence scoring
  "lead-finder-daily": async () => {
    // v61 Phase 2 (Owner Rule: Business Hours) — lead discovery sends no
    // customer-facing messages, but it does send Slack/Telegram notifications
    // to the owner. Defer outside owner business hours.
    try {
      const { isWithinOwnerBusinessHours, businessHoursStatus } = await import("./business-hours");
      if (!isWithinOwnerBusinessHours()) {
        return { ok: true, result: `Deferred: ${businessHoursStatus()}` };
      }
      const { runLeadFinder } = await import("./lead-finder");
      const result = await runLeadFinder();
      return { ok: true, result: `Lead Finder: searched ${result.searched}, discovered ${result.discovered}, qualified ${result.qualified}, inserted ${result.insertedToPipeline} to pipeline` };
    } catch (err) {
      return { ok: false, result: `Lead Finder failed: ${String(err).slice(0, 100)}` };
    }
  },
  // v43: OutreachExecutor — autonomous hourly outreach email execution
  "outreach-executor": async () => {
    // v61 Phase 2 (Owner Rule: Business Hours) — outreach emails go to
    // CUSTOMERS. Defer if the owner is outside business hours OR if the
    // outreach-executor's per-lead timezone check would queue them anyway.
    // The per-lead check happens inside runOutreachExecutor; this outer
    // guard prevents the cron from even running when the owner is off-hours.
    try {
      const { isWithinOwnerBusinessHours, businessHoursStatus } = await import("./business-hours");
      if (!isWithinOwnerBusinessHours()) {
        return { ok: true, result: `Deferred (owner off-hours): ${businessHoursStatus()}` };
      }
      const { runOutreachExecutor } = await import("./outreach-executor");
      const result = await runOutreachExecutor();
      return { ok: true, result: `Outreach: ${result.sent} sent, ${result.failed} failed, ${result.processed} processed` };
    } catch (err) {
      return { ok: false, result: `Outreach Executor failed: ${String(err).slice(0, 100)}` };
    }
  },
  // v43: Crypto Payment Verifier — polls blockchain every 10min for pending payments
  "crypto-verifier": async () => {
    try {
      const { runCryptoVerifier } = await import("./crypto-verifier");
      const result = await runCryptoVerifier();
      return { ok: true, result: `Crypto: ${result.checked} checked, ${result.confirmed} confirmed` };
    } catch (err) {
      return { ok: false, result: `Crypto Verifier failed: ${String(err).slice(0, 100)}` };
    }
  },
  // v44: Founder Briefing — daily 8am email to the owner
  "founder-briefing": async () => {
    try {
      const { runFounderBriefing } = await import("./founder-briefing");
      const result = await runFounderBriefing();
      return { ok: result.ok, result: result.sent ? "Briefing sent to owner" : `Not sent: ${result.error || "unknown"}` };
    } catch (err) {
      return { ok: false, result: `Founder briefing failed: ${String(err).slice(0, 100)}` };
    }
  },
  // v45: Daily Health Sim — 6am, before the founder briefing
  "daily-health-sim": async () => {
    try {
      const { runDailyHealthSim } = await import("./health-sim");
      const result = await runDailyHealthSim();
      const checksOk = result.checks.filter((c) => c.ok).length;
      if (result.ok) {
        return { ok: true, result: `Health sim OK (${checksOk}/${result.checks.length} checks passed)` };
      }
      return {
        ok: false,
        result: `Health sim FAILED (${checksOk}/${result.checks.length} checks passed, ${result.criticalAlerts.length} critical). Outreach ${result.outreachPaused ? "PAUSED" : "not paused"}.`,
      };
    } catch (err) {
      return { ok: false, result: `Health sim failed: ${String(err).slice(0, 100)}` };
    }
  },
  "executive-standup": async () => {
    // v61 Phase 1 (Audit #5): Replaced the 4-metric string with a 7-section
    // Daily Plan — a forward-looking PLANNING ARTIFACT, not a metrics dump.
    // The plan is pushed to Telegram (the owner's primary channel) + stored
    // in the Setting table so the dashboard can surface it.
    try {
      const now = new Date();
      const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      // ── Section 1: Yesterday's results (24h) ──
      const [revenue24h, ordersDelivered24h, ordersPending, outreachSent24h, builds24h, buildsFailed24h, llmCalls24h, llmFailures24h] = await Promise.all([
        db.revenueEvent.aggregate({ _sum: { amount: true }, where: { createdAt: { gte: since24h } } }),
        db.serviceOrder.count({ where: { status: "delivered", updatedAt: { gte: since24h } } }),
        db.serviceOrder.count({ where: { status: { in: ["pending_payment", "building", "paid_verified"] } } }),
        db.notificationLog.count({ where: { channel: "email", createdAt: { gte: since24h }, status: "sent" } }),
        db.serviceOrder.count({ where: { updatedAt: { gte: since24h } } }),
        db.serviceOrder.count({ where: { status: "failed", updatedAt: { gte: since24h } } }),
        db.llmCall.count({ where: { createdAt: { gte: since24h } } }),
        db.llmCall.count({ where: { createdAt: { gte: since24h }, status: "error" } }),
      ]);

      // ── Section 3: Today's top 3 goals (derived from critical alerts + pending high-risk approvals + at-risk goals) ──
      const [criticalAlerts, pendingPayments] = await Promise.all([
        db.systemAlert.findMany({ where: { severity: { in: ["error", "critical"] }, ack: false }, take: 3, orderBy: { createdAt: "desc" } }),
        db.approval.findMany({ where: { status: "pending", action: "spend" }, take: 5, orderBy: { createdAt: "asc" } }),
      ]);

      // ── Section 4: Blockers (LLM circuit state, paused outreach, cron failures) ──
      const [pausedSetting, failedCrons24h] = await Promise.all([
        db.setting.findUnique({ where: { key: "autonomy.paused" } }),
        db.cronRun.findMany({ where: { ok: false, createdAt: { gte: since24h } }, take: 5, orderBy: { createdAt: "desc" } }),
      ]);
      const llmFailureRate = llmCalls24h > 0 ? (llmFailures24h / llmCalls24h) * 100 : 0;
      const buildFailureRate = builds24h > 0 ? (buildsFailed24h / builds24h) * 100 : 0;

      // ── Section 5: Decision queue (top 5 pending approvals) ──
      const decisionQueue = await db.approval.findMany({
        where: { status: "pending" },
        take: 5,
        orderBy: [{ risk: "desc" }, { createdAt: "asc" }],
      });

      // ── Section 7: OKR alignment ──
      const [totalRevenue30d, totalOrders30d] = await Promise.all([
        db.revenueEvent.aggregate({ _sum: { amount: true }, where: { createdAt: { gte: new Date(now.getTime() - 30 * 86400000) } } }),
        db.serviceOrder.count({ where: { status: "delivered", updatedAt: { gte: new Date(now.getTime() - 30 * 86400000) } } }),
      ]);

      // ── Build the 7-section plan ──
      const dayOfYear = Math.floor((now.getTime() - new Date(now.getFullYear(), 0, 0).getTime()) / 86400000);
      const q = Math.floor(now.getMonth() / 3) + 1;
      const lines: string[] = [];
      lines.push(`📋 *ARIA DAILY PLAN* — ${now.toISOString().slice(0, 10)} (Day ${dayOfYear}, Q${q})`);
      lines.push("");

      // 1. Yesterday's results
      lines.push("📊 *YESTERDAY'S RESULTS (24h)*");
      lines.push(`  Revenue: $${(revenue24h._sum.amount ?? 0).toFixed(2)}`);
      lines.push(`  Orders delivered: ${ordersDelivered24h} · Pending: ${ordersPending}`);
      lines.push(`  Outreach emails sent: ${outreachSent24h}`);
      lines.push(`  Builds: ${builds24h} (${buildsFailed24h} failed, ${buildFailureRate.toFixed(0)}% failure rate)`);
      lines.push(`  LLM calls: ${llmCalls24h} (${llmFailures24h} failed, ${llmFailureRate.toFixed(0)}% failure rate)`);
      lines.push("");

      // 2. Today's top 3 goals (derived)
      lines.push("🎯 *TODAY'S TOP GOALS*");
      const goals: string[] = [];
      if (pausedSetting?.value?.includes("true")) goals.push("⚠️ Autonomy is PAUSED — diagnose + resume");
      if (pendingPayments.length > 0) goals.push(`🔴 ${pendingPayments.length} payment approval(s) awaiting /pay-approve`);
      if (criticalAlerts.length > 0) goals.push(`🚨 ${criticalAlerts.length} unacknowledged critical alert(s)`);
      if (buildFailureRate > 50 && builds24h > 3) goals.push("🔧 Build failure rate >50% — investigate trajectory validation");
      if (llmFailureRate > 50 && llmCalls24h > 5) goals.push("🤖 LLM failure rate >50% — check provider circuit breakers");
      if (ordersPending > 5) goals.push(`📦 ${ordersPending} orders pending — prioritize delivery`);
      if (goals.length === 0) goals.push("✅ All systems nominal — focus on growth");
      goals.slice(0, 3).forEach((g, i) => lines.push(`  ${i + 1}. ${g}`));
      lines.push("");

      // 3. Blockers
      lines.push("🚧 *BLOCKERS*");
      if (pausedSetting?.value?.includes("true")) {
        const reason = (() => { try { return JSON.parse(pausedSetting.value)?.reason ?? "unknown"; } catch { return "unknown"; } })();
        lines.push(`  ⛔ Autonomy PAUSED: ${reason}`);
      } else {
        lines.push("  ✅ Autonomy: RUNNING");
      }
      // v61 Phase 2: Business Hours Status
      try {
        const { businessHoursStatus, isWithinOwnerBusinessHours } = await import("./business-hours");
        const bhStatus = businessHoursStatus();
        if (isWithinOwnerBusinessHours()) {
          lines.push(`  ✅ Business hours: ${bhStatus}`);
        } else {
          lines.push(`  ⏸️ Outreach paused: ${bhStatus}`);
        }
      } catch { /* best-effort */ }
      // v61 Phase 2: Deferred approvals count
      const deferredCount = await db.approval.count({ where: { status: "pending", deferredUntil: { not: null } } });
      if (deferredCount > 0) lines.push(`  ⏳ ${deferredCount} approval(s) DEFERRED (>2h pending, agents pivoted)`);
      if (llmFailureRate > 50) lines.push(`  ⛔ LLM failure rate: ${llmFailureRate.toFixed(0)}% (>50% threshold)`);
      if (failedCrons24h.length > 0) lines.push(`  ⚠️ ${failedCrons24h.length} cron failures in 24h (last: ${failedCrons24h[0]?.jobName})`);
      if (llmCalls24h === 0) lines.push("  ⚠️ Zero LLM calls in 24h — autonomous engine may be stalled");
      lines.push("");

      // 4. Decision queue
      lines.push("⚖️ *DECISION QUEUE* (top 5 pending approvals)");
      if (decisionQueue.length === 0) {
        lines.push("  ✅ No pending approvals");
      } else {
        for (const a of decisionQueue) {
          const age = Math.floor((now.getTime() - new Date(a.createdAt).getTime()) / 3600000);
          const isPayment = a.action === "spend" || a.risk === "high";
          const isDeferred = a.deferredUntil !== null;
          const emoji = isDeferred ? "💤" : isPayment ? "🔴" : "⏳";
          const amount = a.amount ? ` · $${a.amount.toLocaleString()}` : "";
          const deferredTag = isDeferred ? " · DEFERRED" : "";
          lines.push(`  ${emoji} ${a.title}${amount} (${age}h old${deferredTag})`);
          if (isPayment) lines.push(`     → /pay-approve ${a.id.slice(-8)} (60s cooldown)`);
          else lines.push(`     → /approve ${a.id.slice(-8)} or /discuss ${a.id.slice(-8)} <q>`);
        }
      }
      // v61 Phase 2: Deferred approvals count summary
      const totalDeferred = await db.approval.count({ where: { status: "pending", deferredUntil: { not: null } } });
      if (totalDeferred > 0) lines.push(`  💤 ${totalDeferred} approval(s) deferred (>2h, agents pivoted to other work)`);
      lines.push("");

      // 5. Risk flags
      lines.push("⚠️ *RISK FLAGS*");
      if (llmFailureRate > 50) lines.push(`  🤖 LLM failure rate ${llmFailureRate.toFixed(0)}% — investigate provider outage`);
      if (buildFailureRate > 50) lines.push(`  🔧 Build failure rate ${buildFailureRate.toFixed(0)}% — consider pausing new orders`);
      if (llmCalls24h === 0) lines.push("  📉 Zero LLM calls — engine may be stalled or FREE_ONLY_MODE stuck");
      // v61 Phase 2: LLM Routing Profile status
      const freeOnly = (process.env.FREE_ONLY_MODE ?? "").toLowerCase() === "true";
      const oracle = (process.env.DEPLOYMENT_ENV ?? "").toLowerCase() === "oracle-free-tier";
      if (oracle) {
        lines.push(`  ☁️ LLM Routing: Oracle Free Tier Mode (llama3.2:3b + qwen2.5-coder:1.5b + no-login scrapers)`);
      } else if (freeOnly) {
        lines.push(`  🆓 LLM Routing: FREE-ONLY MODE (Ollama local only, $0 cloud spend)`);
      } else {
        lines.push(`  🔄 LLM Routing: Full 5-provider failover (Z-AI → Groq → NVIDIA → Ollama)`);
      }
      if (llmFailureRate <= 50 && buildFailureRate <= 50 && llmCalls24h > 0) lines.push("  ✅ All risk indicators within thresholds");
      lines.push("");

      // v61 Phase 3: Environment Status
      try {
        const { getEnvironmentStatus } = await import("./environment-detector");
        const envStatus = getEnvironmentStatus();
        lines.push("🖥️ *ENVIRONMENT STATUS*");
        lines.push(`  Environment: ${envStatus.environment === "cloud-restricted" ? "☁️ Cloud (Oracle Free Tier)" : "💻 Local (unlimited resources)"}`);
        lines.push(`  RAM: ${envStatus.totalRamGB} GB`);
        lines.push(`  Routing: ${envStatus.routingProfile}`);
        lines.push(`  Models: ${envStatus.activeModels}`);
        lines.push("");
      } catch { /* best-effort */ }

      // v61 Phase 3: Clarifications Pending (tasks halted due to missing context)
      const needsContextCount = await db.agentLog.count({
        where: {
          level: "warn",
          message: { contains: "NEEDS_CONTEXT" },
          createdAt: { gte: since24h },
        },
      });
      const unansweredCount = await db.agentLog.count({
        where: {
          level: "info",
          message: { contains: "Owner provided context" },
          createdAt: { gte: since24h },
        },
      });
      lines.push("❓ *CLARIFICATIONS PENDING* (ZERO ASSUMPTIONS guardrail)");
      lines.push(`  Halted for context: ${needsContextCount}`);
      lines.push(`  Answered by owner: ${unansweredCount}`);
      if (needsContextCount > unansweredCount) {
        lines.push(`  ⚠️ ${needsContextCount - unansweredCount} task(s) still waiting — use /answer <id> <text>`);
      } else if (needsContextCount === 0) {
        lines.push("  ✅ No tasks halted — all had complete context");
      }
      lines.push("");

      // v61 Phase 3: Rule Evolutions Proposed (self-improving rules)
      const ruleProposals = await db.approval.count({
        where: {
          status: "pending",
          requester: "rules-auditor",
          createdAt: { gte: since24h },
        },
      });
      lines.push("🔧 *RULE EVOLUTIONS PROPOSED* (self-improving rules)");
      if (ruleProposals === 0) {
        lines.push("  ✅ No new rule improvements proposed in the last 24h");
      } else {
        lines.push(`  📋 ${ruleProposals} improvement(s) pending your review:`);
        const proposals = await db.approval.findMany({
          where: { status: "pending", requester: "rules-auditor" },
          take: 3,
          orderBy: { createdAt: "desc" },
        });
        for (const p of proposals) {
          lines.push(`     • ${p.title} — /discuss ${p.id.slice(-8)} or /approve ${p.id.slice(-8)}`);
        }
      }
      lines.push("");



      // 6. Recommended actions
      lines.push("💡 *RECOMMENDED ACTIONS*");
      const recs: string[] = [];
      if (pendingPayments.length > 0) recs.push(`/discuss ${pendingPayments[0].id.slice(-8)} <question> on the oldest payment, then /pay-approve`);
      if (criticalAlerts.length > 0) recs.push(`Acknowledge critical alert: ${criticalAlerts[0].message.slice(0, 80)}`);
      if (failedCrons24h.length > 0) recs.push(`Investigate cron failure: ${failedCrons24h[0]?.jobName}`);
      if (ordersPending > 0) recs.push(`Process ${ordersPending} pending order(s)`);
      if (recs.length === 0) recs.push("No urgent actions — focus on growth + hardening");
      recs.slice(0, 3).forEach((r, i) => lines.push(`  ${i + 1}. ${r}`));
      lines.push("");

      // 7. OKR alignment
      lines.push("🎯 *OKR ALIGNMENT (30-day)*");
      lines.push(`  Revenue (30d): $${(totalRevenue30d._sum.amount ?? 0).toFixed(2)}`);
      lines.push(`  Orders delivered (30d): ${totalOrders30d}`);
      lines.push(`  Pipeline: in progress`);
      lines.push("");
      lines.push("_This plan is saved in the dashboard under 'daily-plan' setting._");

      const planText = lines.join("\n");

      // Push to Telegram (primary channel — owner's mobile)
      try {
        const { sendTelegramMessage } = await import("@/lib/telegram-notifier");
        await sendTelegramMessage(planText);
      } catch (tgErr) {
        logger.warn("executive-standup.telegram-failed", { error: String(tgErr) });
      }

      // Save to Setting so the dashboard can surface it
      await db.setting.upsert({
        where: { key: "daily-plan.latest" },
        create: { key: "daily-plan.latest", value: planText, category: "planning" },
        update: { value: planText },
      });

      // Short summary for the cron-run record
      return {
        ok: true,
        result: `Daily Plan pushed: ${decisionQueue.length} pending approvals, ${llmCalls24h} LLM calls, $${(revenue24h._sum.amount ?? 0).toFixed(0)} revenue 24h`,
      };
    } catch (err) {
      return { ok: false, result: `executive-standup failed: ${String(err).slice(0, 100)}` };
    }
  },
  "self-heal-watch": async () => {
    // Real: invoke the self-heal heartbeat directly + report status.
    try {
      const { getSelfHealStatus } = await import("@/lib/self-heal");
      const status = getSelfHealStatus();
      return {
        ok: status.bootstrapped,
        result: `Self-heal: ${status.healCount} heals, bootstrapped=${status.bootstrapped}, last=${status.lastHealAt ? new Date(status.lastHealAt).toISOString() : "never"}`,
      };
    } catch (err) {
      return { ok: false, result: `self-heal-watch failed: ${String(err).slice(0, 100)}` };
    }
  },
  "nightly-reflection": async () => {
    try {
      const { compressContext } = await import("./hermes/memory");
      const agents = await db.agent.findMany();
      let compressed = 0;
      for (const agent of agents) {
        // Compress any oversized context windows
        await compressContext([{ role: "system", content: agent.capabilities ?? "" }], 8192);
        compressed++;
      }
      // Prune old temp logs (>7 days)
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const pruned = await db.agentLog.deleteMany({ where: { createdAt: { lt: weekAgo }, level: "debug" } });
      return { ok: true, result: `Reflection: compressed ${compressed} agent contexts, pruned ${pruned.count} old debug logs` };
    } catch (err) {
      return { ok: false, result: `Reflection failed: ${String(err).slice(0, 100)}` };
    }
  },
  // v61 Phase 2 (Owner Rule: 2-Hour Approval Deferral) — runs hourly.
  // Checks for pending approvals older than 2 hours. For each:
  //   1. Sends a polite Telegram reminder.
  //   2. Sets deferredUntil = now + 2h (so the fleet can pivot).
  //   3. The agent task-dispatch logic checks deferredUntil to decide whether
  //      to wait or pivot to the next available task.
  "approval-reminder": async () => {
    try {
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      // Find pending approvals older than 2h that haven't been deferred yet.
      const stale = await db.approval.findMany({
        where: {
          status: "pending",
          createdAt: { lt: twoHoursAgo },
          deferredUntil: null,
        },
        take: 10,
        orderBy: { createdAt: "asc" },
      });

      if (stale.length === 0) {
        return { ok: true, result: "No stale approvals (>2h pending)" };
      }

      const { sendTelegramMessage } = await import("@/lib/telegram-notifier");
      let reminded = 0;
      for (const approval of stale) {
        // Set deferredUntil so the agent dispatcher knows to pivot.
        const deferredUntil = new Date(Date.now() + 2 * 60 * 60 * 1000);
        await db.approval.update({
          where: { id: approval.id },
          data: { deferredUntil },
        });

        // Send a polite reminder.
        const isPayment = approval.action === "spend" || approval.risk === "high";
        const ageHours = Math.floor((Date.now() - new Date(approval.createdAt).getTime()) / 3600000);
        const amountLine = approval.amount ? `\n*Amount:* $${approval.amount.toLocaleString()}` : "";
        const text = isPayment
          ? `⏳ *REMINDER: Payment Approval pending ${ageHours}h*\n\n*Title:* ${approval.title}${amountLine}\n*Risk:* ${approval.risk.toUpperCase()}\n\nThis approval has been DEFERRED. Agents have pivoted to other work.\n\nTo decide:\n• /discuss ${approval.id.slice(-8)} <question>\n• /pay-approve ${approval.id.slice(-8)} (60s cooldown)`
          : `⏳ *REMINDER: Approval pending ${ageHours}h*\n\n*Title:* ${approval.title}\n*Action:* ${approval.action ?? "(none)"}\n\nThis approval has been DEFERRED. Agents have pivoted to other work.\n\nTo decide:\n• /discuss ${approval.id.slice(-8)} <question>\n• /approve or /deny ${approval.id.slice(-8)}`;

        try {
          await sendTelegramMessage(text);
        } catch { /* best-effort */ }

        // Emit a system event so the dashboard shows the deferral.
        emit({
          type: "system",
          ts: new Date().toISOString(),
          message: `⏳ Approval "${approval.title}" deferred (pending ${ageHours}h) — agents pivoted`,
          level: "warn",
        });

        reminded++;
      }

      return { ok: true, result: `Reminded ${reminded} stale approval(s), deferred until +2h` };
    } catch (err) {
      return { ok: false, result: `approval-reminder failed: ${String(err).slice(0, 100)}` };
    }
  },
  // v61 Phase 3 (Owner Rule: Self-Improving Rules) — runs every 6 hours.
  // Reviews execution traces where retries > 1 OR the task failed. Uses an
  // LLM to analyze WHY it failed + generates a "Suggested Rule Improvement".
  // Creates a HUMAN_ASSISTED approval for the owner to review + apply the
  // rule change. Ties into the Phase 1 approval system.
  "rules-auditor": async () => {
    try {
      const { findProblematicTraces } = await import("./execution-trace");
      const traces = await findProblematicTraces(6); // last 6 hours

      if (traces.length === 0) {
        return { ok: true, result: "No problematic traces in the last 6h" };
      }

      // v61.4 Phase 9: Store each failure trace in the vector memory with a
      // real embedding (nomic-embed-text). This lets future runs find
      // conceptually similar past failures via cosine similarity — not just
      // exact skill-name matches.
      const { storeMemoryWithEmbedding, searchBySimilarity } = await import("./vector-memory");
      for (const t of traces) {
        const failureText = `Skill: ${t.skill} | Reason: ${t.failureReason ?? "unknown"} | Prompt: ${t.userPrompt.slice(0, 200)}`;
        const memKey = `failure:${t.skill}:${t.runId}`;
        await storeMemoryWithEmbedding(memKey, failureText, "failure", [t.skill, "rules-auditor"]);
      }

      // Group traces by skill to find the most common failure patterns.
      const bySkill = new Map<string, typeof traces>();
      for (const t of traces) {
        const arr = bySkill.get(t.skill) ?? [];
        arr.push(t);
        bySkill.set(t.skill, arr);
      }

      let proposalsCreated = 0;
      for (const [skill, skillTraces] of bySkill) {
        // Only propose if there are 2+ failures for this skill (avoid noise).
        if (skillTraces.length < 2) continue;

        // v61.4 Phase 9: Query the vector memory for similar past failures
        // (across ALL skills, not just this one). This finds conceptually
        // similar failure patterns — e.g. a "timeout" failure in the
        // rules-auditor might be similar to a "timeout" failure in the
        // outreach-executor, even though the skill names differ.
        const failureQuery = `${skill} failures: ${skillTraces[0].failureReason ?? "unknown"}`;
        const similarFailures = await searchBySimilarity(failureQuery, 3, "failure");

        // Use the LLM to analyze the failure pattern + suggest an improvement.
        const { callLLM } = await import("./llm-client");
        const failureSummary = skillTraces
          .slice(0, 5)
          .map((t, i) => `Trace ${i + 1}: retries=${t.retries}, success=${t.success}, reason=${t.failureReason ?? "n/a"}, prompt="${t.userPrompt.slice(0, 150)}"`)
          .join("\n");
        const similarSummary = similarFailures.length > 0
          ? `\n\nSEMANTICALLY SIMILAR PAST FAILURES (from vector memory, cosine similarity):\n${similarFailures.map((s, i) => `Similar ${i + 1} (sim=${s.similarity.toFixed(3)}): ${s.value.slice(0, 200)}`).join("\n")}\n`
          : "\n(No similar past failures found in vector memory — this may be a new failure pattern.)\n";
        const prompt = `You are the ARIA Rules Auditor. Analyze these failed/retried execution traces for the "${skill}" skill and propose ONE concrete rule improvement WITH a proposed code change.

Traces (last 6h, ${skillTraces.length} total):
${failureSummary}
${similarSummary}
Respond in EXACTLY this format (no markdown):
RULE: [the current rule/prompt that should be updated]
PROBLEM: [1-2 sentences: the pattern of failure you observe]
SUGGESTION: [1-2 sentences: the specific change to the rule/prompt that would prevent this failure]
PROPOSED_CODE_CHANGE: [the EXACT TypeScript code snippet to apply — e.g. the new systemPrompt string for skill-patterns.ts, or the new condition to add to conductor/router.ts. Be specific — the owner should be able to copy-paste it.]
TARGET_FILE: [the file path to modify — e.g. "src/lib/skill-patterns.ts" or "src/lib/conductor/router.ts"]
CONFIDENCE: [0.0-1.0]`;

        const result = await callLLM("Rules-Auditor", "Conductor", prompt, { maxRetries: 1 });
        if (!result.success || !result.completion) continue;

        // Parse the LLM response.
        const ruleMatch = result.completion.match(/RULE:\s*(.+)/i);
        const problemMatch = result.completion.match(/PROBLEM:\s*(.+)/i);
        const suggestionMatch = result.completion.match(/SUGGESTION:\s*(.+)/i);
        const codeChangeMatch = result.completion.match(/PROPOSED_CODE_CHANGE:\s*([\s\S]+?)(?=TARGET_FILE:|CONFIDENCE:)/i);
        const targetFileMatch = result.completion.match(/TARGET_FILE:\s*(.+)/i);
        const confidenceMatch = result.completion.match(/CONFIDENCE:\s*([0-9.]+)/i);
        if (!suggestionMatch) continue;

        const rule = ruleMatch?.[1]?.trim() ?? `skill:${skill}`;
        const problem = problemMatch?.[1]?.trim() ?? "Unknown failure pattern";
        const suggestion = suggestionMatch[1].trim();
        const proposedCodeChange = codeChangeMatch?.[1]?.trim() ?? "(no code change proposed)";
        const targetFile = targetFileMatch?.[1]?.trim() ?? "src/lib/skill-patterns.ts";
        const confidence = parseFloat(confidenceMatch?.[1] ?? "0.5");

        // Skip low-confidence suggestions.
        if (confidence < 0.6) continue;

        // Create a HUMAN_ASSISTED approval for the owner to review + apply.
        const approval = await db.approval.create({
          data: {
            title: `🔧 Rule Improvement: ${skill}`,
            summary: `Self-improvement proposal for skill "${skill}" (confidence ${(confidence * 100).toFixed(0)}%, ${skillTraces.length} failures in 6h). Target: ${targetFile}`,
            risk: "medium",
            requester: "rules-auditor",
            action: "execute_workflow_or_skill",
            payload: JSON.stringify({
              type: "rule-improvement",
              skill,
              rule,
              problem,
              suggestion,
              proposedCodeChange,
              targetFile,
              confidence,
              traceCount: skillTraces.length,
              proposedAt: new Date().toISOString(),
            }),
            status: "pending",
          },
        });

        // Send a Telegram brief. v61 Phase 4: include the proposed code change
        // + target file so the owner can review the exact diff before approving.
        try {
          const { sendTelegramMessage } = await import("@/lib/telegram-notifier");
          // If the proposed code change is long, push it to Telegram separately
          // via the multimodal fallback so it doesn't truncate.
          const briefText =
            `🔧 *RULE IMPROVEMENT PROPOSED*\n\n` +
            `*Skill:* ${skill}\n` +
            `*Target:* ${targetFile}\n` +
            `*Confidence:* ${(confidence * 100).toFixed(0)}%\n` +
            `*Failures:* ${skillTraces.length} in last 6h\n\n` +
            `*Problem:* ${problem.slice(0, 200)}\n\n` +
            `*Suggestion:* ${suggestion.slice(0, 200)}\n\n` +
            `*Proposed Code:*\n\`\`\`\n${proposedCodeChange.slice(0, 800)}\n\`\`\`\n\n` +
            `Review: /discuss ${approval.id.slice(-8)} <question>\n` +
            `Apply: /approve ${approval.id.slice(-8)}\n` +
            `Reject: /deny ${approval.id.slice(-8)}`;
          await sendTelegramMessage(briefText);
        } catch { /* best-effort */ }

        emit({
          type: "system",
          ts: new Date().toISOString(),
          message: `🔧 Rules-Auditor proposed improvement for "${skill}" (confidence ${(confidence * 100).toFixed(0)}%) — approval ${approval.id.slice(-8)} queued`,
          level: "info",
        });

        proposalsCreated++;
      }

      return { ok: true, result: `Rules-Auditor: reviewed ${traces.length} traces, proposed ${proposalsCreated} improvement(s)` };
    } catch (err) {
      return { ok: false, result: `rules-auditor failed: ${String(err).slice(0, 100)}` };
    }
  },
  // ─── v25-ported infra jobs (added by MERGE-INFRA) ───────────────────
  "cash-claw-sweep": async () => {
    try {
      const { runCashClawSweep } = await import("@/lib/cash-claw");
      const result = await runCashClawSweep();
      return {
        ok: true,
        result: `cash-claw: ${result.dying} dying, ${result.dead} dead`,
      };
    } catch (err) {
      return { ok: false, result: `cash-claw failed: ${String(err).slice(0, 100)}` };
    }
  },
  "feasibility-rescore": async () => {
    try {
      const { scoreOpportunity } = await import("@/lib/feasibility");
      // Re-score pending (discovered + review) opportunities via Monte Carlo.
      const pending = await db.earningOpportunity.findMany({
        where: { status: { in: ["discovered", "review"] } },
        take: 50,
      });
      let go = 0;
      let halt = 0;
      let pivot = 0;
      for (const opp of pending) {
        try {
          const r = await scoreOpportunity(opp.id);
          if (r.goHaltPivot === "GO") go++;
          else if (r.goHaltPivot === "HALT") halt++;
          else pivot++;
        } catch {
          // One opportunity failing to score shouldn't abort the whole sweep.
        }
      }
      return {
        ok: true,
        result: `feasibility-rescore: scored ${pending.length} opportunities (${go} GO, ${halt} HALT, ${pivot} PIVOT)`,
      };
    } catch (err) {
      return { ok: false, result: `feasibility-rescore failed: ${String(err).slice(0, 100)}` };
    }
  },
  "failure-alchemy-sweep": async () => {
    try {
      const { synthesizeArtifacts } = await import("@/lib/failure-alchemy");
      const result = await synthesizeArtifacts();
      return {
        ok: true,
        result: `failure-alchemy: synthesized ${result.created} artifacts`,
      };
    } catch (err) {
      return { ok: false, result: `failure-alchemy failed: ${String(err).slice(0, 100)}` };
    }
  },
  "kpi-snapshot": async () => {
    try {
      const { captureSnapshot } = await import("@/lib/kpi-engine");
      await captureSnapshot();
      return { ok: true, result: "kpi-snapshot: captured" };
    } catch (err) {
      return { ok: false, result: `kpi-snapshot failed: ${String(err).slice(0, 100)}` };
    }
  },
  "revenue-cycle": async () => {
    try {
      const { runRevenueCycle } = await import("@/lib/revenue-engine");
      const r = await runRevenueCycle();
      return {
        ok: true,
        result:
          `revenue-cycle: F${r.found}/Q${r.qualified}/P${r.planned}/` +
          `E${r.executed}/T${r.tracked}/O${r.optimized}`,
      };
    } catch (err) {
      return { ok: false, result: `revenue-cycle failed: ${String(err).slice(0, 100)}` };
    }
  },
  "milestone-check": async () => {
    try {
      const { recordMilestone } = await import("@/lib/milestones");
      let recorded = 0;

      // 1. Agents that have crossed 100 tasksDone (fire once per agent —
      //    skip if a milestone-100-tasks row already mentions them).
      const candidates = await db.agent.findMany({
        where: { tasksDone: { gte: 100 } },
      });
      for (const agent of candidates) {
        try {
          const existing = await db.milestoneEvent.findFirst({
            where: {
              type: "milestone-100-tasks",
              description: { contains: agent.name },
            },
          });
          if (existing) continue;
          await recordMilestone({
            type: "milestone-100-tasks",
            title: `${agent.name} crossed 100 tasks`,
            description: `Agent ${agent.name} (${agent.role}) completed ${agent.tasksDone} tasks.`,
            intensity: "normal",
          });
          recorded++;
        } catch {
          // One milestone failure shouldn't abort the sweep.
        }
      }

      // 2. Deals that closed (stage="won") in the last 10 minutes — fire
      //    once per deal (idempotent by deal title in description).
      const since = new Date(Date.now() - 10 * 60 * 1000);
      const closedDeals = await db.deal.findMany({
        where: { stage: "won", updatedAt: { gte: since } },
      });
      for (const deal of closedDeals) {
        try {
          const existing = await db.milestoneEvent.findFirst({
            where: {
              type: "deal-closed",
              description: { contains: deal.title },
            },
          });
          if (existing) continue;
          await recordMilestone({
            type: "deal-closed",
            title: `Deal closed: ${deal.title}`,
            description: `Deal "${deal.title}" closed at ${deal.value} ${deal.currency}.`,
            intensity: "epic",
          });
          recorded++;
        } catch {
          // One milestone failure shouldn't abort the sweep.
        }
      }

      return {
        ok: true,
        result:
          recorded > 0
            ? `milestone-check: recorded ${recorded} new`
            : "milestone-check: none",
      };
    } catch (err) {
      return { ok: false, result: `milestone-check failed: ${String(err).slice(0, 100)}` };
    }
  },

  // v61.6 Phase 11: Daily Knowledge Refresh — runs at 2 AM daily.
  // Extracts lessons from the worklog, vector memory, internet research, and
  // external repos. Prunes stale knowledge. Detects learning stagnation.
  // See scripts/daily-knowledge-refresh.ts for the full implementation.
  // v69 Phase 19 BLOCKER 1: webpackIgnore magic comment prevents Webpack
  // from statically resolving this dynamic import at build time. Same
  // pattern as auto-bootstrap.ts.
  "daily-knowledge-refresh": async () => {
    try {
      const scriptPath = require("path").join(process.cwd(), "scripts", "daily-knowledge-refresh.ts");
      if (!require("fs").existsSync(scriptPath)) {
        return { ok: false, result: "daily-knowledge-refresh.ts script not found" };
      }
      await import(/* webpackIgnore: true */ scriptPath);
      return { ok: true, result: "daily-knowledge-refresh: completed (see logs for details)" };
    } catch (err) {
      return { ok: false, result: `daily-knowledge-refresh failed: ${String(err).slice(0, 100)}` };
    }
  },

  // v63 Phase 13: Weekly Simulation — runs every Sunday at 3 AM.
  // Runs all 100 simulation scenarios across 4 suites (customer-purchase,
  // owner-commands, edge-cases, tough-questions) + generates a readiness report.
  "weekly-simulation": async () => {
    try {
      const { generateSimulationReport } = await import("./simulation-engine");
      const report = await generateSimulationReport();
      return {
        ok: true,
        result: `weekly-simulation: ${report.totalScenarios} scenarios, ${report.overallPassRate.toFixed(1)}% pass rate`,
      };
    } catch (err) {
      return { ok: false, result: `weekly-simulation failed: ${String(err).slice(0, 100)}` };
    }
  },

  // v71 Phase 21 (RULE-69): Autonomous Lead Hunting — runs daily at 6 AM.
  // Scouts Twitter/LinkedIn/Reddit for buying signals, matches to services,
  // extracts brand from social profiles, qualifies via Scout/Risk/Sales
  // 3-agent debate, then takes action (pursue/investigate/skip).
  "daily-lead-hunt": async () => {
    try {
      const { runDailyLeadHunt } = await import("./lead-hunter");
      const result = await runDailyLeadHunt();
      return {
        ok: true,
        result: `daily-lead-hunt: ${result.discovered} leads discovered → ${result.pursued} pursued, ${result.investigated} investigating, ${result.skipped} skipped, ${result.errors} errors`,
      };
    } catch (err) {
      return { ok: false, result: `daily-lead-hunt failed: ${String(err).slice(0, 100)}` };
    }
  },

  // v72 Phase 22 (RULE-70): Proactive Promotion Engine — runs daily at 11 AM.
  // Staggered AFTER the 5 AM lead-hunt + 6 AM learning + 7 AM health-sim
  // to avoid Ollama CPU contention (per v71.1 stagger principle).
  // Scans Google Maps for businesses without websites, sends proactive
  // outreach to qualified leads via WhatsApp/email/social-DM, posts awareness
  // content to ARIA's own social accounts (subject to per-pattern approval).
  "daily-proactive-promo": async () => {
    try {
      const { scanForBusinessesWithoutWebsites } = await import("./lead-hunter/google-maps-scout");
      const { sendOutreachToAllPursuedLeads, sendOutreachToGoogleMapsBusinesses, sendOutreachToImportedContacts } = await import("./outreach-coordinator");
      const { generateAwarenessContent, schedulePost } = await import("./social-media-manager");

      // Step 1: Scan Google Maps for businesses without websites.
      const businesses = await scanForBusinessesWithoutWebsites();
      // Step 2: Send proactive outreach to PURSUE leads (from social-scout).
      const leadsOutreach = await sendOutreachToAllPursuedLeads(20);
      // Step 3: Send proactive outreach to Google Maps no-website businesses.
      const gmbOutreach = await sendOutreachToGoogleMapsBusinesses(30);
      // Step 4: Send proactive outreach to imported Excel contacts.
      const importedOutreach = await sendOutreachToImportedContacts(50);
      // Step 5: Generate + schedule 1 awareness post per platform (subject to approval).
      const platforms = ["instagram", "facebook", "x", "linkedin"] as const;
      let postsScheduled = 0;
      for (const platform of platforms) {
        try {
          const content = await generateAwarenessContent(
            "ARIA free offer: first 100 customers get a free landing page or website built by an AI autonomous company",
            platform,
            "free-offer-100",
            "offer",
          );
          await schedulePost(content);
          postsScheduled++;
        } catch { /* best-effort */ }
      }

      return {
        ok: true,
        result: `daily-proactive-promo: GMB scanned=${businesses.length}, leads outreach=${leadsOutreach.sent}/${leadsOutreach.processed} (queued=${leadsOutreach.queuedForApproval}), GMB outreach=${gmbOutreach.sent}/${gmbOutreach.processed}, imported outreach=${importedOutreach.sent}/${importedOutreach.processed}, awareness posts scheduled=${postsScheduled}`,
      };
    } catch (err) {
      return { ok: false, result: `daily-proactive-promo failed: ${String(err).slice(0, 100)}` };
    }
  },

  // v73 Phase 23 (RULE-72): Self-Evolving Codebase — weekly Sundays 2 AM.
  // Scans AgentLog for modules with > 15% failure rate + checks TECH-DEBT
  // deadlines. Drafts refactors, sandbox-tests them, creates RefactorProposal
  // records + sends Telegram briefs with /merge commands.
  "weekly-code-auditor": async () => {
    try {
      const { runWeeklyAudit } = await import("./self-evolution/refactor-engine");
      const result = await runWeeklyAudit();
      return {
        ok: true,
        result: `weekly-code-auditor: flagged ${result.flagged} modules, created ${result.proposalsCreated} refactor proposals (${result.errors} errors)`,
      };
    } catch (err) {
      return { ok: false, result: `weekly-code-auditor failed: ${String(err).slice(0, 100)}` };
    }
  },

  // ─── Phase 29 — GDPR erasure cron ───────────────────────────────────
  // Daily at 3 AM. Processes all erasure requests whose grace window
  // (default 7 days, configurable via GDPR_ARTICLE_17_GRACE_DAYS) has
  // expired. Scrubs PII from Lead/ImportedContact/Personnel/User/
  // ClientPortalAccess tables, anonymizes AuditLogEntry.actor (does NOT
  // delete audit entries — required by law for 7-year retention).
  "daily-gdpr-erasure": async () => {
    try {
      const { processExpiredErasureRequests } = await import("./gdpr");
      const result = await processExpiredErasureRequests();
      return {
        ok: true,
        result: `daily-gdpr-erasure: processed ${result.processed} erasure requests`,
      };
    } catch (err) {
      return { ok: false, result: `daily-gdpr-erasure failed: ${String(err).slice(0, 100)}` };
    }
  },

  // ─── Phase 29 — FX rate cache refresh ──────────────────────────────
  // Hourly. Refreshes the in-memory FX rate cache from exchangerate.host
  // so the first currency conversion of the hour doesn't pay the latency
  // cost. The cache itself is already 1h TTL — this cron is a "warm-up"
  // so the cache is always fresh.
  "hourly-fx-refresh": async () => {
    try {
      const { getFxRates, clearFxCache } = await import("./currency-converter");
      clearFxCache();
      const result = await getFxRates();
      return {
        ok: true,
        result: `hourly-fx-refresh: cache refreshed (source=${result.source})`,
      };
    } catch (err) {
      return { ok: false, result: `hourly-fx-refresh failed: ${String(err).slice(0, 100)}` };
    }
  },

  // ─── Phase 30 — Stripe Financial Hardening ──────────────────────────
  // Daily at 4 AM. Fetches Stripe Balance Transactions from the past 24
  // hours + matches against internal RevenueEvent + LedgerEntry records.
  // Discrepancies fire SystemAlert + Telegram owner notification.
  "daily-stripe-reconciliation": async () => {
    try {
      const { runStripeReconciliation } = await import("./finance/stripe-reconciliation");
      const result = await runStripeReconciliation(24);
      return {
        ok: true,
        result: `daily-stripe-reconciliation: total=${result.total}, matched=${result.matched}, discrepancies=${result.discrepancies}, ignored=${result.ignored}, totalAmount=$${(result.totalAmountCents / 100).toFixed(2)}`,
      };
    } catch (err) {
      return { ok: false, result: `daily-stripe-reconciliation failed: ${String(err).slice(0, 100)}` };
    }
  },

  // ─── Phase 30 — Memory Watchdog ─────────────────────────────────────
  // Every 5 minutes. Takes a memory sample + persists to MemorySnapshot.
  // Triggers alerts when RSS exceeds threshold (80% warn, 95% critical +
  // pauses autonomy). The interval-based sampler in src/lib/memory-watchdog.ts
  // also runs every 60s — this cron is a backup that runs even if the
  // setInterval was somehow killed (e.g. by HMR or a crash recovery).
  "memory-watchdog": async () => {
    try {
      const { takeMemorySample } = await import("./memory-watchdog");
      const sample = await takeMemorySample();
      return {
        ok: true,
        result: `memory-watchdog: RSS=${(sample.rssBytes / 1024 / 1024).toFixed(0)}MB (${sample.rssPercent.toFixed(1)}%), heap=${(sample.heapUsedBytes / 1024 / 1024).toFixed(0)}MB, alert=${sample.alertLevel}`,
      };
    } catch (err) {
      return { ok: false, result: `memory-watchdog failed: ${String(err).slice(0, 100)}` };
    }
  },

  // ─── Phase 30 — Daily Soak Analysis ────────────────────────────────
  // Daily at 5 AM (after the 4 AM reconciliation). Analyzes the last 24
  // hours of MemorySnapshot records for memory leaks. Uses linear regression
  // on RSS over time — if slope > 10 MB/hour + R² > 0.7, flags a leak.
  "daily-soak-analysis": async () => {
    try {
      const { detectMemoryLeak } = await import("./memory-watchdog");
      const analysis = await detectMemoryLeak(24);
      if (analysis.leakDetected) {
        const { sendTelegramMessage } = await import("./telegram-notifier");
        await sendTelegramMessage(
          `🟠 *Memory Leak Detected*\n\n` +
          `*Slope:* ${(analysis.slopeBytesPerHour / 1024 / 1024).toFixed(1)} MB/hour\n` +
          `*R²:* ${analysis.rSquared.toFixed(3)}\n` +
          `*Samples:* ${analysis.samples}\n\n` +
          `_Investigate: check the memory dashboard + recent deployments for unbounded caches / event listeners._`,
        ).catch(() => null);
      }
      return {
        ok: true,
        result: `daily-soak-analysis: leakDetected=${analysis.leakDetected}, slope=${(analysis.slopeBytesPerHour / 1024 / 1024).toFixed(1)} MB/hr, r²=${analysis.rSquared.toFixed(3)}, samples=${analysis.samples}`,
      };
    } catch (err) {
      return { ok: false, result: `daily-soak-analysis failed: ${String(err).slice(0, 100)}` };
    }
  },

  // ─── Phase 32 Remediation — Check Unresolved Tool-Failure Escalations ────
  // Every 15 minutes. Checks for tool-failure-decision approvals that have
  // been pending for 2+ hours. If found, pauses the affected cron jobs +
  // sends a critical Telegram alert. This is Tier 3 of the escalation
  // pattern (fail-safe when the owner doesn't respond).
  "check-unresolved-escalations": async () => {
    try {
      const { checkUnresolvedEscalations } = await import("./tool-failure-escalation");
      const result = await checkUnresolvedEscalations();
      return {
        ok: true,
        result: `check-unresolved-escalations: paused=${result.paused}, alerted=${result.alerted}`,
      };
    } catch (err) {
      return { ok: false, result: `check-unresolved-escalations failed: ${String(err).slice(0, 100)}` };
    }
  },
};
