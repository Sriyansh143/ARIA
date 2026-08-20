import { NextRequest, NextResponse } from "next/server";
import { getWorkflowState } from "@/lib/workflow-state-graph";

export const dynamic = "force-dynamic";

/**
 * GET /api/workflows/[id]/state — Get current workflow state + history
 * 
 * Params: id = workflow state ID
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  
  if (!id) {
    return NextResponse.json({ error: "workflow state ID is required" }, { status: 400 });
  }

  try {
    const state = await getWorkflowState(id);

    if (!state) {
      return NextResponse.json({ error: "Workflow state not found" }, { status: 404 });
    }

    return NextResponse.json({
      ok: true,
      state,
    });
  } catch (err) {
    return NextResponse.json({ 
      error: err instanceof Error ? err.message : "Failed to get state" 
    }, { status: 500 });
  }
}
