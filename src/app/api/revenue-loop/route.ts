import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireAuth } from "@/lib/auth"
import { getOutreachStats } from "@/lib/outreach-executor"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * GET /api/revenue-loop — analytics for the Revenue Loop dashboard tab.
 *
 * Returns:
 *   - Outreach stats (sent, contacted, replied, booked, closed-lost)
 *   - Revenue stats (total collected, pending, refunded)
 *   - Conversion rates (reply rate, booking rate)
 *   - Recent activity (last 10 outreach events)
 *   - Industry feedback (which industries convert best — for LLM feedback loop)
 */
export async function GET(req: NextRequest) {
  try {
    await requireAuth()

    const [outreachStats, orders, recentOutreach] = await Promise.all([
      getOutreachStats(),
      db.serviceOrder.findMany({
        where: { status: { in: ["delivered", "refunded", "building"] } },
        select: { id: true, status: true, priceCents: true, currency: true, createdAt: true, deliveredAt: true },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
      db.task.findMany({
        where: { kind: "follow_up", status: "completed" },
        orderBy: { completedAt: "desc" },
        take: 10,
        select: { id: true, title: true, completedAt: true, result: true },
      }),
    ])

    // Calculate revenue
    const totalRevenueCents = orders
      .filter((o) => o.status === "delivered")
      .reduce((sum, o) => sum + o.priceCents, 0)
    const pendingRevenueCents = orders
      .filter((o) => o.status === "building")
      .reduce((sum, o) => sum + o.priceCents, 0)
    const refundedCount = orders.filter((o) => o.status === "refunded").length

    // Industry feedback: group opportunities by industry + outcome
    const allOpps = await db.earningOpportunity.findMany({
      where: { source: "lead-finder" },
      select: { status: true, description: true, feasibilityScore: true },
    })

    const industryStats: Record<string, { total: number; replied: number; booked: number; closed: number }> = {}
    for (const opp of allOpps) {
      let industry = "unknown"
      try {
        const details = JSON.parse(opp.description || "{}")
        industry = details.industry || "unknown"
      } catch {
        // keep unknown
      }

      if (!industryStats[industry]) {
        industryStats[industry] = { total: 0, replied: 0, booked: 0, closed: 0 }
      }
      industryStats[industry].total++
      if (opp.status === "replied" || opp.status === "booked") industryStats[industry].replied++
      if (opp.status === "booked") industryStats[industry].booked++
      if (opp.status === "closed") industryStats[industry].closed++
    }

    // Convert to array + sort by conversion rate
    const industryFeedback = Object.entries(industryStats)
      .map(([industry, stats]) => ({
        industry,
        total: stats.total,
        replied: stats.replied,
        booked: stats.booked,
        closed: stats.closed,
        replyRate: stats.total > 0 ? (stats.replied / stats.total) * 100 : 0,
        bookingRate: stats.replied > 0 ? (stats.booked / stats.replied) * 100 : 0,
      }))
      .sort((a, b) => b.bookingRate - a.bookingRate)

    return NextResponse.json({
      outreach: outreachStats,
      revenue: {
        totalCollectedCents: totalRevenueCents,
        pendingCents: pendingRevenueCents,
        refundedCount,
        orderCount: orders.length,
      },
      recentActivity: recentOutreach,
      industryFeedback,
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
