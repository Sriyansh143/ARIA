/**
 * GET /api/approvals/[id]/conversation — fetch the conversation thread
 * (questions + suggestions + answers + revisions) for a Telegram-first
 * approval. Used by the dashboard to render the conversation alongside
 * the approval card.
 *
 * Returns: { messages: [{role, content, ts, kind}], status, revisedBrief }
 */
import { NextRequest, NextResponse } from "next/server";
import { getApprovalConversation } from "@/lib/owner-approval/telegram-approval";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const conversation = await getApprovalConversation(id);
    if (!conversation) {
      return NextResponse.json(
        { messages: [], status: "none", revisedBrief: null },
        { status: 200 },
      );
    }
    return NextResponse.json(conversation);
  } catch (err) {
    logger.error("api.approvals.conversation.get-failed", { error: String(err) });
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
