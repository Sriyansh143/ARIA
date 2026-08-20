import { NextRequest, NextResponse } from "next/server";
import { executeWorkflow, getWorkflowTemplates, getActiveRuns, type Workflow } from "@/lib/workflow-engine";
import { emit } from "@/lib/event-bus";
import { toIso, LOG_LEVELS } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/workflows — list all workflow templates + active runs.
 * POST /api/workflows — trigger a workflow by ID (async, returns immediately).
 */

export async function GET() {
  const templates = getWorkflowTemplates();
  const activeRuns = getActiveRuns();
  return NextResponse.json({ templates, activeRuns });
}

export async function POST(req: NextRequest) {
  let body: { workflowId?: string; context?: Record<string, unknown> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const { workflowId, context } = body;
  if (!workflowId) {
    return NextResponse.json({ error: "workflowId is required" }, { status: 400 });
  }

  const templates = getWorkflowTemplates();
  const workflow = templates.find((w) => w.id === workflowId);
  if (!workflow) {
    return NextResponse.json({ error: `workflow "${workflowId}" not found` }, { status: 404 });
  }

  // Start the workflow asynchronously (don't block the response).
  const runPromise = executeWorkflow(workflow, context ?? {});

  // Emit system log about workflow trigger.
  emit({
    type: "system",
    ts: toIso(new Date())!,
    message: `Workflow "${workflow.name}" triggered by operator`,
    level: "info" as (typeof LOG_LEVELS)[number],
  });

  // For short workflows, wait for completion. For long ones, return immediately.
  const timeoutPromise = new Promise((resolve) => setTimeout(() => resolve(null), 25_000));
  const result = await Promise.race([runPromise, timeoutPromise]);

  if (result) {
    return NextResponse.json({
      ok: true,
      run: result,
      status: "completed",
    });
  }

  // Workflow is still running — return the run ID.
  return NextResponse.json({
    ok: true,
    message: `Workflow "${workflow.name}" is running in background`,
    status: "running",
  });
}
