/**
 * ARIA Mission Control — Multi-Company support (Task 23).
 *
 * A single ARIA master account (`parentAccountId`) can own multiple
 * CompanyProfile rows — one per company the autonomous fleet operates.
 * The owner switches between them via the dashboard header dropdown;
 * the active id is persisted in a cookie so the choice survives reload.
 *
 * All helpers are pure DB accessors — no React, no client-side code.
 * The cookie helper (`getActiveCompanyId` / `switchCompany`) is the
 * ONLY one that touches `next/headers` and therefore must run inside a
 * Route Handler / Server Component / Server Action.
 */
import { cookies } from "next/headers";
import { db } from "./db";
import {
  toIso,
  type CompanyProfile,
} from "./types";

export const ACTIVE_COMPANY_COOKIE = "aria-active-company";

// ─── DB row → API payload ────────────────────────────────────────────
function serialize(row: {
  id: string;
  name: string;
  tagline: string | null;
  industry: string | null;
  website: string | null;
  email: string | null;
  currency: string;
  timezone: string;
  parentAccountId: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}): CompanyProfile {
  return {
    id: row.id,
    name: row.name,
    tagline: row.tagline,
    industry: row.industry,
    website: row.website,
    email: row.email,
    currency: row.currency,
    timezone: row.timezone,
    parentAccountId: row.parentAccountId,
    isActive: row.isActive,
    createdAt: toIso(row.createdAt)!,
    updatedAt: toIso(row.updatedAt)!,
  };
}

export interface CreateCompanyInput {
  name: string;
  tagline?: string | null;
  industry?: string | null;
  website?: string | null;
  email?: string | null;
  currency?: string;
  timezone?: string;
  parentAccountId?: string | null;
}

export type UpdateCompanyInput = Partial<CreateCompanyInput> & { isActive?: boolean };

/**
 * List companies under a parent ARIA account. Pass `parentAccountId=undefined`
 * to return ALL companies (used by the dashboard switcher when the parent
 * account is unknown — typically the owner has only one and we surface it).
 * `parentAccountId=null` returns companies that are standalone (no parent).
 *
 * Only `isActive=true` companies are returned by default — pass
 * `includeInactive=true` to surface deactivated companies too.
 */
export async function listCompanies(
  parentAccountId?: string | null,
  opts: { includeInactive?: boolean } = {}
): Promise<CompanyProfile[]> {
  const where: { parentAccountId?: string | null; isActive?: boolean } = {};
  if (parentAccountId !== undefined) {
    where.parentAccountId = parentAccountId ?? null;
  }
  if (!opts.includeInactive) {
    where.isActive = true;
  }
  const rows = await db.companyProfile.findMany({
    where,
    orderBy: { createdAt: "asc" },
  });
  return rows.map(serialize);
}

/** Fetch a single company by id (returns null if not found). */
export async function getCompany(id: string): Promise<CompanyProfile | null> {
  const row = await db.companyProfile.findUnique({ where: { id } });
  return row ? serialize(row) : null;
}

/** Create a new company under the given (or null = standalone) ARIA account. */
export async function createCompany(data: CreateCompanyInput): Promise<CompanyProfile> {
  const row = await db.companyProfile.create({
    data: {
      name: data.name,
      tagline: data.tagline ?? null,
      industry: data.industry ?? null,
      website: data.website ?? null,
      email: data.email ?? null,
      currency: data.currency ?? "USD",
      timezone: data.timezone ?? "UTC",
      parentAccountId: data.parentAccountId ?? null,
      isActive: true,
    },
  });
  return serialize(row);
}

/** Update an existing company's profile fields. */
export async function updateCompany(id: string, data: UpdateCompanyInput): Promise<CompanyProfile> {
  const update: Record<string, unknown> = {};
  if (data.name !== undefined) update.name = data.name;
  if (data.tagline !== undefined) update.tagline = data.tagline;
  if (data.industry !== undefined) update.industry = data.industry;
  if (data.website !== undefined) update.website = data.website;
  if (data.email !== undefined) update.email = data.email;
  if (data.currency !== undefined) update.currency = data.currency;
  if (data.timezone !== undefined) update.timezone = data.timezone;
  if (data.parentAccountId !== undefined) update.parentAccountId = data.parentAccountId;
  if (data.isActive !== undefined) update.isActive = data.isActive;
  const row = await db.companyProfile.update({ where: { id }, data: update });
  return serialize(row);
}

/** Soft-delete: marks the company `isActive=false`. The row is preserved. */
export async function deactivateCompany(id: string): Promise<void> {
  await db.companyProfile.update({ where: { id }, data: { isActive: false } });
}

/**
 * Read the active company id from the request cookie. Returns null if no
 * cookie is set or the referenced company no longer exists / is inactive.
 *
 * Server-only — uses `next/headers` cookies().
 */
export async function getActiveCompanyId(): Promise<string | null> {
  const store = await cookies();
  const id = store.get(ACTIVE_COMPANY_COOKIE)?.value;
  if (!id) return null;
  const company = await getCompany(id);
  if (!company || !company.isActive) return null;
  return company.id;
}

/**
 * Persist the active company id in the response cookie. Subsequent server
 * reads via `getActiveCompanyId()` will return this id. Switching to a
 * non-existent or inactive company is rejected with `false`.
 *
 * Server-only — uses `next/headers` cookies().
 *
 * Returns true on success.
 */
export async function switchCompany(id: string): Promise<boolean> {
  const company = await getCompany(id);
  if (!company || !company.isActive) return false;
  const store = await cookies();
  store.set(ACTIVE_COMPANY_COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365, // 1 year
  });
  return true;
}

/** Clear the active-company cookie (logout-style reset). */
export async function clearActiveCompany(): Promise<void> {
  const store = await cookies();
  store.delete(ACTIVE_COMPANY_COOKIE);
}

// ─── Earning-opportunity assignments ─────────────────────────────────

export interface CompanyOpportunityAssignment {
  id: string;
  companyId: string;
  opportunityId: string;
  assignedAt: string;
}

/** Assign an earning opportunity to a company (idempotent — duplicates are ignored). */
export async function assignOpportunityToCompany(
  companyId: string,
  opportunityId: string
): Promise<CompanyOpportunityAssignment | null> {
  // Idempotent: if an assignment already exists, return it.
  const existing = await db.companyEarningOpportunity.findFirst({
    where: { companyId, opportunityId },
  });
  if (existing) {
    return {
      id: existing.id,
      companyId: existing.companyId,
      opportunityId: existing.opportunityId,
      assignedAt: toIso(existing.assignedAt)!,
    };
  }
  const row = await db.companyEarningOpportunity.create({
    data: { companyId, opportunityId },
  });
  return {
    id: row.id,
    companyId: row.companyId,
    opportunityId: row.opportunityId,
    assignedAt: toIso(row.assignedAt)!,
  };
}

/** List all opportunities assigned to a company. */
export async function listOpportunitiesForCompany(
  companyId: string
): Promise<CompanyOpportunityAssignment[]> {
  const rows = await db.companyEarningOpportunity.findMany({
    where: { companyId },
    orderBy: { assignedAt: "desc" },
  });
  return rows.map((r) => ({
    id: r.id,
    companyId: r.companyId,
    opportunityId: r.opportunityId,
    assignedAt: toIso(r.assignedAt)!,
  }));
}

/** Unassign an opportunity from a company (returns true if a row was deleted). */
export async function unassignOpportunityFromCompany(
  companyId: string,
  opportunityId: string
): Promise<boolean> {
  const result = await db.companyEarningOpportunity.deleteMany({
    where: { companyId, opportunityId },
  });
  return result.count > 0;
}
