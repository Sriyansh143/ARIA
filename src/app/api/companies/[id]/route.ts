import { NextRequest, NextResponse } from "next/server";
import {
  getCompany,
  updateCompany,
  deactivateCompany,
  switchCompany,
  type UpdateCompanyInput,
} from "@/lib/multi-company";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * GET /api/companies/[id]
 *
 * Returns a single company by id (404 if not found / inactive by default).
 * Pass `?includeInactive=1` to surface deactivated companies.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const url = new URL(req.url);
  const includeInactive = url.searchParams.get("includeInactive") === "1";

  const company = await getCompany(id);
  if (!company || (!includeInactive && !company.isActive)) {
    return NextResponse.json({ error: "company not found" }, { status: 404 });
  }
  return NextResponse.json({ company });
}

/**
 * PUT /api/companies/[id]
 *
 * Update a company's profile fields. Body is a partial CompanyProfile.
 *
 * Special field: `switch: true` in the body also marks the company as
 * the active dashboard company (writes the cookie). Use this from the
 * switcher dropdown.
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as UpdateCompanyInput & {
    switch?: boolean;
  };

  const existing = await getCompany(id);
  if (!existing) {
    return NextResponse.json({ error: "company not found" }, { status: 404 });
  }

  try {
    const updated = await updateCompany(id, {
      name: body.name,
      tagline: body.tagline,
      industry: body.industry,
      website: body.website,
      email: body.email,
      currency: body.currency,
      timezone: body.timezone,
      parentAccountId: body.parentAccountId,
      isActive: body.isActive,
    });

    // Switch the dashboard to this company if requested.
    let switched = false;
    if (body.switch && updated.isActive) {
      switched = await switchCompany(id);
    }

    logger.info("api.companies.update", { id, switched });
    return NextResponse.json({ company: updated, switched });
  } catch (err) {
    logger.error("api.companies.update.failed", { id, error: String(err) });
    return NextResponse.json({ error: "failed to update company" }, { status: 500 });
  }
}

/**
 * DELETE /api/companies/[id]
 *
 * Soft-deletes a company (isActive=false). The row is preserved so
 * historical references (audit logs, approvals) remain intact.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const existing = await getCompany(id);
  if (!existing) {
    return NextResponse.json({ error: "company not found" }, { status: 404 });
  }
  try {
    await deactivateCompany(id);
    logger.info("api.companies.deactivate", { id });
    return NextResponse.json({ ok: true, deactivated: id });
  } catch (err) {
    logger.error("api.companies.deactivate.failed", { id, error: String(err) });
    return NextResponse.json({ error: "failed to deactivate company" }, { status: 500 });
  }
}
