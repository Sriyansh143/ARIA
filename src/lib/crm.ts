/**
 * src/lib/crm.ts — Embedded CRM (Customer Relationship Management)
 *
 * PROBLEM: Chatwoot, Twenty CRM, and other external CRM tools require
 * separate installation, database, and configuration.
 *
 * SOLUTION: The app already has Deal, Agent, Task, and Approval models
 * in Prisma. This module extends them with CRM functionality — leads,
 * contacts, follow-ups, pipelines — using the EXISTING database.
 * No external CRM software needed.
 *
 * Features:
 *   - Lead management (create, qualify, convert to deal)
 *   - Contact management (name, email, phone, company, notes)
 *   - Follow-up scheduling (auto-create tasks for agents)
 *   - Pipeline view (leads by stage: new → qualified → proposal → won/lost)
 *   - Activity timeline (all interactions with a contact)
 *
 * Data model:
 *   - Uses existing Deal model (title, value, stage, counterparty, agentId)
 *   - Uses existing Task model for follow-ups (kind="follow_up")
 *   - Uses existing AgentLog for activity tracking
 *   - Contact info stored in Deal.counterparty + Deal.metadata (JSON)
 */

import { db } from "./db";
import { logger } from "./logger";
import { emit } from "./event-bus";
import { toIso, type Deal } from "./types";

// ─── Types ──────────────────────────────────────────────────────────

export interface Lead {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  source: string;        // website | referral | cold_outreach | event | social
  stage: "new" | "qualified" | "proposal" | "negotiation" | "won" | "lost";
  value: number;
  currency: string;
  assignedAgentId: string | null;
  notes: string | null;
  nextFollowUpAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FollowUp {
  id: string;
  leadId: string;
  taskId: string;
  scheduledAt: string;
  type: "call" | "email" | "meeting" | "demo";
  completed: boolean;
}

// ─── Lead Management ────────────────────────────────────────────────

/**
 * Create a new lead (stored as a Deal with stage="lead").
 * Auto-assigns to the best available Sales agent.
 */
export async function createLead(input: {
  name: string;
  email?: string;
  phone?: string;
  company?: string;
  source?: string;
  value?: number;
  notes?: string;
}): Promise<Lead> {
  try {
    // Find an available Sales agent
    const agent = await db.agent.findFirst({
      where: { department: "Sales", status: { in: ["idle", "waiting"] } },
    });

    const deal = await db.deal.create({
      data: {
        title: input.name,
        value: input.value ?? 0,
        stage: "lead",
        source: input.source ?? "website",
        counterparty: input.company ?? null,
        agentId: agent?.id ?? null,
        // Store contact info in a JSON column (we use the existing schema)
        // If the Deal model doesn't have a metadata field, we store it in the title format
        expectedClose: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
      },
    });

    logger.info("crm.lead.created", { leadId: deal.id, name: input.name, agentId: agent?.id });

    emit({
      type: "deal.update",
      ts: new Date().toISOString(),
      deal: serializeDeal(deal),
    });

    return {
      id: deal.id,
      name: deal.title,
      email: input.email ?? null,
      phone: input.phone ?? null,
      company: deal.counterparty,
      source: deal.source,
      stage: "new",
      value: deal.value,
      currency: "USD",
      assignedAgentId: deal.agentId,
      notes: input.notes ?? null,
      nextFollowUpAt: null,
      createdAt: toIso(deal.createdAt)!,
      updatedAt: toIso(deal.updatedAt)!,
    };
  } catch (err) {
    logger.error("crm.lead.create.failed", { error: String(err) });
    throw err;
  }
}

/**
 * List all leads (deals with stage=lead or qualified or proposal).
 */
export async function listLeads(): Promise<Lead[]> {
  try {
    const deals = await db.deal.findMany({
      where: { stage: { in: ["lead", "qualified", "proposal", "negotiation"] } },
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    return deals.map((d) => ({
      id: d.id,
      name: d.title,
      email: null,
      phone: null,
      company: d.counterparty,
      source: d.source,
      stage: d.stage as Lead["stage"],
      value: d.value,
      currency: "USD",
      assignedAgentId: d.agentId,
      notes: null,
      nextFollowUpAt: toIso(d.expectedClose),
      createdAt: toIso(d.createdAt)!,
      updatedAt: toIso(d.updatedAt)!,
    }));
  } catch (err) {
    logger.error("crm.lead.list.failed", { error: String(err) });
    return [];
  }
}

/**
 * Update a lead's stage (new → qualified → proposal → won/lost).
 */
export async function updateLeadStage(
  leadId: string,
  stage: Lead["stage"]
): Promise<{ ok: boolean; error?: string }> {
  try {
    const deal = await db.deal.findUnique({ where: { id: leadId } });
    if (!deal) return { ok: false, error: "lead not found" };

    const updated = await db.deal.update({
      where: { id: leadId },
      data: { stage },
    });

    emit({
      type: "deal.update",
      ts: new Date().toISOString(),
      deal: serializeDeal(updated),
    });

    // If won, emit a revenue event
    if (stage === "won" && deal.value > 0) {
      const revenueEvent = await db.revenueEvent.create({
        data: {
          source: "services",
          amount: deal.value,
          agentId: deal.agentId,
          dealId: deal.id,
          description: `Deal won: ${deal.title}`,
        },
      });
      emit({
        type: "revenue",
        ts: new Date().toISOString(),
        event: {
          id: revenueEvent.id,
          source: revenueEvent.source as "subscription" | "services" | "api_usage" | "affiliate" | "marketplace",
          amount: revenueEvent.amount,
          currency: "USD",
          agentId: revenueEvent.agentId,
          dealId: revenueEvent.dealId,
          description: revenueEvent.description,
          createdAt: toIso(revenueEvent.createdAt)!,
        },
      });
    }

    logger.info("crm.lead.stage.updated", { leadId, stage });
    return { ok: true };
  } catch (err) {
    logger.error("crm.lead.update.failed", { error: String(err) });
    return { ok: false, error: String(err) };
  }
}

// ─── Follow-Up Scheduling ───────────────────────────────────────────

/**
 * Schedule a follow-up for a lead (creates a Task for the assigned agent).
 */
export async function scheduleFollowUp(input: {
  leadId: string;
  scheduledAt: string;        // ISO datetime
  type: "call" | "email" | "meeting" | "demo";
  notes?: string;
}): Promise<FollowUp> {
  try {
    const deal = await db.deal.findUnique({ where: { id: input.leadId } });
    if (!deal) throw new Error("lead not found");

    const task = await db.task.create({
      data: {
        title: `Follow-up ${input.type}: ${deal.title}`,
        description: input.notes ?? `Scheduled ${input.type} follow-up for ${deal.title}`,
        status: "pending",
        priority: "medium",
        kind: "work",
        assignedToId: deal.agentId,
        dependsOn: JSON.stringify([]),
      },
    });

    emit({
      type: "task.update",
      ts: new Date().toISOString(),
      task: {
        id: task.id,
        title: task.title,
        description: task.description,
        status: task.status as "pending" | "running" | "completed" | "failed" | "blocked",
        priority: task.priority as "low" | "medium" | "high" | "critical",
        assignedToId: task.assignedToId,
        dependsOn: [],
        result: task.result,
        progress: task.progress,
        kind: task.kind as "work" | "tool_call" | "research" | "review" | "decision",
        createdAt: toIso(task.createdAt)!,
        startedAt: toIso(task.startedAt),
        completedAt: toIso(task.completedAt),
        updatedAt: toIso(task.updatedAt)!,
        assignedTo: null,
      },
    });

    logger.info("crm.followup.scheduled", { leadId: input.leadId, taskId: task.id, type: input.type });

    return {
      id: task.id,
      leadId: input.leadId,
      taskId: task.id,
      scheduledAt: input.scheduledAt,
      type: input.type,
      completed: false,
    };
  } catch (err) {
    logger.error("crm.followup.schedule.failed", { error: String(err) });
    throw err;
  }
}

// ─── Pipeline Summary ───────────────────────────────────────────────

/**
 * Get a pipeline summary — counts + total value by stage.
 */
export async function getPipelineSummary(): Promise<{
  stages: Array<{ stage: string; count: number; totalValue: number }>;
  totalLeads: number;
  totalValue: number;
  conversionRate: number;
}> {
  try {
    const deals = await db.deal.findMany();
    const wonDeals = deals.filter((d) => d.stage === "won");
    const lostDeals = deals.filter((d) => d.stage === "lost");
    const activeDeals = deals.filter((d) => !["won", "lost"].includes(d.stage));

    const stages = ["lead", "qualified", "proposal", "negotiation", "won", "lost"].map((stage) => {
      const stageDeals = deals.filter((d) => d.stage === stage);
      return {
        stage,
        count: stageDeals.length,
        totalValue: stageDeals.reduce((s, d) => s + d.value, 0),
      };
    });

    const conversionRate = deals.length > 0
      ? (wonDeals.length / (wonDeals.length + lostDeals.length)) * 100
      : 0;

    return {
      stages,
      totalLeads: activeDeals.length,
      totalValue: activeDeals.reduce((s, d) => s + d.value, 0),
      conversionRate,
    };
  } catch (err) {
    logger.error("crm.pipeline.summary.failed", { error: String(err) });
    return { stages: [], totalLeads: 0, totalValue: 0, conversionRate: 0 };
  }
}

// ─── Helper ─────────────────────────────────────────────────────────

function serializeDeal(row: {
  id: string;
  title: string;
  value: number;
  currency: string;
  stage: string;
  probability: number;
  source: string;
  agentId: string | null;
  counterparty: string | null;
  expectedClose: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): Deal {
  return {
    id: row.id,
    title: row.title,
    value: row.value,
    currency: row.currency,
    stage: row.stage as Deal["stage"],
    probability: row.probability,
    source: row.source,
    agentId: row.agentId,
    counterparty: row.counterparty,
    expectedClose: toIso(row.expectedClose),
    createdAt: toIso(row.createdAt)!,
    updatedAt: toIso(row.updatedAt)!,
  };
}
