import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { seedIfEmpty, startEngine } from "@/lib/simulation";
import { startApprovalDecider } from "@/lib/approval-decision";
import { startMonitor } from "@/lib/monitor";
import { startEnvLoader } from "@/lib/env-loader";
import { requireOwner } from "@/lib/auth";
import {
  toIso,
  parseJsonArray,
  type Agent,
  type Task,
  type Approval,
  type CronJob,
  type SystemAlert,
  type Skill,
  type LlmCall,
  type AgentLog,
  type RevenueEvent,
  type Deal,
  type AgentMessage,
  type MemoryItem,
  type Personnel,
} from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/seed
 *
 * v47 fix 1: This route is NO LONGER public. It exposes the entire database
 * (agents, tasks, approvals, LLM prompts+completions, logs, deals). Now requires
 * owner authentication via requireOwner(). The proxy.ts PUBLIC_API_PREFIXES
 * no longer includes /api/seed, so unauthenticated requests are rejected at
 * the proxy layer (302 redirect to /login). The requireOwner() here is a
 * defense-in-depth check in case the proxy is bypassed.
 *
 * Hydrates the database if empty, boots the simulation engine, and returns
 * the full initial snapshot in a single payload so the client can paint
 * the first frame without waiting for SSE events.
 */
export async function GET() {
  try {
    // v47 fix 1: Require owner auth — this route exposes the entire DB.
    await requireOwner();

    // Start the env hot-reloader (every 5s) before anything else,
    // so all subsequent engine starts read the latest env values.
    startEnvLoader();
    await seedIfEmpty();

    // ONBOARDING GATE: only start the simulation engine, approval decider,
    // and monitor AFTER at least one company is created. This prevents CPU
    // overheating + wasted LLM calls before the app is configured.
    const companyCount = await db.companyProfile.count({ where: { isActive: true } });
    const isOnboarded = companyCount > 0;

    if (isOnboarded) {
      startEngine();
      startApprovalDecider();
      startMonitor();
      // Start the blackbox flight recorder (flushes to DB every 30s)
      import("@/lib/blackbox").then(({ startBlackbox }) => startBlackbox()).catch((err) => {
        logger.warn("api.seed.blackbox-start-failed", { error: String(err) });
      });
    } else {
      logger.info("api.seed.onboarding-pending", { companyCount });
    }

    const [agents, tasks, approvals, cronJobs, alerts, skills, llmCalls, logs, revenueEvents, deals, agentMessages, memories, personnel] = await Promise.all([
      db.agent.findMany({ orderBy: { createdAt: "asc" } }),
      db.task.findMany({ orderBy: { createdAt: "desc" }, take: 60, include: { assignedTo: true } }),
      db.approval.findMany({ orderBy: { createdAt: "desc" }, take: 30 }),
      db.cronJob.findMany({ orderBy: { createdAt: "asc" } }),
      db.systemAlert.findMany({ orderBy: { createdAt: "desc" }, take: 40 }),
      db.skill.findMany({ orderBy: { invocations: "desc" } }),
      db.llmCall.findMany({ orderBy: { createdAt: "desc" }, take: 40 }),
      db.agentLog.findMany({ orderBy: { createdAt: "desc" }, take: 80 }),
      db.revenueEvent.findMany({ orderBy: { createdAt: "desc" }, take: 100 }),
      db.deal.findMany({ orderBy: { updatedAt: "desc" }, take: 40 }),
      db.agentMessage.findMany({ orderBy: { createdAt: "desc" }, take: 60 }),
      db.memoryItem.findMany({ orderBy: { updatedAt: "desc" }, take: 50 }),
      db.personnel.findMany({ orderBy: { createdAt: "asc" } }),
    ]);
  return NextResponse.json({
    agents: agents.map<Agent>((a) => ({
      id: a.id,
      name: a.name,
      role: a.role as Agent["role"],
      tier: a.tier as Agent["tier"],
      status: a.status as Agent["status"],
      model: a.model,
      department: a.department,
      capabilities: parseJsonArray<string>(a.capabilities, []),
      currentTask: a.currentTask,
      tokensUsed: a.tokensUsed,
      tasksDone: a.tasksDone,
      errorCount: a.errorCount,
      lastBeatAt: toIso(a.lastBeatAt),
      createdAt: toIso(a.createdAt)!,
      updatedAt: toIso(a.updatedAt)!,
    })),
    tasks: tasks.map<Task>((t) => ({
      id: t.id,
      title: t.title,
      description: t.description,
      status: t.status as Task["status"],
      priority: t.priority as Task["priority"],
      assignedToId: t.assignedToId,
      dependsOn: parseJsonArray<string>(t.dependsOn, []),
      result: t.result,
      progress: t.progress,
      kind: t.kind as Task["kind"],
      createdAt: toIso(t.createdAt)!,
      startedAt: toIso(t.startedAt),
      completedAt: toIso(t.completedAt),
      updatedAt: toIso(t.updatedAt)!,
      assignedTo: t.assignedTo
        ? {
            id: t.assignedTo.id,
            name: t.assignedTo.name,
            role: t.assignedTo.role as Agent["role"],
            tier: t.assignedTo.tier as Agent["tier"],
            status: t.assignedTo.status as Agent["status"],
            model: t.assignedTo.model,
            department: t.assignedTo.department,
            capabilities: parseJsonArray<string>(t.assignedTo.capabilities, []),
            currentTask: t.assignedTo.currentTask,
            tokensUsed: t.assignedTo.tokensUsed,
            tasksDone: t.assignedTo.tasksDone,
            errorCount: t.assignedTo.errorCount,
            lastBeatAt: toIso(t.assignedTo.lastBeatAt),
            createdAt: toIso(t.assignedTo.createdAt)!,
            updatedAt: toIso(t.assignedTo.updatedAt)!,
          }
        : null,
    })),
    approvals: approvals.map<Approval>((a) => ({
      id: a.id,
      title: a.title,
      summary: a.summary,
      risk: a.risk as Approval["risk"],
      status: a.status as Approval["status"],
      requester: a.requester,
      agentId: a.agentId,
      action: a.action,
      amount: a.amount,
      payload: a.payload,
      brief: a.brief,
      discussionLog: a.discussionLog,
      oralConfirmed: a.oralConfirmed,
      voiceCallId: a.voiceCallId,
      createdAt: toIso(a.createdAt)!,
      decidedAt: toIso(a.decidedAt),
    })),
    cronJobs: cronJobs.map<CronJob>((c) => ({
      id: c.id,
      name: c.name,
      schedule: c.schedule,
      description: c.description,
      status: c.status as CronJob["status"],
      lastRunAt: toIso(c.lastRunAt),
      nextRunAt: toIso(c.nextRunAt),
      lastResult: c.lastResult,
      runCount: c.runCount,
      failCount: c.failCount,
      createdAt: toIso(c.createdAt)!,
      updatedAt: toIso(c.updatedAt)!,
    })),
    alerts: alerts.map<SystemAlert>((a) => ({
      id: a.id,
      severity: a.severity as SystemAlert["severity"],
      source: a.source,
      message: a.message,
      ack: a.ack,
      createdAt: toIso(a.createdAt)!,
    })),
    skills: skills.map<Skill>((s) => ({
      id: s.id,
      slug: s.slug,
      name: s.name,
      category: s.category as Skill["category"],
      description: s.description,
      source: s.source,
      status: s.status as Skill["status"],
      invocations: s.invocations,
      successRate: s.successRate,
      createdAt: toIso(s.createdAt)!,
      updatedAt: toIso(s.updatedAt)!,
    })),
    llmCalls: llmCalls.map<LlmCall>((c) => ({
      id: c.id,
      agentId: c.agentId,
      provider: c.provider as LlmCall["provider"],
      model: c.model,
      prompt: c.prompt,
      completion: c.completion,
      tokensIn: c.tokensIn,
      tokensOut: c.tokensOut,
      latencyMs: c.latencyMs,
      status: c.status as LlmCall["status"],
      fallback: c.fallback,
      error: c.error,
      createdAt: toIso(c.createdAt)!,
    })),
    logs: logs.map<AgentLog>((l) => ({
      id: l.id,
      agentId: l.agentId,
      taskId: l.taskId,
      level: l.level as AgentLog["level"],
      message: l.message,
      meta: l.meta,
      createdAt: toIso(l.createdAt)!,
    })),
    revenueEvents: revenueEvents.map<RevenueEvent>((r) => ({
      id: r.id,
      source: r.source as RevenueEvent["source"],
      amount: r.amount,
      currency: r.currency,
      agentId: r.agentId,
      dealId: r.dealId,
      description: r.description,
      createdAt: toIso(r.createdAt)!,
    })),
    deals: deals.map<Deal>((d) => ({
      id: d.id,
      title: d.title,
      value: d.value,
      currency: d.currency,
      stage: d.stage as Deal["stage"],
      probability: d.probability,
      source: d.source,
      agentId: d.agentId,
      counterparty: d.counterparty,
      expectedClose: toIso(d.expectedClose),
      createdAt: toIso(d.createdAt)!,
      updatedAt: toIso(d.updatedAt)!,
    })),
    agentMessages: agentMessages.map<AgentMessage>((m) => ({
      id: m.id,
      fromAgentId: m.fromAgentId,
      toAgentId: m.toAgentId,
      channel: m.channel as AgentMessage["channel"],
      messageType: m.messageType as AgentMessage["messageType"],
      subject: m.subject,
      body: m.body,
      taskId: m.taskId,
      createdAt: toIso(m.createdAt)!,
    })),
    memories: memories.map<MemoryItem>((m) => ({
      id: m.id,
      key: m.key,
      scope: m.scope as MemoryItem["scope"],
      value: m.value,
      tags: parseJsonArray<string>(m.tags, []),
      pinned: m.pinned,
      linkedTo: parseJsonArray<string>(m.linkedTo, []),
      strength: m.strength,
      agentId: m.agentId,
      createdAt: toIso(m.createdAt)!,
      updatedAt: toIso(m.updatedAt)!,
    })),
    personnel: personnel.map<Personnel>((p) => ({
      id: p.id,
      name: p.name,
      role: p.role,
      departmentId: p.departmentId,
      tools: parseJsonArray<string>(p.tools, []),
      createdAt: toIso(p.createdAt)!,
      updatedAt: toIso(p.updatedAt)!,
    })),
    uptime: Math.floor(process.uptime()),
  });
  } catch (err) {
    // v47 fix 1: Return 401 for auth errors, 500 for everything else.
    const msg = err instanceof Error ? err.message : "unknown";
    if (msg.includes("Unauthorized") || msg.includes("Forbidden")) {
      return NextResponse.json({ error: msg }, { status: 401 });
    }
    logger.error("api.seed.failed", { error: msg });
    return NextResponse.json(
      { error: "failed to bootstrap mission control", detail: msg },
      { status: 500 }
    );
  }
}
