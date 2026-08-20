/**
 * GET /api/services/catalog — public service catalog.
 *
 * v56: Merges static 10-service catalog with approved dynamic ServiceOpportunities.
 * Returns payment method availability (crypto + UPI + Stripe).
 */
import { NextResponse } from "next/server";
import { SERVICE_CATALOG, getCategories, type ServiceDef } from "@/lib/services/catalog";
import { getStripeConfig } from "@/lib/stripe-checkout";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const cryptoConfigured = !!process.env.CRYPTO_WALLET_ADDRESS;
  const stripe = getStripeConfig();

  // v65 Phase 15 CRITICAL FIX: Only show LAUNCHED services to customers.
  // Previously queried "pending_approval" — showing UNAPPROVED services publicly!
  // A service must pass the pre-publish quality gate (score >= 70) before
  // it transitions to "launched" status. See RULE-51-PRE-PUBLISH-QUALITY-GATE.
  let dynamicServices: ServiceDef[] = [];
  try {
    const launched = await db.serviceOpportunity.findMany({
      where: { status: "launched" },
      orderBy: { compositeScore: "desc" },
      take: 10,
    });
    dynamicServices = launched.map((opp) => {
      const research = JSON.parse(opp.research || "{}");
      const spec = research.spec || {};
      return {
        id: `dynamic-${opp.id}`,
        name: opp.name,
        category: (spec.category || "content") as ServiceDef["category"],
        tagline: opp.targetMarket || "AI-discovered service",
        description: opp.description,
        priceCents: Math.round(Number(opp.estimatedPrice || 0) * 100),
        deliveryHours: spec.deliveryHours || 2,
        inputs: spec.inputs || ["Specification"],
        deliverables: spec.deliverables || ["deliverable.zip"],
        builderPrompt: spec.builderPrompt || "ServiceBuilder",
        outputFormat: "zip" as const,
        freePreview: false,
        icon: "Sparkles",
        accent: "emerald",
      };
    });
  } catch {
    // DB not available — return static only
  }

  return NextResponse.json({
    services: [...SERVICE_CATALOG, ...dynamicServices],
    categories: getCategories(),
    crypto: {
      configured: cryptoConfigured,
      network: process.env.CRYPTO_NETWORK || "BTC",
    },
    stripe,
  });
}
