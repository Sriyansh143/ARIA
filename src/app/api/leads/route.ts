import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireAuth } from "@/lib/auth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * GET /api/leads — list LeadFinder-discovered EarningOpportunities.
 * Query: ?status=discovered|qualified|discarded (default: discovered)
 *
 * Auth: any authenticated user can view.
 */
export async function GET(req: NextRequest) {
  try {
    await requireAuth()

    const url = new URL(req.url)
    const status = url.searchParams.get("status") || "discovered"
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "100"), 200)

    const where = status === "all"
      ? { source: "lead-finder" }
      : { source: "lead-finder", status }

    const leads = await db.earningOpportunity.findMany({
      where,
      orderBy: { discoveredAt: "desc" },
      take: limit,
    })

    // Parse the description JSON (where LeadFinder stores lead details)
    const parsed = leads.map((lead) => {
      let details: any = {}
      try {
        details = JSON.parse(lead.description || "{}")
      } catch {
        details = { reasoning: lead.description }
      }
      return {
        id: lead.id,
        title: lead.title,
        status: lead.status,
        confidenceScore: details.confidenceScore ?? lead.feasibilityScore * 100,
        businessName: details.businessName ?? lead.title,
        website: details.website ?? "",
        industry: details.industry ?? "unknown",
        serviceMatched: details.serviceMatched ?? "",
        reasoning: details.reasoning ?? "",
        suggestedOutreach: details.suggestedOutreach ?? "",
        contactEmail: details.contactEmail ?? null,
        estimatedRevenue: lead.estimatedRevenue,
        discoveredAt: lead.discoveredAt,
      }
    })

    return NextResponse.json({ leads: parsed, count: parsed.length })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
