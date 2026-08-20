import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import {
  FLEET,
  TASK_TEMPLATES,
  REVENUE_TEMPLATES,
  DEAL_TEMPLATES,
  MESSAGE_TEMPLATES,
  MEMORY_TEMPLATES,
  PERSONNEL_TEMPLATES,
  pick,
} from "@/lib/simulation";

export const dynamic = "force-dynamic";

/**
 * /api/sample-data — manage sample/mock data for demos and testing.
 *
 * GET  — returns counts of every table (so the UI can show what exists).
 * POST — seeds sample data: { agents, tasks, deals, revenue, messages,
 *        memories, alerts, skills } (each flag defaults to true).
 *        Idempotent: only adds if the specific table is empty (unless
 *        force=true is passed, which appends regardless).
 * DELETE — wipes ALL business data (tasks, approvals, deals, revenue,
 *        messages, memories, alerts, logs, metrics, llmCalls, cronRuns,
 *        skills, notes, milestones, kpiSnapshots, simulationRuns,
 *        earningOpportunities, subAgentTasks, learnedInsights,
 *        researchLogs, voicemails, supportTickets, debateSessions,
 *        failureAlchemyArtifacts, fleetForecasts, systemAccess*).
 *        Does NOT delete: agents (the 37-agent roster), personnel,
 *        companyProfile, cronJobs (definitions), users, accounts,
 *        sessions, credentials, settings — these are infrastructure.
 */

const BUSINESS_TABLES = [
  "task", "approval", "deal", "revenueEvent", "agentMessage", "memoryItem",
  "systemAlert", "agentLog", "metricPoint", "llmCall", "cronRun", "skill",
  "note", "milestoneEvent", "kpiSnapshot", "simulationRun", "simulationIteration",
  "earningOpportunity", "subAgentTask", "learnedInsight", "researchLog",
  "ecosystemRepo", "voicemail", "supportTicket", "debateSession",
  "failureAlchemyArtifact", "fleetForecast", "lockRecord",
  "systemAccessSession", "systemAccessApproval", "systemAccessAction",
  "agentMarketplaceTemplate", "companyEarningOpportunity",
] as const;

export async function GET() {
  try {
    const counts: Record<string, number> = {};
    for (const table of BUSINESS_TABLES) {
      try {
        counts[table] = await (db as unknown as Record<string, { count: () => Promise<number> }>)[table].count();
      } catch {
        counts[table] = -1; // table doesn't exist or query failed
      }
    }
    // Also count infrastructure tables (read-only display)
    const infra = {
      agent: await db.agent.count(),
      personnel: await db.personnel.count(),
      companyProfile: await db.companyProfile.count(),
      cronJob: await db.cronJob.count(),
      user: await db.user.count(),
    };
    return NextResponse.json({ counts, infra, total: Object.values(counts).reduce((a, b) => a + Math.max(0, b), 0) });
  } catch (e) {
    logger.error("sample-data.get.error", { error: String(e) });
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const {
      agents = true,
      tasks = true,
      deals = true,
      revenue = true,
      messages = true,
      memories = true,
      alerts = true,
      skills = true,
      force = false,
    } = body;

    const result: Record<string, number> = {};

    // Seed agents (upsert by name — idempotent)
    if (agents) {
      let added = 0;
      for (const f of FLEET) {
        const existing = await db.agent.findUnique({ where: { name: f.name } });
        if (existing && !force) continue;
        if (existing && force) {
          await db.agent.update({
            where: { id: existing.id },
            data: {
              status: "idle",
              tokensUsed: 0,
              tasksDone: 0,
              errorCount: 0,
              lastBeatAt: new Date(),
            },
          });
        } else {
          await db.agent.create({
            data: {
              name: f.name,
              role: f.role,
              tier: f.tier,
              status: "idle",
              model: f.model,
              department: f.department,
              capabilities: JSON.stringify(f.capabilities),
            },
          });
          added++;
        }
      }
      result.agents = added;
    }

    // Seed personnel
    if (agents) {
      const personnelCount = await db.personnel.count();
      if (personnelCount === 0 || force) {
        if (force) await db.personnel.deleteMany({});
        for (const p of PERSONNEL_TEMPLATES) {
          await db.personnel.create({
            data: {
              name: p.name,
              role: p.role,
              departmentId: p.departmentId,
              tools: JSON.stringify(p.tools),
            },
          });
        }
      }
    }

    // Seed tasks
    if (tasks) {
      const existing = await db.task.count();
      if (existing === 0 || force) {
        if (force) await db.task.deleteMany({});
        const allAgents = await db.agent.findMany();
        for (const t of TASK_TEMPLATES) {
          const agent = pick(allAgents);
          await db.task.create({
            data: {
              title: t.title,
              description: t.description,
              status: pick(["pending", "running", "completed", "pending"]),
              priority: t.priority,
              kind: t.kind,
              assignedToId: agent.id,
              progress: Math.floor(Math.random() * 100),
            },
          });
        }
      }
      result.tasks = await db.task.count();
    }

    // Seed deals
    if (deals) {
      const existing = await db.deal.count();
      if (existing === 0 || force) {
        if (force) await db.deal.deleteMany({});
        const allAgents = await db.agent.findMany();
        for (const d of DEAL_TEMPLATES) {
          const agent = pick(allAgents);
          await db.deal.create({
            data: {
              title: d.title,
              value: d.value,
              currency: "USD",
              stage: d.stage,
              probability: d.probability,
              source: "sample-data",
              counterparty: d.counterparty,
              agentId: agent.id,
            },
          });
        }
      }
      result.deals = await db.deal.count();
    }

    // Seed revenue events
    if (revenue) {
      const existing = await db.revenueEvent.count();
      if (existing === 0 || force) {
        if (force) await db.revenueEvent.deleteMany({});
        const allAgents = await db.agent.findMany();
        for (let i = 0; i < 15; i++) {
          const tpl = pick(REVENUE_TEMPLATES);
          const agent = pick(allAgents);
          await db.revenueEvent.create({
            data: {
              source: tpl.source,
              amount: tpl.amount,
              currency: "USD",
              agentId: agent.id,
              description: tpl.description,
            },
          });
        }
      }
      result.revenue = await db.revenueEvent.count();
    }

    // Seed agent messages
    if (messages) {
      const existing = await db.agentMessage.count();
      if (existing === 0 || force) {
        if (force) await db.agentMessage.deleteMany({});
        const allAgents = await db.agent.findMany();
        for (let i = 0; i < 20; i++) {
          const from = pick(allAgents);
          const to = pick(allAgents.filter((a) => a.id !== from.id));
          const tpl = pick(MESSAGE_TEMPLATES);
          await db.agentMessage.create({
            data: {
              fromAgentId: from.id,
              toAgentId: to.id,
              channel: tpl.channel,
              messageType: tpl.messageType,
              subject: tpl.subject,
              body: tpl.body,
            },
          });
        }
      }
      result.messages = await db.agentMessage.count();
    }

    // Seed memories
    if (memories) {
      const existing = await db.memoryItem.count();
      if (existing === 0 || force) {
        if (force) await db.memoryItem.deleteMany({});
        const allAgents = await db.agent.findMany();
        for (const m of MEMORY_TEMPLATES) {
          const agent = pick(allAgents);
          await db.memoryItem.create({
            data: {
              key: m.key,
              scope: m.scope,
              value: m.value,
              tags: JSON.stringify(m.tags ?? []),
              pinned: Math.random() > 0.8,
              strength: 0.3 + Math.random() * 0.6,
              agentId: agent.id,
            },
          });
        }
      }
      result.memories = await db.memoryItem.count();
    }

    // Seed alerts
    if (alerts) {
      const existing = await db.systemAlert.count();
      if (existing === 0 || force) {
        if (force) await db.systemAlert.deleteMany({});
        const alertSamples = [
          { severity: "warning", source: "monitor", message: "Agent Aria-CEO heartbeat delayed (45s)" },
          { severity: "info", source: "cron", message: "Nightly backup completed successfully" },
          { severity: "critical", source: "llm-router", message: "All LLM providers on cooldown — using fallback" },
          { severity: "warning", source: "cash-claw", message: "2 agents in dying state — review survival board" },
          { severity: "info", source: "revenue-engine", message: "New earning opportunity discovered ($2,400/mo)" },
        ];
        for (const a of alertSamples) {
          await db.systemAlert.create({ data: a });
        }
      }
      result.alerts = await db.systemAlert.count();
    }

    // Seed skills
    if (skills) {
      const existing = await db.skill.count();
      if (existing === 0 || force) {
        if (force) await db.skill.deleteMany({});
        const skillSamples = [
          { slug: "market-analysis", name: "Market Analysis", category: "research", description: "Analyze market trends and competitor positioning", source: "learned", invocations: 12, successRate: 0.85 },
          { slug: "lead-scoring", name: "Lead Scoring", category: "sales", description: "Score leads based on engagement and fit", source: "learned", invocations: 8, successRate: 0.9 },
          { slug: "content-drafting", name: "Content Drafting", category: "marketing", description: "Draft blog posts and social content", source: "manual", invocations: 15, successRate: 0.75 },
          { slug: "code-review", name: "Code Review", category: "engineering", description: "Review pull requests for quality and security", source: "learned", invocations: 6, successRate: 0.95 },
        ];
        for (const s of skillSamples) {
          await db.skill.create({ data: s });
        }
      }
      result.skills = await db.skill.count();
    }

    logger.success("sample-data.seed.complete", result);
    return NextResponse.json({ ok: true, seeded: result });
  } catch (e) {
    logger.error("sample-data.post.error", { error: String(e) });
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    const wiped: Record<string, number> = {};

    // Delete in dependency-safe order (children before parents)
    const deleteOrder = [
      "simulationIteration", "simulationRun", "subAgentTask", "learnedInsight",
      "systemAccessAction", "systemAccessApproval", "systemAccessSession",
      "companyEarningOpportunity", "earningOpportunity", "failureAlchemyArtifact",
      "debateSession", "supportTicket", "voicemail", "fleetForecast",
      "researchLog", "ecosystemRepo", "agentMarketplaceTemplate", "lockRecord",
      "kpiSnapshot", "milestoneEvent", "note", "skill",
      "cronRun", "llmCall", "metricPoint", "agentLog",
      "systemAlert", "memoryItem", "agentMessage", "revenueEvent",
      "deal", "approval", "task",
    ] as const;

    for (const table of deleteOrder) {
      try {
        const r = await (db as unknown as Record<string, { deleteMany: () => Promise<{ count: number }> }>)[table].deleteMany();
        wiped[table] = r.count;
      } catch {
        // table may not exist in schema — skip
      }
    }

    // Reset agent stats (but keep the roster)
    await db.agent.updateMany({
      data: {
        status: "idle",
        currentTask: null,
        tokensUsed: 0,
        tasksDone: 0,
        errorCount: 0,
        lastBeatAt: new Date(),
      },
    });

    const totalWiped = Object.values(wiped).reduce((a, b) => a + b, 0);
    logger.success("sample-data.wipe.complete", { wiped, total: totalWiped });
    return NextResponse.json({ ok: true, wiped, total: totalWiped });
  } catch (e) {
    logger.error("sample-data.delete.error", { error: String(e) });
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
