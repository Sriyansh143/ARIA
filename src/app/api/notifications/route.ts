import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireAuth } from "@/lib/auth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * GET /api/notifications — list recent notifications from NotificationLog.
 * Query: ?limit=20 (default 20)
 *
 * Returns newest-first. The frontend uses this for the bell-icon dropdown.
 */
export async function GET(req: NextRequest) {
  try {
    await requireAuth()

    const url = new URL(req.url)
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "20"), 100)

    const notifications = await db.notificationLog.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
    })

    // Mark "unread" based on a 24h window (simpler than a read-receipt system)
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const unreadCount = notifications.filter((n) => n.createdAt > oneDayAgo && n.status === "failed").length

    return NextResponse.json({
      notifications,
      unreadCount,
      total: notifications.length,
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
