/**
 * POST /api/proactive-promo/run — v72 Phase 22 (RULE-70)
 *
 * Manually trigger the daily-proactive-promo pipeline. Owner-only.
 *
 * GET /api/proactive-promo/run — return proactive promo metrics.
 */
import { NextResponse } from "next/server";
import { requireAuthOrResponse } from "@/lib/auth";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function POST() {
  const auth = await requireAuthOrResponse("POST", "/api/proactive-promo/run");
  if (auth instanceof NextResponse) return auth;

  try {
    // Reuse the cron handler logic by triggering it directly.
    const { scanForBusinessesWithoutWebsites } = await import("@/lib/lead-hunter/google-maps-scout");
    const { sendOutreachToAllPursuedLeads, sendOutreachToGoogleMapsBusinesses, sendOutreachToImportedContacts } = await import("@/lib/outreach-coordinator");

    const businesses = await scanForBusinessesWithoutWebsites();
    const leadsOutreach = await sendOutreachToAllPursuedLeads(20);
    const gmbOutreach = await sendOutreachToGoogleMapsBusinesses(30);
    const importedOutreach = await sendOutreachToImportedContacts(50);

    const summary = {
      gmbDiscovered: businesses.length,
      leadsOutreach,
      gmbOutreach,
      importedOutreach,
    };
    logger.info("api.proactive-promo.run.complete", summary);
    return NextResponse.json({
      ok: true,
      ...summary,
      message: `Scanned ${businesses.length} GMB businesses. Outreach sent: ${leadsOutreach.sent} leads + ${gmbOutreach.sent} GMB + ${importedOutreach.sent} imported. Queued for approval: ${leadsOutreach.queuedForApproval + gmbOutreach.queuedForApproval + importedOutreach.queuedForApproval}.`,
    });
  } catch (err) {
    logger.error("api.proactive-promo.run.failed", { error: String(err) });
    return NextResponse.json({ ok: false, error: String(err).slice(0, 200) }, { status: 500 });
  }
}

export async function GET() {
  const auth = await requireAuthOrResponse("GET", "/api/proactive-promo/run");
  if (auth instanceof NextResponse) return auth;

  try {
    const { db } = await import("@/lib/db");
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    // Aggregate proactive promo metrics from all 3 source tables.
    const [gmbLeads, importedContacts, socialPosts, freeOffers] = await Promise.all([
      db.googleMapsBusiness.count({ where: { discoveredAt: { gte: sevenDaysAgo } } }),
      db.importedContact.count({ where: { importedAt: { gte: sevenDaysAgo } } }),
      db.socialMediaPost.count({ where: { createdAt: { gte: sevenDaysAgo } } }),
      db.freeOfferRedemption.count({ where: { createdAt: { gte: sevenDaysAgo } } }),
    ]);

    const funnel = {
      googleMapsBusinesses: gmbLeads,
      importedContacts,
      socialPostsScheduled: socialPosts,
      freeOfferRedemptions: freeOffers,
    };

    // Outreach funnel.
    const outreachSent = await db.lead.count({ where: { outreachStatus: "sent" } });
    const outreachReplied = await db.lead.count({ where: { outreachStatus: "replied" } });
    const outreachConverted = await db.lead.count({ where: { outreachStatus: "converted" } });

    return NextResponse.json({
      ok: true,
      period: "7d",
      funnel,
      outreach: { sent: outreachSent, replied: outreachReplied, converted: outreachConverted },
    });
  } catch (err) {
    logger.error("api.proactive-promo.metrics.failed", { error: String(err) });
    return NextResponse.json({ ok: false, error: "Failed" }, { status: 500 });
  }
}
