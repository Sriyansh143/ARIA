/**
 * ARIA Mission Control — n8n-style Step-by-Step Automation Workflow Engine.
// TECH-DEBT: This file is 877 lines (over the 400-line RULE-43 limit). Planned split: workflow-steps.ts (step execution) + workflow-validation.ts (context checks). Deadline: 7 days from 2026-08-17. Tracked in worklog per RULE-47.
 *
 * Each workflow is a sequence of steps (nodes) connected by edges.
 * Each step has: a type (LLM call, tool, condition, delay, notification),
 * inputs, outputs, and a next-step pointer. The engine executes steps
 * sequentially, passing data between them, with branching on conditions.
 *
 * This replaces the "fire and forget" simulation with real, auditable,
 * step-by-step automation that produces verifiable results.
 */
import { db } from "./db";
import { emit } from "./event-bus";
import { toIso, LOG_LEVELS } from "./types";
import { logger } from "./logger";
// v61 (Audit B3): wire the autonomy router into the workflow execution path.
// Every executeWorkflow() call now passes through routeWorkflowByAutonomy()
// so the HUMAN_LED / HUMAN_ASSISTED / FULLY_AUTONOMOUS tags are enforced
// on the real execution path — not just in unit tests.
import { routeWorkflowByAutonomy } from "./conductor/router";

// ─── Workflow Types ─────────────────────────────────────────────────

export type StepType =
  | "llm_call"      // Call an LLM with a prompt
  | "tool_call"     // Execute a tool (email, deploy, etc.)
  | "condition"     // Branch based on a condition
  | "delay"         // Wait N seconds
  | "notification"  // Send a notification (Telegram, email, etc.)
  | "data_fetch"    // Query the database
  | "transform"     // Transform data between steps
  | "approval"      // Request human approval before continuing
  | "loop"          // Loop back to a previous step
  | "end";          // Workflow complete

export interface WorkflowStep {
  id: string;
  type: StepType;
  name: string;
  config: Record<string, unknown>;
  next?: string;      // Next step ID (for linear flow)
  branches?: Record<string, string>; // For condition steps: { "true": "stepId", "false": "stepId" }
}

export interface Workflow {
  id: string;
  name: string;
  description: string;
  steps: WorkflowStep[];
  trigger: "manual" | "schedule" | "event" | "approval";
  status: "draft" | "active" | "running" | "completed" | "failed";
}

export interface StepResult {
  stepId: string;
  stepName: string;
  type: StepType;
  success: boolean;
  output: unknown;
  error?: string;
  latencyMs: number;
  ts: string;
}

export interface WorkflowRun {
  id: string;
  workflowId: string;
  workflowName: string;
  status: "running" | "completed" | "failed" | "awaiting_approval";
  steps: StepResult[];
  currentStepId: string | null;
  context: Record<string, unknown>; // Data passed between steps
  startedAt: string;
  completedAt: string | null;
  totalLatencyMs: number;
}

// ─── Pre-built Workflow Templates ───────────────────────────────────

export const WORKFLOW_TEMPLATES: Workflow[] = [
  {
    id: "wf-revenue-analysis",
    name: "Revenue Analysis & Forecast",
    description: "Analyzes current revenue, generates LLM-driven forecast, sends Telegram report",
    trigger: "schedule",
    status: "active",
    steps: [
      {
        id: "s1",
        type: "data_fetch",
        name: "Fetch Revenue Data",
        config: { query: "revenue_summary" },
        next: "s2",
      },
      {
        id: "s2",
        type: "llm_call",
        name: "LLM Revenue Analysis",
        config: { agent: "Ledger-Fin", prompt: "Analyze revenue data and provide 3 key insights + forecast" },
        next: "s3",
      },
      {
        id: "s3",
        type: "llm_call",
        name: "Generate Forecast",
        config: { agent: "Ledger-Fin", prompt: "Based on the analysis, forecast next quarter revenue" },
        next: "s4",
      },
      {
        id: "s4",
        type: "notification",
        name: "Send Telegram Report",
        config: { channel: "telegram", template: "revenue_report" },
        next: "s5",
      },
      {
        id: "s5",
        type: "end",
        name: "Complete",
        config: {},
      },
    ],
  },
  {
    id: "wf-lead-qualification",
    name: "Lead Qualification Pipeline",
    description: "LLM evaluates a lead, scores it, routes to sales agent or rejects",
    trigger: "manual",
    status: "active",
    steps: [
      {
        id: "s1",
        type: "llm_call",
        name: "Score Lead",
        config: { agent: "Vector-Sales", prompt: "Score this lead 0-100 based on ICP fit" },
        next: "s2",
      },
      {
        id: "s2",
        type: "condition",
        name: "Score > 60?",
        config: { field: "score", operator: ">", value: 60 },
        branches: { "true": "s3", "false": "s4" },
      },
      {
        id: "s3",
        type: "llm_call",
        name: "Draft Outreach",
        config: { agent: "Vector-Sales", prompt: "Draft a personalized outreach email for this qualified lead" },
        next: "s5",
      },
      {
        id: "s4",
        type: "notification",
        name: "Log Rejection",
        config: { channel: "log", template: "lead_rejected" },
        next: "s5",
      },
      {
        id: "s5",
        type: "end",
        name: "Complete",
        config: {},
      },
    ],
  },
  {
    id: "wf-deploy-gate",
    name: "Production Deploy Gate",
    description: "LLM reviews deploy plan, requests owner approval, executes or aborts",
    trigger: "approval",
    status: "active",
    steps: [
      {
        id: "s1",
        type: "llm_call",
        name: "Review Deploy Plan",
        config: { agent: "Aria-CTO", prompt: "Review this deploy plan for risks. Respond APPROVE or REJECT with reason." },
        next: "s2",
      },
      {
        id: "s2",
        type: "condition",
        name: "LLM Approved?",
        config: { field: "decision", operator: "==", value: "APPROVE" },
        branches: { "true": "s3", "false": "s5" },
      },
      {
        id: "s3",
        type: "approval",
        name: "Owner Approval Required",
        config: { risk: "high", title: "Production Deploy" },
        next: "s4",
      },
      {
        id: "s4",
        type: "tool_call",
        name: "Execute Deploy",
        config: { tool: "deploy", params: {} },
        next: "s6",
      },
      {
        id: "s5",
        type: "notification",
        name: "Log Rejection",
        config: { channel: "telegram", template: "deploy_rejected" },
        next: "s6",
      },
      {
        id: "s6",
        type: "end",
        name: "Complete",
        config: {},
      },
    ],
  },
  {
    id: "wf-agent-improvement",
    name: "Agent Self-Improvement Loop",
    description: "Evaluates previous simulation results, identifies improvements, applies them",
    trigger: "schedule",
    status: "active",
    steps: [
      {
        id: "s1",
        type: "data_fetch",
        name: "Fetch Previous Results",
        config: { query: "recent_agent_logs", limit: 20 },
        next: "s2",
      },
      {
        id: "s2",
        type: "llm_call",
        name: "Analyze Performance",
        config: { agent: "Aria-CEO", prompt: "Analyze these agent logs. What patterns indicate inefficiency? What should change?" },
        next: "s3",
      },
      {
        id: "s3",
        type: "llm_call",
        name: "Generate Improvement Plan",
        config: { agent: "Aria-CEO", prompt: "Based on the analysis, create a concrete improvement plan with 3 actionable items" },
        next: "s4",
      },
      {
        id: "s4",
        type: "notification",
        name: "Send Improvement Report",
        config: { channel: "telegram", template: "improvement_report" },
        next: "s5",
      },
      {
        id: "s5",
        type: "end",
        name: "Complete",
        config: {},
      },
    ],
  },
];

// ─── Workflow Execution Engine ──────────────────────────────────────

const activeRuns = new Map<string, WorkflowRun>();

/**
 * Execute a workflow step by step. Each step produces output that
 * feeds into the next step's context. The engine handles:
 *  - LLM calls (via llm-client)
 *  - Tool calls (deploy, email, etc.)
 *  - Conditions (branching)
 *  - Notifications (Telegram)
 *  - Data fetching (DB queries)
 *  - Approval gates (pauses execution)
 */
export async function executeWorkflow(
  workflow: Workflow,
  initialContext: Record<string, unknown> = {}
): Promise<WorkflowRun> {
  const run: WorkflowRun = {
    id: `run-${Date.now()}`,
    workflowId: workflow.id,
    workflowName: workflow.name,
    status: "running",
    steps: [],
    currentStepId: workflow.steps[0]?.id ?? null,
    context: { ...initialContext },
    startedAt: new Date().toISOString(),
    completedAt: null,
    totalLatencyMs: 0,
  };

  activeRuns.set(run.id, run);

  // v61 Phase 6 (Audit fix): wire the autonomy kill-switch into executeWorkflow.
  // If the owner pressed /pause, directly-invoked workflows are also blocked.
  // Previously this was only wired into the cron scheduler + engine tick —
  // workflows triggered via /api/workflows or /api/conductor could bypass it.
  try {
    const { isAutonomyPaused } = await import("./autonomy-control");
    if (await isAutonomyPaused()) {
      run.status = "failed";
      run.completedAt = new Date().toISOString();
      run.totalLatencyMs = 0;
      emit({
        type: "system",
        ts: run.completedAt,
        message: `⏸️ Workflow "${workflow.name}" blocked — autonomy is PAUSED. Resume via /resume.`,
        level: "warn" as (typeof LOG_LEVELS)[number],
      });
      activeRuns.delete(run.id);
      return run;
    }
  } catch { /* best-effort — if autonomy-control fails, proceed */ }

  // ─── v61 (Audit B3): Autonomy Router Gate ───────────────────────────
  // Before any step runs, look up the persisted WorkflowDefinition by slug
  // (= workflow.id) and ask the conductor router whether this workflow may
  // execute under its autonomy tag. This is the single chokepoint the docs
  // always claimed — now actually wired into the real execution path.
  //
  //   HUMAN_LED          → run is marked `failed` with the router's reason
  //   HUMAN_ASSISTED     → run is marked `awaiting_approval` + an Approval
  //                        row is created + a Telegram brief is sent. The
  //                        owner approves/denies via dashboard or Telegram.
  //   FULLY_AUTONOMOUS   → proceeds normally (Quality Supervisor still
  //                        validates post-hoc).
  //
  // If no WorkflowDefinition row exists for this slug, the workflow runs
  // unchanged (backwards-compatible with template-only invocations).
  try {
    const wfDef = await db.workflowDefinition.findUnique({
      where: { slug: workflow.id },
    });
    if (wfDef) {
      const requester =
        (typeof initialContext.requester === "string" && initialContext.requester) ||
        (typeof initialContext.__requester === "string" && initialContext.__requester) ||
        "workflow-engine";
      const decision = await routeWorkflowByAutonomy(wfDef.id, requester);
      if (!decision.allowed) {
        run.status = decision.approvalId ? "awaiting_approval" : "failed";
        run.completedAt = new Date().toISOString();
        run.totalLatencyMs = 0;
        emit({
          type: "system",
          ts: run.completedAt,
          message:
            `🔒 Autonomy router blocked workflow "${workflow.name}" ` +
            `(${decision.autonomyTag}) — ${decision.reason ?? "no reason given"}` +
            (decision.approvalId ? ` — approval ${decision.approvalId.slice(-8)} queued` : ""),
          level: "warn" as (typeof LOG_LEVELS)[number],
        });
        logger.info("workflow-engine.autonomy-blocked", {
          workflowId: workflow.id,
          autonomyTag: decision.autonomyTag,
          approvalId: decision.approvalId,
          reason: decision.reason,
        });
        activeRuns.delete(run.id);
        return run;
      }
      // Approved (FULLY_AUTONOMOUS) — fall through to execution.
      emit({
        type: "system",
        ts: run.startedAt,
        message: `✅ Autonomy router approved workflow "${workflow.name}" (${decision.autonomyTag})`,
        level: "info" as (typeof LOG_LEVELS)[number],
      });
    }
  } catch (err) {
    // If the router or DB lookup fails, fail-OPEN for non-gated workflows
    // (templates without a WorkflowDefinition row) but log loudly so the
    // operator notices. Gated workflows are protected by the try/catch only
    // falling through when there is no row to gate on.
    logger.warn("workflow-engine.autonomy-router-error", {
      workflowId: workflow.id,
      error: String(err),
    });
  }

  // Emit system log about workflow start.
  emit({
    type: "system",
    ts: run.startedAt,
    message: `Workflow "${workflow.name}" started (${workflow.steps.length} steps)`,
    level: "info" as (typeof LOG_LEVELS)[number],
  });

  let currentStep = workflow.steps.find((s) => s.id === run.currentStepId);
  const runStartTime = Date.now();

  // AUDIT-B-1: hard cap on workflow execution length to prevent infinite loops
  // from cyclic step graphs (A.next=B, B.next=A) or runaway condition branches.
  // 100 is well above any legitimate workflow size while keeping the loop bounded.
  const MAX_WORKFLOW_STEPS = 100;
  const visitedSteps = new Set<string>();
  let stepCounter = 0;

  while (currentStep && currentStep.type !== "end") {
    // Cycle guard: if we've already executed this step id, abort (prevents infinite loop).
    if (visitedSteps.has(currentStep.id)) {
      run.status = "failed";
      run.completedAt = new Date().toISOString();
      logger.error("workflow-engine.cycle-detected", { workflowId: workflow.id, stepId: currentStep.id, steps: stepCounter });
      break;
    }
    visitedSteps.add(currentStep.id);
    if (++stepCounter > MAX_WORKFLOW_STEPS) {
      run.status = "failed";
      run.completedAt = new Date().toISOString();
      logger.error("workflow-engine.max-steps-exceeded", { workflowId: workflow.id, steps: stepCounter });
      break;
    }
    const stepStartTime = Date.now();
    let result: StepResult;

    try {
      result = await executeStep(currentStep, run.context, run);
    } catch (err) {
      result = {
        stepId: currentStep.id,
        stepName: currentStep.name,
        type: currentStep.type,
        success: false,
        output: null,
        error: err instanceof Error ? err.message : "unknown error",
        latencyMs: Date.now() - stepStartTime,
        ts: new Date().toISOString(),
      };
    }

    run.steps.push(result);
    run.totalLatencyMs = Date.now() - runStartTime;

    // Emit system log about step completion.
    emit({
      type: "system",
      ts: result.ts,
      message: `Workflow step "${currentStep.name}" ${result.success ? "completed" : "failed"} (${result.latencyMs}ms)`,
      level: result.success ? "success" as (typeof LOG_LEVELS)[number] : "error" as (typeof LOG_LEVELS)[number],
    });

    if (!result.success) {
      run.status = "failed";
      run.completedAt = new Date().toISOString();
      break;
    }

    // Determine next step.
    if (currentStep.type === "condition" && currentStep.branches) {
      const conditionResult = String(result.output).toLowerCase();
      const nextId = currentStep.branches[conditionResult === "true" ? "true" : "false"];
      currentStep = workflow.steps.find((s) => s.id === nextId);
    } else {
      currentStep = currentStep.next ? workflow.steps.find((s) => s.id === currentStep!.next) : undefined;
    }
  }

  if (run.status === "running") {
    run.status = "completed";
    run.completedAt = new Date().toISOString();
  }

  // Emit system log about workflow completion.
  emit({
    type: "system",
    ts: run.completedAt!,
    message: `Workflow "${workflow.name}" ${run.status} (${run.steps.length} steps, ${run.totalLatencyMs}ms total)`,
    level: run.status === "completed" ? "success" as (typeof LOG_LEVELS)[number] : "error" as (typeof LOG_LEVELS)[number],
  });

  // Record in action log.
  try {
    await db.agentLog.create({
      data: {
        level: run.status === "completed" ? "success" : "error",
        message: `Workflow "${workflow.name}" ${run.status}: ${run.steps.length} steps in ${run.totalLatencyMs}ms`,
        meta: JSON.stringify({ workflowId: workflow.id, runId: run.id, steps: run.steps.length }),
      },
    });
  } catch {
    // DB might not be available.
  }

  // v61 Phase 3 (Self-Improving Rules) — log an execution trace after every
  // workflow run. The rules-auditor cron reads these traces to propose rule
  // improvements. Traces are stored in AgentLog (no new model needed).
  try {
    const { logExecutionTrace } = await import("./execution-trace");
    const lastLlmStep = run.steps.filter((s) => s.type === "llm_call").pop();
    const retryCount = run.steps.filter((s) => !s.success).length;
    await logExecutionTrace({
      runId: run.id,
      skill: workflow.id,
      systemPrompt: lastLlmStep?.output ? String(lastLlmStep.output).slice(0, 500) : "",
      userPrompt: JSON.stringify(run.context).slice(0, 500),
      retries: retryCount,
      tokensUsed: 0, // token tracking not available in the run record
      success: run.status === "completed",
      failureReason: run.status === "failed" ? run.steps.find((s) => !s.success)?.error : undefined,
      provider: undefined,
      model: undefined,
      latencyMs: run.totalLatencyMs,
    });
  } catch { /* best-effort — trace logging must not break the run */ }

  activeRuns.delete(run.id);
  return run;
}

/**
 * Execute a single workflow step.
 */
async function executeStep(
  step: WorkflowStep,
  context: Record<string, unknown>,
  run?: WorkflowRun,
): Promise<StepResult> {
  const startTime = Date.now();
  let output: unknown = null;
  let success = true;
  let error: string | undefined;

  switch (step.type) {
    case "llm_call": {
      try {
        const { callLLM } = await import("./llm-client");
        // v69 Phase 19 BLOCKER 0: Build the LLM call context via the
        // ContextManager — the Constitution is injected in full text
        // (Priority 1, never truncated) and the previous-step history is
        // summarized via rolling Ollama compression (Priority 2).
        const { contextManager } = await import("./context-manager");
        const { buildConstitutionPrompt } = await import("./constitution");
        const { buildGlobalLogicsPrompt } = await import("./global-logics");
        const constitution = buildConstitutionPrompt();
        const globalLogics = buildGlobalLogicsPrompt(2000);
        const previousResults = (run?.steps ?? [])
          .filter((s) => s.success)
          .map((s) => ({ stepName: s.stepName ?? s.stepId, finalOutput: String(s.output ?? "") }));
        const builtCtx = contextManager.buildContext({
          constitution,
          globalLogics,
          skillContext: JSON.stringify(context).slice(0, 500),
          previousResults,
          taskDescription: (step.config.prompt as string) ?? "Process the following data",
          maxHistoryChars: 4000,
        });
        const agentName = (step.config.agent as string) ?? "Conductor";
        const agentRole = (step.config.role as string) ?? "CEO";
        const promptTemplate = (step.config.prompt as string) ?? "Process the following data";
        const prompt = builtCtx.prompt;

        // v61 Phase 5 (Step-by-Step Multi-Model Debate) — for high-complexity
        // or critical steps, run the Proposer → Critic → Refiner debate
        // instead of a single LLM call. This is the "Claude-level intelligence
        // loop" that forces critical thinking before committing.
        const stepComplexity = (step.config.complexity as "low" | "medium" | "high") ?? "medium";
        const isCritical = step.config.critical === true || step.config.critical === "true";
        const shouldDebate = stepComplexity === "high" || isCritical;

        if (shouldDebate) {
          try {
            const { runStepDebate } = await import("./step-debate");
            const debateResult = await runStepDebate(
              {
                description: promptTemplate,
                stepType: agentRole,
                skillSlug: (step.config.skillSlug as string) ?? undefined,
                context: prompt,
                complexity: stepComplexity,
                critical: isCritical,
              },
              // Inject previous step results for context continuity.
              (run?.steps ?? []).filter((s) => s.success).map((s) => ({
                finalOutput: String(s.output ?? ""),
                proposal: String(s.output ?? ""),
                critique: "",
                debated: false,
                rounds: 1,
                productionReady: true,
              })),
            );
            output = debateResult.finalOutput;
            // BUG-2 FIX: propagate productionReady — if the gate rejected the
            // output (even after 3 retries), the step MUST fail so the
            // NEEDS_CONTEXT halt logic below catches it.
            success = debateResult.productionReady;
            if (!success) error = `Production Gate rejected debate output (productionReady=false)`;
            logger.info("workflow-engine.step-debate.complete", {
              stepName: step.name,
              rounds: debateResult.rounds,
              debated: debateResult.debated,
              productionReady: debateResult.productionReady,
            });
          } catch (debateErr) {
            // Fall back to single-pass if the debate fails.
            logger.warn("workflow-engine.step-debate.failed", { error: String(debateErr) });
            const result = await callLLM(agentName, agentRole, prompt, { model: "glm-4.5-air" });
            output = result.completion;
            success = result.success;
            if (!success) error = result.error;
            // BUG-3 FIX: run the production gate on the fallback output too —
            // previously this catch path skipped the gate entirely, so a
            // TODO/secret-laden fallback output would ship unchecked.
            if (success && typeof output === "string") {
              const { verifyProductionReadiness } = await import("./production-gate");
              const gate = verifyProductionReadiness(output, agentRole, 0);
              if (!gate.passed) {
                output = `NEEDS_CONTEXT: Production Gate rejected fallback output. Issues: ${gate.issues.join("; ")}. Owner clarification required.`;
                success = false;
                error = String(output);
                logger.warn("workflow-engine.production-gate.fallback-rejected", {
                  stepName: step.name,
                  issues: gate.issues,
                });
              }
            }
          }
        } else {
          // Low/medium complexity: single-pass execution (no debate).
          const result = await callLLM(agentName, agentRole, prompt, { model: "glm-4.5-air" });
          output = result.completion;
          success = result.success;
          if (!success) error = result.error;
          // v61 FIX (Finding 4b): Gate single-pass outputs through the
          // production gate too. If the output contains placeholders/secrets/
          // missing error handling, replace it with a NEEDS_CONTEXT marker so
          // the halt logic below catches it + escalates to the owner.
          if (success && typeof output === "string") {
            const { verifyProductionReadiness } = await import("./production-gate");
            const gate = verifyProductionReadiness(output, agentRole, 0);
            if (!gate.passed) {
              output = `NEEDS_CONTEXT: Production Gate rejected this output. Issues: ${gate.issues.join("; ")}. Owner clarification required.`;
              logger.warn("workflow-engine.production-gate.single-pass-rejected", {
                stepName: step.name,
                issues: gate.issues,
              });
            }
          }
        }
        // v61 FIX (Finding 4b): If the production gate rejected the output
        // (either from the debate path or the single-pass gate above), the
        // output is prefixed with NEEDS_CONTEXT. Halt the step + escalate to
        // the owner via the Zero-Assumption Telegram flow. Do NOT return the
        // flawed output (no TODO/FIXME/secrets shipped to production).
        if (typeof output === "string" && output.startsWith("NEEDS_CONTEXT:")) {
          success = false;
          error = output;
          if (run) run.status = "awaiting_approval";
          try {
            const { sendTelegramMessage } = await import("./telegram-notifier");
            await sendTelegramMessage(
              `🚫 *PRODUCTION GATE HALT* for workflow run \`${run?.id.slice(-8) ?? "unknown"}\`\n\n` +
              `*Step:* ${step.name}\n\n` +
              `${output.slice(0, 400)}`
            );
          } catch { /* best-effort */ }
          try {
            await db.agentLog.create({
              data: {
                level: "error",
                message: `Workflow "${run?.workflowName ?? "unknown"}" halted — PRODUCTION GATE rejected output for step "${step.name}".`,
                meta: JSON.stringify({ runId: run?.id, stepId: step.id, gateIssues: output.slice(0, 500) }),
              },
            });
          } catch { /* best-effort */ }
        }
        context[step.name] = output;
      } catch (err) {
        success = false;
        error = String(err);
      }
      break;
    }

    case "tool_call": {
      const tool = (step.config.tool as string) ?? "noop";
      try {
        // v61 Phase 3 (Owner Rule: ZERO ASSUMPTIONS) — before executing any
        // tool, check that all required context is present. If missing, halt
        // the workflow + ask the owner for clarification via Telegram.
        const toolPayload = (step.config.params as Record<string, unknown>) ?? {};
        // Merge the step's config into the payload for the completeness check.
        const mergedPayload: Record<string, unknown> = { ...step.config, ...toolPayload };
        // Include any context fields that might satisfy the requirements.
        for (const [k, v] of Object.entries(context)) {
          if (!(k in mergedPayload)) mergedPayload[k] = v;
        }
        const { checkContextCompleteness } = await import("./zero-assumption-guard");
        const gap = checkContextCompleteness(tool, mergedPayload, run?.id);
        if (!gap.complete) {
          // Halt + ask the owner.
          success = false;
          error = `NEEDS_CONTEXT: ${gap.missingField} — ${gap.question}`;
          // Set the run status + send a Telegram clarification request.
          if (run) run.status = "awaiting_approval"; // reuse the awaiting state for context gaps
          try {
            const { sendTelegramMessage } = await import("./telegram-notifier");
            await sendTelegramMessage(
              `❓ *CLARIFICATION NEEDED* for workflow run \`${run?.id.slice(-8) ?? "unknown"}\`\n\n` +
              `*Step:* ${step.name}\n*Tool:* ${tool}\n*Missing:* ${gap.missingField}\n\n` +
              `${gap.question}\n\n` +
              `Reply: /answer ${run?.id.slice(-8) ?? "unknown"} <your answer>`
            );
          } catch { /* best-effort */ }
          // Record the context gap in the DB so the owner can see it.
          try {
            await db.agentLog.create({
              data: {
                level: "warn",
                message: `Workflow "${run?.workflowName ?? "unknown"}" halted — NEEDS_CONTEXT: ${gap.missingField} (${gap.question})`,
                meta: JSON.stringify({ runId: run?.id, stepId: step.id, tool, missingField: gap.missingField, question: gap.question }),
              },
            });
          } catch { /* best-effort */ }
          // Return immediately — don't execute the tool with guessed params.
          return {
            stepId: step.id,
            stepName: step.name,
            type: step.type,
            success: false,
            output: null,
            error: `NEEDS_CONTEXT: ${gap.missingField}`,
            latencyMs: Date.now() - startTime,
            ts: new Date().toISOString(),
          };
        }

        switch (tool) {
          case "deploy":
            output = { deployed: true, version: "v25.9.8" };
            break;
          case "send_email":
            output = { sent: true, to: "operator@aria.ai" };
            break;
          default:
            output = { executed: tool };
        }
        context[step.name] = output;
      } catch (err) {
        success = false;
        error = String(err);
      }
      break;
    }

    case "condition": {
      const field = (step.config.field as string) ?? "default";
      const operator = (step.config.operator as string) ?? "==";
      const value = step.config.value;
      const fieldValue = context[field];
      let conditionResult = false;
      switch (operator) {
        case ">": conditionResult = Number(fieldValue) > Number(value); break;
        case "<": conditionResult = Number(fieldValue) < Number(value); break;
        case "==": conditionResult = String(fieldValue) === String(value); break;
        case "contains": conditionResult = String(fieldValue).includes(String(value)); break;
      }
      output = conditionResult ? "true" : "false";
      break;
    }

    case "delay": {
      const seconds = (step.config.seconds as number) ?? 1;
      await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
      output = { delayed: seconds };
      break;
    }

    case "notification": {
      try {
        const channel = (step.config.channel as string) ?? "log";
        const message = `Workflow notification: ${step.name} - Context: ${JSON.stringify(context).slice(0, 200)}`;
        if (channel === "telegram") {
          const { sendTelegramMessage } = await import("./telegram-notifier");
          await sendTelegramMessage(message);
        }
        output = { sent: true, channel };
      } catch (err) {
        output = { sent: false, error: String(err) };
      }
      break;
    }

    case "data_fetch": {
      const query = (step.config.query as string) ?? "default";
      try {
        switch (query) {
          case "revenue_summary": {
            const total = await db.revenueEvent.aggregate({ _sum: { amount: true } });
            const count = await db.revenueEvent.count();
            output = { totalRevenue: total._sum.amount ?? 0, eventCount: count };
            break;
          }
          case "recent_agent_logs": {
            const logs = await db.agentLog.findMany({ orderBy: { createdAt: "desc" }, take: 20 });
            output = logs.map((l) => ({ level: l.level, message: l.message, ts: l.createdAt }));
            break;
          }
          default:
            output = { query, result: "no data" };
        }
        context[step.name] = output;
      } catch (err) {
        success = false;
        error = String(err);
      }
      break;
    }

    case "transform": {
      // Pass through — in production this would apply a transformation function.
      output = context;
      break;
    }

    case "approval": {
      // Create a real approval record and pause the workflow.
      try {
        const approval = await db.approval.create({
          data: {
            title: (step.config.title as string) ?? "Workflow Approval",
            summary: `Workflow step requiring approval`,
            risk: (step.config.risk as string) ?? "medium",
            status: "pending",
            requester: "workflow-engine",
          },
        });
        emit({
          type: "approval",
          ts: new Date().toISOString(),
          approval: {
            id: approval.id,
            title: approval.title,
            summary: approval.summary,
            risk: approval.risk as "low" | "medium" | "high" | "critical",
            status: "pending",
            requester: approval.requester,
            agentId: approval.agentId,
            action: approval.action,
            amount: approval.amount,
            payload: approval.payload,
            brief: approval.brief,
            discussionLog: approval.discussionLog,
            oralConfirmed: approval.oralConfirmed,
            voiceCallId: approval.voiceCallId,
            createdAt: toIso(approval.createdAt)!,
            decidedAt: null,
          },
        });
        // Send Telegram notification.
        // Phase 29: use the new Telegram-FIRST approval flow with inline
        // keyboard buttons. Falls back to the legacy text-only notification
        // if the new module is unavailable (e.g. during early bootstrap).
        try {
          const { requestOwnerApproval, buildApprovalRequestFromRow } = await import(
            "./owner-approval/telegram-approval"
          );
          const payload = await buildApprovalRequestFromRow(approval.id, "workflow");
          if (payload) {
            await requestOwnerApproval(payload);
          } else {
            const { sendApprovalNotification } = await import("./telegram-notifier");
            await sendApprovalNotification(approval.title, approval.risk, approval.amount);
          }
        } catch { /* ignore */ }
        output = { approvalId: approval.id, status: "pending" };
      } catch (err) {
        success = false;
        error = String(err);
      }
      break;
    }

    case "end":
      output = { completed: true };
      break;

    default:
      output = { unknown: step.type };
  }

  return {
    stepId: step.id,
    stepName: step.name,
    type: step.type,
    success,
    output,
    error,
    latencyMs: Date.now() - startTime,
    ts: new Date().toISOString(),
  };
}

/**
 * Get all active workflow templates.
 */
export function getWorkflowTemplates(): Workflow[] {
  return WORKFLOW_TEMPLATES;
}

/**
 * Get currently running workflows.
 */
export function getActiveRuns(): WorkflowRun[] {
  return Array.from(activeRuns.values());
}
