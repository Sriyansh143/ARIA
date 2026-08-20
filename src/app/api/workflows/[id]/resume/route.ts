import { NextRequest, NextResponse } from "next/server";
import { resumeWorkflow } from "@/lib/workflow-state-graph";

export const dynamic = "force-dynamic";

/**
 * POST /api/workflows/[id]/resume — Resume workflow from checkpoint
 * 
 * Params: id = workflow state ID
 * Body: { approved?: boolean; comments?: string }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  
  if (!id) {
    return NextResponse.json({ error: "workflow state ID is required" }, { status: 400 });
  }

  let body: { approved?: boolean; comments?: string };
  try {
    body = await req.json();
  } catch {
    // Allow empty body for simple resume
    body = {};
  }

  try {
    const result = await resumeWorkflow(id, {
      approved: body.approved ?? true,
      comments: body.comments,
    });

    if (!result) {
      return NextResponse.json({ 
        error: "Workflow not found or not in awaiting_approval state" 
      }, { status: 404 });
    }

    return NextResponse.json({
      ok: true,
      state: result,
    });
  } catch (err) {
    return NextResponse.json({ 
      error: err instanceof Error ? err.message : "Failed to resume" 
    }, { status: 500 });
  }
}
