import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { logger } from "@/lib/logger"
import { requirePermissionResponse } from "@/lib/auth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * GET /api/users — list all users (owner-only).
 * Used by the RBAC Admin Panel.
 */
export async function GET() {
  const [user, errorResponse] = await requirePermissionResponse("GET", "/api/users")
  if (errorResponse) return errorResponse

  try {
    const users = await db.user.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        twoFactorEnabled: true,
        emailVerified: true,
        createdAt: true,
      },
      orderBy: { createdAt: "asc" },
    })

    return NextResponse.json({ users })
  } catch (err) {
    logger.error("api.users.list.failed", { error: String(err) })
    return NextResponse.json({ error: "failed to list users" }, { status: 500 })
  }
}
