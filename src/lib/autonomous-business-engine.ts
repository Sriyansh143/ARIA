/**
 * src/lib/autonomous-business-engine.ts — Autonomous Business Engine.
 *
 * Server-only. Orchestrates the full 8-stage autonomous business
 * lifecycle against any of the 12 industry playbooks:
 *
 *   FIND → QUALIFY → PLAN → EXECUTE → DELIVER → INVOICE → TRACK → OPTIMIZE
 *
 * Every stage is independently try/caught so a failure in one stage
 * does not abort the cycle. Each LLM call is also individually wrapped
 * so a single provider failure doesn't poison the rest.
 *
 * Persistence model:
 *   - EarningOpportunity — discovered/qualified opportunities
 *   - Deal               — qualified opportunities enter the pipeline
 *   - Task               — one per plan step
 *   - Approval           — created when plan revenue > $1000
 *   - AgentLog           — execution output for each step
 *   - Note               — deliverables + invoices
 *   - RevenueEvent       — emitted on invoiced won deals
 *   - KpiSnapshot        — throttled (6h) progress snapshots
 *   - MemoryItem         — optimization recommendations
 *   - MilestoneEvent     — cycle completion celebration
 *
 * The LLM router (`routeLLM`) returns RoutedLLMResult with `.completion`
 * (the text), `.success`, `.provider`, `.model`, `.fallbackUsed`, `.error`.
 */

import { db } from "./db";
import { logger } from "./logger";
import { emit } from "./event-bus";
import { routeLLM, type ChatMsg } from "./llm-router";
import { getPlaybook } from "./industry-playbooks";
import { recordMilestone } from "./milestones";

// ─── Public types ───────────────────────────────────────────────────

export interface FoundOpportunity {
  title: string;
  description: string;
  estimatedRevenue: number;
  timeToExecuteDays: number;
  department: string;
  feasibilityScore: number; // 0-1
  revenueModel: string;
  industryPlaybookId?: string;
  /** Set when the opportunity was loaded from an existing EarningOpportunity row */
  existingId?: string;
}

export interface ExecutionStep {
  order: number;
  action: string;
  department: string;
  estimatedHours: number;
  dependencies: number[];
}

export interface ExecutionPlan {
  opportunityTitle: string;
  steps: ExecutionStep[];
  totalEstimatedHours: number;
  requiredResources: string[];
  riskMitigation: string;
  dealId?: string;
  taskIds?: string[];
  approvalId?: string;
}

export interface StepResult {
  order: number;
  taskId: string;
  status: "completed" | "failed";
  output: string;
  agentId?: string;
}

export interface InvoiceLineItem {
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

export interface InvoiceData {
  number: string;
  dealId: string;
  amount: number;
  currency: string;
  lineItems: InvoiceLineItem[];
  dueDate: string;
  status: "pending";
  noteId?: string;
}

export interface CycleResult {
  industryPlaybookId: string;
  found: number;
  qualified: number;
  planned: number;
  executed: number;
  delivered: number;
  invoiced: number;
  tracked: number;
  optimized: number;
  revenueGenerated: number;
  errors: string[];
  startedAt: string;
  completedAt: string;
}

// ─── Helpers ────────────────────────────────────────────────────────

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Parse an LLM completion into a typed JSON value. Strips markdown
 * fences, finds the outermost JSON array/object, and falls back to
 * the supplied default on any error. Never throws.
 */
function parseLLMJson<T>(raw: string, fallback: T): T {
  try {
    const cleaned = raw
      .replace(/```json\n?/g, "")
      .replace(/```\n?/g, "")
      .trim();
    // If the model wrapped the JSON in prose, slice from the first { or [
    // to the matching last bracket.
    const firstObj = cleaned.indexOf("{");
    const firstArr = cleaned.indexOf("[");
    let start = -1;
    if (firstObj >= 0 && (firstArr < 0 || firstObj < firstArr)) start = firstObj;
    else if (firstArr >= 0) start = firstArr;
    if (start > 0) {
      const sliced = cleaned.slice(start);
      const lastObj = sliced.lastIndexOf("}");
      const lastArr = sliced.lastIndexOf("]");
      const end = Math.max(lastObj, lastArr);
      if (end > 0) {
        const parsed = JSON.parse(sliced.slice(0, end + 1));
        return parsed as T;
      }
    }
    return JSON.parse(cleaned) as T;
  } catch {
    return fallback;
  }
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function safeNumber(n: unknown, fallback = 0): number {
  const v = typeof n === "string" ? parseFloat(n) : typeof n === "number" ? n : NaN;
  return Number.isFinite(v) ? v : fallback;
}

// ─── Stage 1: FIND ──────────────────────────────────────────────────

export async function findOpportunities(
  industryPlaybookId: string,
): Promise<{ found: number; opportunities: FoundOpportunity[] }> {
  const playbook = getPlaybook(industryPlaybookId);
  if (!playbook) {
    return { found: 0, opportunities: [] };
  }

  const opportunities: FoundOpportunity[] = [];

  // 1a. LLM-generated fresh opportunities.
  try {
    const messages: ChatMsg[] = [
      {
        role: "system",
        content:
          "You are a senior business development AI for an autonomous AI company. " +
          "You generate concrete, monetizable business opportunities for a given industry. " +
          "Always respond with a strict JSON array — no markdown, no commentary.",
      },
      {
        role: "user",
        content:
          `Industry: ${playbook.name} (id: ${playbook.id})\n` +
          `Revenue models: ${playbook.revenueModels.map((m) => m.name).join(", ")}\n` +
          `Operational playbook:\n${playbook.operationalPlaybook}\n\n` +
          `Generate 3 to 5 concrete business opportunities the autonomous fleet can execute. ` +
          `Respond as a JSON array of objects with EXACTLY these fields:\n` +
          `[\n  {\n    "title": "string",\n    "description": "string — what the opportunity is and how to execute it",\n` +
          `    "estimatedRevenue": number (USD),\n    "timeToExecuteDays": number,\n` +
          `    "department": "string — must be one of: ${playbook.agentFocus.join(", ")}",\n` +
          `    "feasibilityScore": number (0-1),\n    "revenueModel": "string — must be one of: ${playbook.revenueModels.map((m) => m.name).join(", ")}"\n  }\n]`,
      },
    ];

    const result = await routeLLM(messages, {
      complexity: "medium",
      agentRole: "Sales",
    });

    if (result.success && result.completion) {
      const parsed = parseLLMJson<FoundOpportunity[]>(result.completion, []);
      if (Array.isArray(parsed)) {
        for (const p of parsed) {
          if (!p || typeof p.title !== "string") continue;
          opportunities.push({
            title: p.title,
            description: typeof p.description === "string" ? p.description : "",
            estimatedRevenue: safeNumber(p.estimatedRevenue, 1000),
            timeToExecuteDays: safeNumber(p.timeToExecuteDays, 7),
            department: typeof p.department === "string" ? p.department : playbook.agentFocus[0] ?? "Sales",
            feasibilityScore: clamp01(safeNumber(p.feasibilityScore, 0.5)),
            revenueModel: typeof p.revenueModel === "string" ? p.revenueModel : playbook.revenueModels[0]?.name ?? "",
            industryPlaybookId,
          });
        }
      }
    } else {
      logger.warn("autonomous-engine.find.llm-failed", {
        industryPlaybookId,
        error: result.error,
      });
    }
  } catch (err) {
    logger.error("autonomous-engine.find.error", { error: String(err) });
  }

  // 1b. Existing EarningOpportunity rows for this industry.
  try {
    const existing = await db.earningOpportunity.findMany({
      where: {
        OR: [
          { source: `industry:${industryPlaybookId}` },
          { source: { contains: industryPlaybookId } },
        ],
      },
      take: 20,
      orderBy: { discoveredAt: "desc" },
    });
    for (const row of existing) {
      opportunities.push({
        title: row.title,
        description: row.description ?? "",
        estimatedRevenue: row.estimatedRevenue,
        timeToExecuteDays: row.timeToExecuteHours > 0 ? row.timeToExecuteHours / 24 : 7,
        department: row.department,
        feasibilityScore: clamp01(row.feasibilityScore),
        revenueModel: "",
        industryPlaybookId,
        existingId: row.id,
      });
    }
  } catch (err) {
    logger.error("autonomous-engine.find.db-scan.error", { error: String(err) });
  }

  return { found: opportunities.length, opportunities };
}

// ─── Stage 2: QUALIFY ───────────────────────────────────────────────

export async function qualifyOpportunities(
  opportunities: FoundOpportunity[],
): Promise<{ qualified: FoundOpportunity[]; rejected: FoundOpportunity[] }> {
  const qualified: FoundOpportunity[] = [];
  const rejected: FoundOpportunity[] = [];

  for (const opp of opportunities) {
    try {
      const messages: ChatMsg[] = [
        {
          role: "system",
          content:
            "You are an opportunity qualification analyst. Assess each business opportunity " +
            "on market demand, competition, execution complexity, and projected profit margin. " +
            "Respond with strict JSON — no markdown.",
        },
        {
          role: "user",
          content:
            `Opportunity:\n${JSON.stringify(opp, null, 2)}\n\n` +
            `Assess and respond EXACTLY as JSON:\n` +
            `{\n  "marketDemand": number (0-1),\n  "competitionLevel": "low" | "medium" | "high",\n` +
            `  "executionComplexity": number (0-1),\n  "profitMargin": number (0-1),\n  "reasoning": "string"\n}`,
        },
      ];

      const result = await routeLLM(messages, {
        complexity: "medium",
        agentRole: "Sales",
      });

      let marketDemand = opp.feasibilityScore;
      let competitionLevel: string = "medium";
      let executionComplexity = 0.5;
      let profitMargin = 0.4;

      if (result.success && result.completion) {
        const a = parseLLMJson<{
          marketDemand?: number;
          competitionLevel?: string;
          executionComplexity?: number;
          profitMargin?: number;
        }>(result.completion, {});
        marketDemand = clamp01(safeNumber(a.marketDemand, opp.feasibilityScore));
        competitionLevel = typeof a.competitionLevel === "string" ? a.competitionLevel : "medium";
        executionComplexity = clamp01(safeNumber(a.executionComplexity, 0.5));
        profitMargin = clamp01(safeNumber(a.profitMargin, 0.4));
      }

      const qualifies =
        opp.feasibilityScore >= 0.6 && marketDemand >= 0.5;

      if (qualifies) {
        const enriched: FoundOpportunity = {
          ...opp,
          feasibilityScore: clamp01((opp.feasibilityScore + marketDemand) / 2),
        };
        qualified.push(enriched);

        // Persist as EarningOpportunity if not already existing.
        if (!opp.existingId) {
          try {
            const created = await db.earningOpportunity.create({
              data: {
                title: opp.title,
                description: opp.description,
                source: `industry:${opp.industryPlaybookId ?? "unknown"}`,
                estimatedRevenue: opp.estimatedRevenue,
                timeToExecuteHours: Math.max(1, Math.round(opp.timeToExecuteDays * 24)),
                department: opp.department,
                feasibilityScore: enriched.feasibilityScore,
                status: "qualified",
              },
            });
            enriched.existingId = created.id;
          } catch (err) {
            logger.error("autonomous-engine.qualify.persist-opportunity.error", {
              error: String(err),
            });
          }
        } else {
          try {
            await db.earningOpportunity.update({
              where: { id: opp.existingId },
              data: { status: "qualified", feasibilityScore: enriched.feasibilityScore },
            });
          } catch (err) {
            logger.error("autonomous-engine.qualify.update-opportunity.error", {
              error: String(err),
            });
          }
        }

        // Create a Deal at the lead stage.
        try {
          const deal = await db.deal.create({
            data: {
              title: opp.title,
              value: opp.estimatedRevenue,
              currency: "USD",
              stage: "lead",
              probability: Math.round(enriched.feasibilityScore * 100),
              source: `industry:${opp.industryPlaybookId ?? "unknown"}`,
              counterparty: opp.revenueModel || undefined,
            },
          });
          if (opp.existingId) {
            await db.earningOpportunity.update({
              where: { id: opp.existingId },
              data: { dealId: deal.id, status: "pipeline" },
              // AUDIT-B-15: log instead of silently swallowing — a failed deal link
              // would orphan the opportunity from the deal with no observability.
            }).catch((err) => { logger.error("autonomous-engine.opp.dealId-update-failed", { oppId: opp.existingId, dealId: deal.id, error: String(err) }); });
          }
          (enriched as FoundOpportunity & { dealId?: string }).dealId = deal.id;
        } catch (err) {
          logger.error("autonomous-engine.qualify.create-deal.error", { error: String(err) });
        }

        logger.info("autonomous-engine.qualify.qualified", {
          title: opp.title,
          marketDemand,
          competitionLevel,
          profitMargin,
        });
      } else {
        rejected.push(opp);
        logger.info("autonomous-engine.qualify.rejected", {
          title: opp.title,
          feasibilityScore: opp.feasibilityScore,
          marketDemand,
        });
      }
    } catch (err) {
      logger.error("autonomous-engine.qualify.iteration.error", {
        title: opp.title,
        error: String(err),
      });
      rejected.push(opp);
    }
  }

  return { qualified, rejected };
}

// ─── Stage 3: PLAN ──────────────────────────────────────────────────

export async function planExecution(
  qualifiedOpportunity: FoundOpportunity,
): Promise<{ plan: ExecutionPlan }> {
  const empty: ExecutionPlan = {
    opportunityTitle: qualifiedOpportunity.title,
    steps: [],
    totalEstimatedHours: 0,
    requiredResources: [],
    riskMitigation: "",
  };

  try {
    const playbook = qualifiedOpportunity.industryPlaybookId
      ? getPlaybook(qualifiedOpportunity.industryPlaybookId)
      : undefined;

    const messages: ChatMsg[] = [
      {
        role: "system",
        content:
          "You are a senior delivery planner. Break a qualified opportunity into a concrete " +
          "step-by-step execution plan with dependencies. Respond with strict JSON — no markdown.",
      },
      {
        role: "user",
        content:
          `Opportunity:\n${JSON.stringify(qualifiedOpportunity, null, 2)}\n\n` +
          (playbook ? `Industry playbook focus departments: ${playbook.agentFocus.join(", ")}.\n` : "") +
          `Generate a 3-7 step execution plan. Respond EXACTLY as JSON:\n` +
          `{\n  "steps": [\n    {\n      "order": number,\n      "action": "string — concrete task",\n` +
          `      "department": "string — one of: ${(playbook?.agentFocus ?? ["Engineering", "Sales", "Marketing", "Operations"]).join(", ")}",\n` +
          `      "estimatedHours": number,\n      "dependencies": number[] (order numbers this depends on)\n    }\n  ],\n` +
          `  "requiredResources": string[],\n  "riskMitigation": "string"\n}`,
      },
    ];

    const result = await routeLLM(messages, {
      complexity: "high",
      agentRole: "ProjectManager",
    });

    const parsed = parseLLMJson<{
      steps?: ExecutionStep[];
      requiredResources?: string[];
      riskMitigation?: string;
    }>(result.success ? result.completion : "", {});

    const steps = Array.isArray(parsed.steps) ? parsed.steps.filter((s) => s && typeof s.action === "string") : [];
    if (steps.length === 0) {
      return { plan: empty };
    }
    // Normalize orders + dependencies.
    steps.forEach((s, i) => {
      s.order = typeof s.order === "number" ? s.order : i + 1;
      s.estimatedHours = safeNumber(s.estimatedHours, 4);
      s.dependencies = Array.isArray(s.dependencies) ? s.dependencies : [];
    });
    const totalEstimatedHours = steps.reduce((s, st) => s + safeNumber(st.estimatedHours, 0), 0);
    const requiredResources = Array.isArray(parsed.requiredResources) ? parsed.requiredResources : [];
    const riskMitigation = typeof parsed.riskMitigation === "string" ? parsed.riskMitigation : "";

    const plan: ExecutionPlan = {
      opportunityTitle: qualifiedOpportunity.title,
      steps,
      totalEstimatedHours,
      requiredResources,
      riskMitigation,
    };

    // Persist a Task per step. Link via description [dealId:<id>].
    const dealId = (qualifiedOpportunity as FoundOpportunity & { dealId?: string }).dealId;
    const taskIds: string[] = [];
    for (const step of steps) {
      try {
        const task = await db.task.create({
          data: {
            title: `${plan.opportunityTitle} · step ${step.order}`,
            description:
              `[dealId:${dealId ?? "—"}] [industry:${qualifiedOpportunity.industryPlaybookId ?? "—"}] ` +
              `${step.action} (dept: ${step.department}, est: ${step.estimatedHours}h)`,
            status: "pending",
            priority: "high",
            kind: "work",
            dependsOn: JSON.stringify(step.dependencies),
          },
        });
        taskIds.push(task.id);
      } catch (err) {
        logger.error("autonomous-engine.plan.create-task.error", {
          step: step.order,
          error: String(err),
        });
        taskIds.push("");
      }
    }
    plan.taskIds = taskIds;

    // Create an Approval for plans with revenue > $1000.
    if (qualifiedOpportunity.estimatedRevenue > 1000) {
      try {
        const approval = await db.approval.create({
          data: {
            title: `Execution plan: ${plan.opportunityTitle}`,
            summary:
              `Revenue $${qualifiedOpportunity.estimatedRevenue.toFixed(0)} · ` +
              `${steps.length} steps · ${totalEstimatedHours}h est · dept: ${qualifiedOpportunity.department}`,
            risk: "medium",
            status: "pending",
            action: "execute-plan",
            amount: qualifiedOpportunity.estimatedRevenue,
            payload: JSON.stringify({
              opportunityTitle: plan.opportunityTitle,
              dealId,
              taskIds,
              totalEstimatedHours,
              requiredResources,
              riskMitigation,
            }),
          },
        });
        plan.approvalId = approval.id;

        // Phase 29: send the Telegram-FIRST approval brief with inline
        // keyboard buttons (Approve/Deny/Ask/Suggest). Best-effort —
        // failures are logged but do not block plan creation.
        try {
          const { requestOwnerApproval, buildApprovalRequestFromRow } = await import(
            "./owner-approval/telegram-approval"
          );
          const payload = await buildApprovalRequestFromRow(approval.id, "workflow");
          if (payload) {
            await requestOwnerApproval(payload);
          }
        } catch (tgErr) {
          logger.warn("autonomous-engine.plan.telegram-approval-failed", {
            approvalId: approval.id,
            error: String(tgErr),
          });
        }
      } catch (err) {
        logger.error("autonomous-engine.plan.create-approval.error", { error: String(err) });
      }
    }

    plan.dealId = dealId;
    return { plan };
  } catch (err) {
    logger.error("autonomous-engine.plan.error", { error: String(err) });
    return { plan: empty };
  }
}

// ─── Stage 4: EXECUTE ───────────────────────────────────────────────

export async function executePlan(
  plan: ExecutionPlan,
): Promise<{ executed: number; results: StepResult[] }> {
  const results: StepResult[] = [];
  let executed = 0;

  if (!plan.steps || plan.steps.length === 0) {
    return { executed: 0, results };
  }

  const taskIds = plan.taskIds ?? [];
  for (let i = 0; i < plan.steps.length; i++) {
    const step = plan.steps[i];
    const taskId = taskIds[i] ?? "";
    if (!taskId) {
      results.push({ order: step.order, taskId: "", status: "failed", output: "no task id" });
      continue;
    }

    try {
      // Find an agent for this department.
      let agentId: string | undefined;
      try {
        const candidates = await db.agent.findMany({
          where: {
            OR: [
              { department: step.department },
              { department: { contains: step.department } },
              { role: { contains: step.department } },
            ],
            status: { not: "offline" },
          },
          take: 5,
        });
        if (candidates.length > 0) {
          // Pick the one with the most completed tasks (deterministic).
          candidates.sort((a, b) => b.tasksDone - a.tasksDone);
          agentId = candidates[0].id;
        } else {
          const fallback = await db.agent.findFirst({
            where: { status: { not: "offline" } },
            orderBy: { tasksDone: "desc" },
          });
          agentId = fallback?.id ?? undefined;
        }
      } catch (err) {
        logger.error("autonomous-engine.execute.find-agent.error", { error: String(err) });
      }

      // Mark task in_progress.
      try {
        await db.task.update({
          where: { id: taskId },
          data: {
            status: "running",
            startedAt: new Date(),
            assignedToId: agentId ?? null,
          },
        });
      } catch (err) {
        logger.error("autonomous-engine.execute.mark-running.error", { error: String(err) });
      }

      // Generate the execution work product via LLM.
      let output = "";
      let success = false;
      try {
        const messages: ChatMsg[] = [
          {
            role: "system",
            content:
              `You are a ${step.department} agent at an autonomous AI company. ` +
              `Execute the assigned task step and produce a realistic, ready-to-ship work product.`,
          },
          {
            role: "user",
            content:
              `Project: ${plan.opportunityTitle}\n` +
              `Risk mitigation context: ${plan.riskMitigation}\n` +
              `Resources available: ${plan.requiredResources.join(", ")}\n` +
              `Task step #${step.order}: ${step.action}\n` +
              `Estimated effort: ${step.estimatedHours}h\n` +
              `Dependencies completed: ${step.dependencies.join(", ") || "none"}\n\n` +
              `Produce the concrete deliverable for this step. Be specific and actionable.`,
          },
        ];

        const result = await routeLLM(messages, {
          complexity: "medium",
          agentRole: step.department,
        });

        if (result.success && result.completion) {
          output = result.completion;
          success = true;
        } else {
          output = `Execution failed: ${result.error ?? "unknown error"}`;
        }
      } catch (err) {
        output = `Execution error: ${String(err)}`;
      }

      // Record AgentLog + finalize task.
      try {
        if (agentId || taskId) {
          await db.agentLog.create({
            data: {
              agentId: agentId ?? null,
              taskId,
              level: success ? "success" : "error",
              message: `step ${step.order}: ${step.action}`,
              meta: JSON.stringify({
                outputPreview: output.slice(0, 400),
                provider: "llm-router",
                success,
              }),
            },
          });
        }
        await db.task.update({
          where: { id: taskId },
          data: {
            status: success ? "completed" : "failed",
            result: output.slice(0, 4000),
            progress: success ? 100 : 0,
            completedAt: new Date(),
          },
        });
        if (agentId) {
          await db.agent.update({
            where: { id: agentId },
            data: { tasksDone: { increment: 1 } },
            // AUDIT-B-15: log instead of silently swallowing — a failed counter
            // increment drifts the "pick busiest agent" sort over time.
          }).catch((err) => { logger.error("autonomous-engine.agent.tasksDone-update-failed", { agentId, error: String(err) }); });
        }
      } catch (err) {
        logger.error("autonomous-engine.execute.finalize.error", { error: String(err) });
      }

      results.push({
        order: step.order,
        taskId,
        status: success ? "completed" : "failed",
        output,
        agentId,
      });
      if (success) executed++;
    } catch (err) {
      logger.error("autonomous-engine.execute.iteration.error", {
        step: step.order,
        error: String(err),
      });
      results.push({
        order: step.order,
        taskId,
        status: "failed",
        output: String(err),
      });
    }
  }

  return { executed, results };
}

// ─── Stage 5: DELIVER ───────────────────────────────────────────────

export async function deliverToClient(
  taskId: string,
): Promise<{ delivered: boolean; deliverable: string }> {
  try {
    const task = await db.task.findUnique({ where: { id: taskId } });
    if (!task) {
      return { delivered: false, deliverable: "task not found" };
    }

    // Find sibling tasks for the same project (same dealId in description).
    let siblings: typeof task[] = [task];
    const dealIdMatch = task.description?.match(/\[dealId:([^\]]+)\]/);
    if (dealIdMatch && dealIdMatch[1] && dealIdMatch[1] !== "—") {
      try {
        siblings = await db.task.findMany({
          where: { description: { contains: `[dealId:${dealIdMatch[1]}]` } },
          orderBy: { createdAt: "asc" },
        });
      } catch (err) {
        logger.error("autonomous-engine.deliver.siblings.error", { error: String(err) });
      }
    }

    const completedSteps = siblings
      .filter((t) => t.status === "completed")
      .map((t, i) => `Step ${i + 1}: ${t.title}\n${t.result ?? "(no output)"}`)
      .join("\n\n---\n\n");

    const messages: ChatMsg[] = [
      {
        role: "system",
        content:
          "You are a delivery manager. Compile completed execution-step outputs into a single " +
          "client-ready deliverable package with an executive summary, deliverables list, and next steps.",
      },
      {
        role: "user",
        content:
          `Project: ${task.title}\n\n` +
          `Completed step outputs:\n${completedSteps || "(no completed steps)"}` +
          `\n\nCompile into a polished client-ready deliverable.`,
      },
    ];

    const result = await routeLLM(messages, {
      complexity: "medium",
      agentRole: "ProjectManager",
    });

    const deliverable = result.success && result.completion
      ? result.completion
      : `# Deliverable: ${task.title}\n\n${completedSteps || "(no completed steps)"}`;

    try {
      await db.note.create({
        data: {
          title: `Deliverable: ${task.title}`,
          body: deliverable.slice(0, 16000),
          tags: JSON.stringify(["deliverable", "autonomous-cycle"]),
          authorAgent: "autonomous-business-engine",
        },
      });
    } catch (err) {
      logger.error("autonomous-engine.deliver.note.error", { error: String(err) });
    }

    try {
      await recordMilestone({
        type: "revenue-cycle",
        title: `Deliverable shipped: ${task.title}`,
        description: `Autonomous engine compiled ${siblings.length} task output(s) into a client deliverable.`,
        intensity: "normal",
      });
    } catch (err) {
      logger.error("autonomous-engine.deliver.milestone.error", { error: String(err) });
    }

    emit({
      type: "system",
      ts: nowIso(),
      message: `Deliverable compiled for: ${task.title}`,
      level: "success",
    });

    return { delivered: true, deliverable };
  } catch (err) {
    logger.error("autonomous-engine.deliver.error", { error: String(err) });
    return { delivered: false, deliverable: String(err) };
  }
}

// ─── Stage 6: INVOICE ───────────────────────────────────────────────

export async function generateInvoice(
  dealId: string,
): Promise<{ invoice: InvoiceData }> {
  const empty: InvoiceData = {
    number: `INV-${Date.now().toString(36).toUpperCase()}`,
    dealId,
    amount: 0,
    currency: "USD",
    lineItems: [],
    dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    status: "pending",
  };

  try {
    const deal = await db.deal.findUnique({ where: { id: dealId } });
    if (!deal) {
      return { invoice: empty };
    }

    // The Deal model has no tax field — always apply 18%.
    const subtotal = deal.value;
    const taxRate = 0.18;
    const tax = subtotal * taxRate;
    const total = subtotal + tax;

    const invoice: InvoiceData = {
      number: `INV-${deal.id.slice(-6).toUpperCase()}-${Date.now().toString(36).toUpperCase().slice(-4)}`,
      dealId: deal.id,
      amount: Math.round(total * 100) / 100,
      currency: deal.currency,
      lineItems: [
        {
          description: deal.title,
          quantity: 1,
          unitPrice: Math.round(subtotal * 100) / 100,
          total: Math.round(subtotal * 100) / 100,
        },
        {
          description: "Tax (18%)",
          quantity: 1,
          unitPrice: Math.round(tax * 100) / 100,
          total: Math.round(tax * 100) / 100,
        },
      ],
      dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      status: "pending",
    };

    try {
      const note = await db.note.create({
        data: {
          title: `Invoice: ${invoice.number}`,
          body: JSON.stringify(invoice, null, 2),
          tags: JSON.stringify(["invoice", "autonomous-cycle"]),
          authorAgent: "autonomous-business-engine",
        },
      });
      invoice.noteId = note.id;
    } catch (err) {
      logger.error("autonomous-engine.invoice.note.error", { error: String(err) });
    }

    // If the deal was won, recognize the revenue.
    if (deal.stage === "won") {
      try {
        await db.revenueEvent.create({
          data: {
            source: "services",
            amount: invoice.amount,
            currency: invoice.currency,
            dealId: deal.id,
            description: `Invoice ${invoice.number} — ${deal.title}`,
          },
        });
        emit({
          type: "revenue",
          ts: nowIso(),
          event: {
            id: "ephemeral",
            source: "services",
            amount: invoice.amount,
            currency: invoice.currency,
            agentId: null,
            dealId: deal.id,
            description: `Invoice ${invoice.number}`,
            createdAt: nowIso(),
          } as never,
        });
      } catch (err) {
        logger.error("autonomous-engine.invoice.revenue.error", { error: String(err) });
      }
    }

    emit({
      type: "system",
      ts: nowIso(),
      message: `Invoice ${invoice.number} generated for ${invoice.amount} ${invoice.currency}`,
      level: "success",
    });

    return { invoice };
  } catch (err) {
    logger.error("autonomous-engine.invoice.error", { error: String(err) });
    return { invoice: empty };
  }
}

// ─── Stage 7: TRACK ─────────────────────────────────────────────────

export async function trackProgress(
  dealId: string,
): Promise<{
  status: string;
  metrics: {
    completionRate: number;
    revenueRecognized: number;
    daysInProgress: number;
    healthScore: number;
  };
}> {
  try {
    const deal = await db.deal.findUnique({ where: { id: dealId } });
    if (!deal) {
      return {
        status: "unknown",
        metrics: { completionRate: 0, revenueRecognized: 0, daysInProgress: 0, healthScore: 0 },
      };
    }

    // Find tasks for this deal (by description marker).
    const tasks = await db.task.findMany({
      where: { description: { contains: `[dealId:${dealId}]` } },
    });
    const total = tasks.length;
    const completed = tasks.filter((t) => t.status === "completed").length;
    const failed = tasks.filter((t) => t.status === "failed").length;
    const completionRate = total > 0 ? completed / total : 0;

    // Revenue recognized against this deal.
    const revenueRows = await db.revenueEvent.findMany({
      where: { dealId },
    });
    const revenueRecognized = revenueRows.reduce((s, r) => s + r.amount, 0);

    const daysInProgress = Math.max(
      0,
      Math.floor((Date.now() - deal.createdAt.getTime()) / (24 * 60 * 60 * 1000)),
    );

    // Health score: weighted blend of completion, deal stage progress,
    // revenue recognition vs deal value, and absence of failures.
    const stageWeights: Record<string, number> = {
      lead: 0.1,
      qualified: 0.25,
      proposal: 0.45,
      negotiation: 0.65,
      won: 1,
      lost: 0,
    };
    const stageWeight = stageWeights[deal.stage] ?? 0.2;
    const revenueRatio = deal.value > 0 ? Math.min(1, revenueRecognized / deal.value) : 0;
    const failPenalty = total > 0 ? failed / total : 0;
    const healthScore = clamp01(
      completionRate * 0.4 + stageWeight * 0.3 + revenueRatio * 0.2 + (1 - failPenalty) * 0.1,
    );

    // Throttled KPI snapshot — only if last one is >6h old.
    try {
      const lastSnap = await db.kpiSnapshot.findFirst({
        orderBy: { createdAt: "desc" },
      });
      const sixHoursAgo = Date.now() - 6 * 60 * 60 * 1000;
      if (!lastSnap || lastSnap.createdAt.getTime() < sixHoursAgo) {
        await db.kpiSnapshot.create({
          data: {
            revenue: revenueRecognized,
            tasksDone: completed,
            agentsActive: 0,
            payments: 0,
            leads: deal.stage === "lead" ? 1 : 0,
            customers: deal.stage === "won" ? 1 : 0,
            payload: JSON.stringify({
              source: "autonomous-business-engine.trackProgress",
              dealId,
              completionRate,
              healthScore,
              daysInProgress,
            }),
          },
        });
      }
    } catch (err) {
      logger.error("autonomous-engine.track.snapshot.error", { error: String(err) });
    }

    return {
      status: deal.stage,
      metrics: {
        completionRate: Math.round(completionRate * 100) / 100,
        revenueRecognized,
        daysInProgress,
        healthScore: Math.round(healthScore * 100) / 100,
      },
    };
  } catch (err) {
    logger.error("autonomous-engine.track.error", { error: String(err) });
    return {
      status: "error",
      metrics: { completionRate: 0, revenueRecognized: 0, daysInProgress: 0, healthScore: 0 },
    };
  }
}

// ─── Stage 8: OPTIMIZE ──────────────────────────────────────────────

export async function optimizePerformance(
  dealId: string,
): Promise<{ recommendations: string[]; appliedOptimizations: string[] }> {
  try {
    const deal = await db.deal.findUnique({ where: { id: dealId } });
    if (!deal) {
      return { recommendations: [], appliedOptimizations: [] };
    }

    const tracking = await trackProgress(dealId);
    const tasks = await db.task.findMany({
      where: { description: { contains: `[dealId:${dealId}]` } },
    });

    const summary = {
      deal: { title: deal.title, value: deal.value, stage: deal.stage, source: deal.source },
      tracking: tracking.metrics,
      tasks: tasks.map((t) => ({
        title: t.title,
        status: t.status,
        progress: t.progress,
        result: (t.result ?? "").slice(0, 200),
      })),
    };

    const messages: ChatMsg[] = [
      {
        role: "system",
        content:
          "You are a continuous-improvement analyst. Given deal progress data, generate " +
          "specific, actionable optimization recommendations. Respond with strict JSON — no markdown.",
      },
      {
        role: "user",
        content:
          `Deal progress summary:\n${JSON.stringify(summary, null, 2)}\n\n` +
          `Generate 3 to 5 specific optimization recommendations. Respond EXACTLY as JSON:\n` +
          `{\n  "recommendations": ["string", ...],\n  "appliedOptimizations": ["string", ...]\n}`,
      },
    ];

    const result = await routeLLM(messages, {
      complexity: "high",
      agentRole: "DataAnalyst",
    });

    const parsed = parseLLMJson<{
      recommendations?: string[];
      appliedOptimizations?: string[];
    }>(result.success ? result.completion : "", {});

    const recommendations = Array.isArray(parsed.recommendations)
      ? parsed.recommendations.filter((r) => typeof r === "string" && r.length > 0).slice(0, 3)
      : [];
    const appliedOptimizations = Array.isArray(parsed.appliedOptimizations)
      ? parsed.appliedOptimizations.filter((r) => typeof r === "string" && r.length > 0)
      : [];

    // Persist as a MemoryItem under the "optimization" scope.
    try {
      await db.memoryItem.create({
        data: {
          key: `optimization:deal:${dealId}:${Date.now()}`,
          scope: "optimization",
          value: JSON.stringify({
            dealId,
            dealTitle: deal.title,
            recommendations,
            appliedOptimizations,
            healthScore: tracking.metrics.healthScore,
            completionRate: tracking.metrics.completionRate,
          }),
          tags: JSON.stringify(["autonomous-cycle", "optimization"]),
          pinned: false,
          strength: tracking.metrics.healthScore,
        },
      });
    } catch (err) {
      logger.error("autonomous-engine.optimize.memory.error", { error: String(err) });
    }

    return { recommendations, appliedOptimizations };
  } catch (err) {
    logger.error("autonomous-engine.optimize.error", { error: String(err) });
    return { recommendations: [], appliedOptimizations: [] };
  }
}

// ─── Orchestrator: runAutonomousCycle ───────────────────────────────

export async function runAutonomousCycle(
  industryPlaybookId: string,
): Promise<CycleResult> {
  const startedAt = nowIso();
  const result: CycleResult = {
    industryPlaybookId,
    found: 0,
    qualified: 0,
    planned: 0,
    executed: 0,
    delivered: 0,
    invoiced: 0,
    tracked: 0,
    optimized: 0,
    revenueGenerated: 0,
    errors: [],
    startedAt,
    completedAt: startedAt,
  };

  const playbook = getPlaybook(industryPlaybookId);
  if (!playbook) {
    result.errors.push(`unknown playbook: ${industryPlaybookId}`);
    result.completedAt = nowIso();
    return result;
  }

  emit({
    type: "system",
    ts: nowIso(),
    message: `Autonomous cycle started — industry: ${playbook.name}`,
    level: "info",
  });

  // 1. FIND
  let opportunities: FoundOpportunity[] = [];
  try {
    const findResult = await findOpportunities(industryPlaybookId);
    opportunities = findResult.opportunities;
    result.found = findResult.found;
  } catch (err) {
    result.errors.push(`FIND: ${String(err)}`);
    logger.error("autonomous-engine.cycle.find.error", { error: String(err) });
  }

  // 2. QUALIFY
  let qualified: FoundOpportunity[] = [];
  try {
    const qualifyResult = await qualifyOpportunities(opportunities);
    qualified = qualifyResult.qualified;
    result.qualified = qualified.length;
  } catch (err) {
    result.errors.push(`QUALIFY: ${String(err)}`);
    logger.error("autonomous-engine.cycle.qualify.error", { error: String(err) });
  }

  // 3. PLAN + 4. EXECUTE + 5. DELIVER + 6. INVOICE + 7. TRACK + 8. OPTIMIZE
  // Run for the first qualified opportunity (representative cycle).
  if (qualified.length > 0) {
    const opp = qualified[0];

    // 3. PLAN
    let plan: ExecutionPlan | null = null;
    try {
      const planResult = await planExecution(opp);
      plan = planResult.plan;
      if (plan && plan.steps.length > 0) {
        result.planned = 1;
      }
    } catch (err) {
      result.errors.push(`PLAN: ${String(err)}`);
      logger.error("autonomous-engine.cycle.plan.error", { error: String(err) });
    }

    // 3.5 HIGH-VALUE APPROVAL GATE — if estimatedRevenue > $10,000,
    // create a critical-risk Approval and pause execution until the
    // owner approves. The cycle completes PLAN but skips EXECUTE.
    const HIGH_VALUE_THRESHOLD = 10_000;
    if (opp.estimatedRevenue > HIGH_VALUE_THRESHOLD) {
      try {
        const existingApproval = await db.approval.findFirst({
          where: {
            title: { startsWith: `High-Value Cycle Gate: ${opp.title}` },
            status: "pending",
          },
        });
        if (!existingApproval) {
          await db.approval.create({
            data: {
              title: `High-Value Cycle Gate: ${opp.title}`,
              summary: `Autonomous cycle paused — opportunity estimated at $${opp.estimatedRevenue.toFixed(0)} exceeds the $${HIGH_VALUE_THRESHOLD} high-value threshold. Owner approval required before execution.`,
              risk: "critical",
              status: "pending",
              requester: "autonomous-business-engine",
              action: "execute-high-value-cycle",
              amount: opp.estimatedRevenue,
              payload: JSON.stringify({
                industryPlaybookId,
                opportunityTitle: opp.title,
                estimatedRevenue: opp.estimatedRevenue,
                planSteps: plan?.steps.length ?? 0,
              }),
            },
          });
          emit({
            type: "system",
            ts: nowIso(),
            message: `High-value approval required for "${opp.title}" ($${opp.estimatedRevenue.toFixed(0)}) — cycle paused at PLAN stage`,
            level: "warn",
          });
          logger.warn("autonomous-engine.high-value-gate", {
            opportunity: opp.title,
            estimatedRevenue: opp.estimatedRevenue,
          });
        }
        // Skip EXECUTE and downstream stages — cycle is paused.
        result.errors.push(`HIGH-VALUE GATE: $${opp.estimatedRevenue.toFixed(0)} > $${HIGH_VALUE_THRESHOLD} threshold — owner approval required before execution`);
        result.completedAt = nowIso();
        return result;
      } catch (err) {
        logger.error("autonomous-engine.high-value-gate.error", { error: String(err) });
        // Non-fatal — continue execution if approval creation fails
      }
    }

    // 4. EXECUTE
    if (plan && plan.steps.length > 0) {
      try {
        const execResult = await executePlan(plan);
        result.executed = execResult.executed;

        // 5. DELIVER (first completed task)
        const firstCompleted = execResult.results.find((r) => r.status === "completed");
        if (firstCompleted) {
          try {
            const deliverResult = await deliverToClient(firstCompleted.taskId);
            result.delivered = deliverResult.delivered ? 1 : 0;
          } catch (err) {
            result.errors.push(`DELIVER: ${String(err)}`);
            logger.error("autonomous-engine.cycle.deliver.error", { error: String(err) });
          }
        }
      } catch (err) {
        result.errors.push(`EXECUTE: ${String(err)}`);
        logger.error("autonomous-engine.cycle.execute.error", { error: String(err) });
      }
    }

    // 6. INVOICE
    const dealId = (opp as FoundOpportunity & { dealId?: string }).dealId;
    if (dealId) {
      try {
        const invoiceResult = await generateInvoice(dealId);
        result.invoiced = invoiceResult.invoice.amount > 0 ? 1 : 0;
        result.revenueGenerated = invoiceResult.invoice.amount;
      } catch (err) {
        result.errors.push(`INVOICE: ${String(err)}`);
        logger.error("autonomous-engine.cycle.invoice.error", { error: String(err) });
      }

      // 7. TRACK
      try {
        const trackResult = await trackProgress(dealId);
        result.tracked = 1;
        // 8. OPTIMIZE
        try {
          const optResult = await optimizePerformance(dealId);
          result.optimized = optResult.recommendations.length > 0 ? 1 : 0;
        } catch (err) {
          result.errors.push(`OPTIMIZE: ${String(err)}`);
          logger.error("autonomous-engine.cycle.optimize.error", { error: String(err) });
        }
        void trackResult;
      } catch (err) {
        result.errors.push(`TRACK: ${String(err)}`);
        logger.error("autonomous-engine.cycle.track.error", { error: String(err) });
      }
    }
  }

  result.completedAt = nowIso();

  // Emit a milestone event for cycle completion.
  try {
    await recordMilestone({
      type: "revenue-cycle",
      title: `Autonomous cycle complete — ${playbook.name}`,
      description:
        `Found ${result.found} · Qualified ${result.qualified} · Planned ${result.planned} · ` +
        `Executed ${result.executed} · Invoiced ${result.invoiced} · Revenue $${result.revenueGenerated.toFixed(0)}` +
        (result.errors.length > 0 ? ` · ${result.errors.length} error(s)` : ""),
      intensity: result.errors.length === 0 ? "normal" : "subtle",
    });
  } catch (err) {
    logger.error("autonomous-engine.cycle.milestone.error", { error: String(err) });
  }

  emit({
    type: "system",
    ts: nowIso(),
    message:
      `Autonomous cycle complete — ${playbook.name} — ` +
      `${result.found}/${result.qualified}/${result.executed} (find/qualify/exec)` +
      (result.errors.length > 0 ? ` · ${result.errors.length} errors` : ""),
    level: result.errors.length === 0 ? "success" : "warn",
  });

  logger.success("autonomous-engine.cycle.complete", {
    industryPlaybookId,
    found: result.found,
    qualified: result.qualified,
    executed: result.executed,
    revenueGenerated: result.revenueGenerated,
    errors: result.errors.length,
  });

  return result;
}

// ─── Lifecycle pipeline snapshot (for the dashboard panel) ──────────

export interface LifecycleStage {
  id: string;
  name: string;
  description: string;
  count: number;
}

export async function getLifecyclePipeline(): Promise<{
  stages: LifecycleStage[];
}> {
  const stages: LifecycleStage[] = [
    {
      id: "find",
      name: "FIND",
      description: "Scan industry playbook + DB for fresh earning opportunities",
      count: 0,
    },
    {
      id: "qualify",
      name: "QUALIFY",
      description: "LLM-scored on market demand, competition, complexity, margin",
      count: 0,
    },
    {
      id: "plan",
      name: "PLAN",
      description: "Generate execution steps, create Tasks + Approval (>$1000)",
      count: 0,
    },
    {
      id: "execute",
      name: "EXECUTE",
      description: "Assign agents by department; LLM produces work products",
      count: 0,
    },
    {
      id: "deliver",
      name: "DELIVER",
      description: "Compile completed steps into client-ready deliverable Note",
      count: 0,
    },
    {
      id: "invoice",
      name: "INVOICE",
      description: "Generate invoice (+18% tax) and emit RevenueEvent for won deals",
      count: 0,
    },
    {
      id: "track",
      name: "TRACK",
      description: "Compute completion / revenue / health, throttled KPI snapshot",
      count: 0,
    },
    {
      id: "optimize",
      name: "OPTIMIZE",
      description: "LLM recommendations persisted as optimization MemoryItems",
      count: 0,
    },
  ];

  try {
    const [discovered, qualified, dealsLead, tasksRunning, tasksCompleted, deliverableNotes, invoiceNotes, revenueEvents, optMemories] =
      await Promise.all([
        db.earningOpportunity.count({ where: { status: "discovered" } }),
        db.earningOpportunity.count({ where: { status: "qualified" } }),
        db.deal.count({ where: { stage: "lead" } }),
        db.task.count({ where: { status: "running" } }),
        db.task.count({ where: { status: "completed" } }),
        db.note.count({ where: { title: { startsWith: "Deliverable:" } } }),
        db.note.count({ where: { title: { startsWith: "Invoice:" } } }),
        db.revenueEvent.count(),
        db.memoryItem.count({ where: { scope: "optimization" } }),
      ]);

    stages[0].count = discovered; // FIND
    stages[1].count = qualified; // QUALIFY
    stages[2].count = dealsLead; // PLAN
    stages[3].count = tasksRunning + tasksCompleted; // EXECUTE
    stages[4].count = deliverableNotes; // DELIVER
    stages[5].count = invoiceNotes; // INVOICE
    stages[6].count = revenueEvents; // TRACK
    stages[7].count = optMemories; // OPTIMIZE
  } catch (err) {
    logger.error("autonomous-engine.pipeline.error", { error: String(err) });
  }

  return { stages };
}
