import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { logger } from "@/lib/logger"
import { requirePermissionResponse } from "@/lib/auth"
import { getRoles } from "@/lib/rbac"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * PATCH /api/users/[id]/role — change a user's role (owner-only).
 * Body: { role: "owner" | "admin" | "viewer" }
 *
 * Safety: the owner cannot demote themselves (prevents lockout).
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const [currentUser, errorResponse] = await requirePermissionResponse("PATCH", "/api/users/id/role")
  if (errorResponse) return errorResponse

  try {
    const { id: targetUserId } = await params
    const body = await req.json().catch(() => ({}))
    const newRole = String(body.role || "").trim()

    // Validate role
    if (!getRoles().includes(newRole as any)) {
      return NextResponse.json({ error: `invalid role. Must be one of: ${getRoles().join(", ")}` }, { status: 400 })
    }

    // Fetch target user
    const targetUser = await db.user.findUnique({ where: { id: targetUserId } })
    if (!targetUser) {
      return NextResponse.json({ error: "user not found" }, { status: 404 })
    }

    // Safety: prevent self-demotion (owner locking themselves out)
    if (targetUserId === currentUser!.id && newRole !== "owner") {
      return NextResponse.json({ error: "cannot demote yourself — assign another owner first" }, { status: 400 })
    }

    // Safety: prevent removing the last owner
    if (targetUser.role === "owner" && newRole !== "owner") {
      const ownerCount = await db.user.count({ where: { role: "owner" } })
      if (ownerCount <= 1) {
        return NextResponse.json({ error: "cannot demote the last owner" }, { status: 400 })
      }
    }

    const updated = await db.user.update({
      where: { id: targetUserId },
      data: { role: newRole },
      select: { id: true, email: true, name: true, role: true },
    })

    logger.info("api.users.role-changed", {
      targetUser: targetUserId,
      newRole,
      changedBy: currentUser!.id,
    })

    return NextResponse.json({ ok: true, user: updated })
  } catch (err) {
    logger.error("api.users.role.failed", { error: String(err) })
    return NextResponse.json({ error: "failed to change role" }, { status: 500 })
  }
}
