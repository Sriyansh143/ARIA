import { NextResponse } from "next/server";
import { getAllWorkflowTemplates, type Workflow } from "@/lib/workflow-templates";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * GET /api/workflow-templates
 *
 * Returns all workflow templates (existing 3 + new 5 cross-functional)
 * as a JSON array. Each entry is summarized — full step configs are
 * omitted to keep the response lean; only id, name, type are surfaced
 * per step so the UI can render the pipeline shape.
 */

interface StepSummary {
  id: string;
  name: string;
  type: string;
}

interface WorkflowSummary {
  id: string;
  name: string;
  description: string;
  trigger: Workflow["trigger"];
  status: Workflow["status"];
  stepCount: number;
  steps: StepSummary[];
}

export async function GET() {
  try {
    const all = getAllWorkflowTemplates();
    const summarized: WorkflowSummary[] = all.map((wf) => ({
      id: wf.id,
      name: wf.name,
      description: wf.description,
      trigger: wf.trigger,
      status: wf.status,
      stepCount: wf.steps.length,
      steps: wf.steps.map((s) => ({
        id: s.id,
        name: s.name,
        type: s.type,
      })),
    }));
    return NextResponse.json({
      templates: summarized,
      count: summarized.length,
    });
  } catch (err) {
    logger.error("api.workflow-templates.get.error", { error: String(err) });
    return NextResponse.json(
      { error: "failed to load workflow templates", detail: String(err) },
      { status: 500 },
    );
  }
}
