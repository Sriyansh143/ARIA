import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { logger } from "@/lib/logger"
import { requirePermissionResponse } from "@/lib/auth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * POST /api/leads/[id]/approve — approve a lead for outreach.
 * Changes status from "discovered" to "qualified" + creates a follow-up Task.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const [user, errorResponse] = await requirePermissionResponse("POST", "/api/leads/id/approve")
  if (errorResponse) return errorResponse

  try {
    const { id } = await params

    const lead = await db.earningOpportunity.findUnique({ where: { id } })
    if (!lead) {
      return NextResponse.json({ error: "lead not found" }, { status: 404 })
    }
    if (lead.status !== "discovered") {
      return NextResponse.json({ error: `lead is already ${lead.status}` }, { status: 400 })
    }

    // Update status to qualified
    const updated = await db.earningOpportunity.update({
      where: { id },
      data: { status: "qualified" },
    })

    // Create a follow-up Task for the Sales agent
    let taskId: string | null = null
    try {
      const salesAgent = await db.agent.findFirst({ where: { role: "Sales" }, select: { id: true } })
      const task = await db.task.create({
        data: {
          title: `Outreach: ${lead.title}`,
          description: `Follow up on qualified lead. ${lead.description ?? ""}`,
          kind: "follow_up",
          status: "pending",
          priority: "high",
          assignedToId: salesAgent?.id ?? null,
        },
      })
      taskId = task.id
      // Link the task to the opportunity
      await db.earningOpportunity.update({ where: { id }, data: { taskId: task.id } })
    } catch (taskErr) {
      logger.warn("api.leads.approve.task-failed", { leadId: id, error: String(taskErr) })
    }

    logger.info("api.leads.approve", { leadId: id, approvedBy: user!.id, taskId })

    return NextResponse.json({ ok: true, lead: updated, taskId })
  } catch (err) {
    logger.error("api.leads.approve.failed", { error: String(err) })
    return NextResponse.json({ error: "failed to approve lead" }, { status: 500 })
  }
}
