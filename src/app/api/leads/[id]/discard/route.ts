import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { logger } from "@/lib/logger"
import { requirePermissionResponse } from "@/lib/auth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * POST /api/leads/[id]/discard — discard a low-quality lead.
 * Changes status to "discarded" (removed from the active pipeline).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const [user, errorResponse] = await requirePermissionResponse("POST", "/api/leads/id/discard")
  if (errorResponse) return errorResponse

  try {
    const { id } = await params
    const body = await req.json().catch(() => ({}))
    const reason = String(body.reason || "discarded by owner").trim()

    const lead = await db.earningOpportunity.findUnique({ where: { id } })
    if (!lead) {
      return NextResponse.json({ error: "lead not found" }, { status: 404 })
    }

    const updated = await db.earningOpportunity.update({
      where: { id },
      data: {
        status: "discarded",
        description: `${lead.description ?? ""}\n---\nDiscarded by ${user!.email}: ${reason}`,
      },
    })

    logger.info("api.leads.discard", { leadId: id, discardedBy: user!.id, reason })

    return NextResponse.json({ ok: true, lead: updated })
  } catch (err) {
    logger.error("api.leads.discard.failed", { error: String(err) })
    return NextResponse.json({ error: "failed to discard lead" }, { status: 500 })
  }
}
