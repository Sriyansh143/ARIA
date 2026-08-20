import { NextRequest, NextResponse } from "next/server";
import { updateLeadStage } from "@/lib/crm";
import { logger } from "@/lib/logger";
import { z } from "zod";

export const dynamic = "force-dynamic";

const StageSchema = z.object({
  stage: z.enum(["new", "qualified", "proposal", "negotiation", "won", "lost"]),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json();
    const result = StageSchema.safeParse(body);
    if (!result.success) {
      return NextResponse.json({ error: "validation failed", issues: result.error.issues }, { status: 400 });
    }
    const updateResult = await updateLeadStage(id, result.data.stage);
    if (!updateResult.ok) {
      return NextResponse.json({ error: updateResult.error }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    logger.error("api.crm.leads.stage.failed", { error: String(err) });
    return NextResponse.json({ error: "failed to update stage" }, { status: 500 });
  }
}
