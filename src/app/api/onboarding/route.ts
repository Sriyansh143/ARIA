import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * GET /api/onboarding — check if the app is onboarded.
 *
 * Returns { onboarded: boolean, companyCount: number, companies: [...] }.
 *
 * The app is considered "onboarded" when at least one CompanyProfile
 * exists. The dashboard blocks engine startup until this returns true.
 */
export async function GET() {
  try {
    const companies = await db.companyProfile.findMany({
      where: { isActive: true },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        name: true,
        tagline: true,
        industry: true,
        website: true,
        email: true,
        currency: true,
        timezone: true,
        createdAt: true,
      },
    });

    return NextResponse.json({
      onboarded: companies.length > 0,
      companyCount: companies.length,
      companies,
    });
  } catch (err) {
    logger.error("api.onboarding.check.failed", { error: String(err) });
    return NextResponse.json(
      { onboarded: false, companyCount: 0, companies: [], error: "failed to check onboarding status" },
      { status: 500 }
    );
  }
}
