import { NextRequest, NextResponse } from "next/server";
import {
  listCompanies,
  createCompany,
  getActiveCompanyId,
  switchCompany,
  type CreateCompanyInput,
} from "@/lib/multi-company";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * GET /api/companies
 *
 * Returns all active companies. If `?parent=<accountId>` is provided,
 * filters by that parent account; `?parent=none` returns standalone
 * companies (parentAccountId IS NULL); `?includeInactive=1` includes
 * deactivated companies in the result.
 *
 * The response also includes `activeCompanyId` — the company currently
 * selected in the dashboard (from the request cookie).
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const parentParam = url.searchParams.get("parent"); // null = all, "none" = standalone, "<id>" = scoped
  const includeInactive = url.searchParams.get("includeInactive") === "1";

  let parentAccountId: string | null | undefined;
  if (parentParam === null) {
    parentAccountId = undefined; // surface all
  } else if (parentParam === "none") {
    parentAccountId = null; // standalone only
  } else {
    parentAccountId = parentParam;
  }

  const companies = await listCompanies(parentAccountId, { includeInactive });
  const activeCompanyId = await getActiveCompanyId();

  return NextResponse.json({
    companies,
    activeCompanyId,
    count: companies.length,
  });
}

/**
 * POST /api/companies
 *
 * Create a new company under the caller's ARIA account.
 *
 * Body:
 *   {
 *     name: string,
 *     tagline?: string,
 *     industry?: string,
 *     website?: string,
 *     email?: string,
 *     currency?: string,    // default "USD"
 *     timezone?: string,    // default "UTC"
 *     parentAccountId?: string,
 *     switchTo?: boolean    // if true, also marks the new company active
 *   }
 *
 * Returns the created company.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as CreateCompanyInput & {
    switchTo?: boolean;
  };

  if (!body.name || typeof body.name !== "string" || body.name.trim().length === 0) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  try {
    const company = await createCompany({
      name: body.name.trim(),
      tagline: body.tagline?.trim() || null,
      industry: body.industry?.trim() || null,
      website: body.website?.trim() || null,
      email: body.email?.trim() || null,
      currency: body.currency?.trim() || "USD",
      timezone: body.timezone?.trim() || "UTC",
      parentAccountId: body.parentAccountId?.trim() || null,
    });

    // Optionally switch the dashboard to the new company.
    if (body.switchTo) {
      await switchCompany(company.id);
    }

    logger.info("api.companies.create", { id: company.id, name: company.name });
    return NextResponse.json({ company, active: body.switchTo === true }, { status: 201 });
  } catch (err) {
    logger.error("api.companies.create.failed", { error: String(err) });
    return NextResponse.json({ error: "failed to create company" }, { status: 500 });
  }
}
