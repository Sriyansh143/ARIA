/**
 * src/lib/multi-company-cycles.ts — Multi-Company Autonomous Cycles.
 *
 * Server-only. Runs the autonomous business engine across every active
 * CompanyProfile in parallel — each company gets its own
 * `runAutonomousCycle(playbookId)` invocation, derived from the
 * company's `industry` field via the INDUSTRY_MAP lookup table.
 *
 * Each company's cycle is independently try/caught — one failure never
 * aborts the others. Results include per-company success/failure stats
 * plus a rolled-up summary.
 *
 * Task ID: FEATURES-MULTICOMPANY-WORKFLOWS-CONNECTORS.
 */
import { db } from "./db";
import { logger } from "./logger";
import { emit } from "./event-bus";
import { listCompanies } from "./multi-company";
import { runAutonomousCycle, type CycleResult } from "./autonomous-business-engine";

// ─── Industry → Playbook Map ────────────────────────────────────────
/**
 * Maps a CompanyProfile.industry human-readable label (e.g. "Technology / SaaS")
 * to the canonical industry playbook id (e.g. "technology-saas").
 *
 * The list mirrors the 12 playbooks defined in industry-playbooks.ts.
 * Companies whose industry is null/unknown or unmatched fall back to the
 * generic "consulting" playbook.
 */
export const INDUSTRY_MAP: Record<string, string> = {
  "technology / saas": "technology-saas",
  "technology/saas": "technology-saas",
  "technology": "technology-saas",
  "saas": "technology-saas",

  "e-commerce / retail": "e-commerce-retail",
  "e-commerce/retail": "e-commerce-retail",
  "ecommerce": "e-commerce-retail",
  "retail": "e-commerce-retail",

  "finance / fintech": "finance-fintech",
  "finance/fintech": "finance-fintech",
  "finance": "finance-fintech",
  "fintech": "finance-fintech",

  "healthcare / biotech": "healthcare-biotech",
  "healthcare/biotech": "healthcare-biotech",
  "healthcare": "healthcare-biotech",
  "biotech": "healthcare-biotech",

  "education / edtech": "education-edtech",
  "education/edtech": "education-edtech",
  "education": "education-edtech",
  "edtech": "education-edtech",

  "media / entertainment": "media-entertainment",
  "media/entertainment": "media-entertainment",
  "media": "media-entertainment",
  "entertainment": "media-entertainment",

  "manufacturing": "manufacturing",

  "real estate": "real-estate",
  "real-estate": "real-estate",
  "realty": "real-estate",

  "consulting": "consulting",
  "advisory": "consulting",

  "marketing agency": "marketing-agency",
  "marketing-agency": "marketing-agency",
  "agency": "marketing-agency",
  "marketing": "marketing-agency",

  "logistics / supply chain": "logistics-supply-chain",
  "logistics/supply chain": "logistics-supply-chain",
  "logistics": "logistics-supply-chain",
  "supply chain": "logistics-supply-chain",

  "hospitality": "hospitality",
  "hotels": "hospitality",
};

const FALLBACK_PLAYBOOK_ID = "consulting";

/**
 * Resolve a company industry label to a playbook id. Case-insensitive,
 * trims whitespace. Falls back to the consulting playbook when no
 * match is found (so cycles still produce useful generic output).
 */
export function resolvePlaybookId(industry: string | null | undefined): string {
  if (!industry) return FALLBACK_PLAYBOOK_ID;
  const key = industry.trim().toLowerCase();
  if (INDUSTRY_MAP[key]) return INDUSTRY_MAP[key];
  // Try a partial match — if the label contains a known industry keyword,
  // use the first matching playbook.
  for (const mapKey of Object.keys(INDUSTRY_MAP)) {
    if (key.includes(mapKey)) return INDUSTRY_MAP[mapKey];
  }
  return FALLBACK_PLAYBOOK_ID;
}

// ─── Types ─────────────────────────────────────────────────────────

export interface CompanyCycleResult {
  companyId: string;
  companyName: string;
  industry: string | null;
  playbookId: string;
  cycleResult: CycleResult | null;
  error?: string;
  success: boolean;
  startedAt: string;
  completedAt: string;
}

export interface MultiCompanyCycleResult {
  totalCompanies: number;
  cyclesRun: number;
  successes: number;
  failures: number;
  startedAt: string;
  completedAt: string;
  results: CompanyCycleResult[];
  /** Documented warning: long-running cycles may timeout in some environments. */
  note: string;
}

export interface CompanyCycleStatus {
  companyId: string;
  companyName: string;
  industry: string | null;
  playbookId: string;
  lastCycleAt: string | null;
  opportunitiesToday: number;
  dealsToday: number;
  revenueToday: number;
  totalRevenue: number;
}

export interface MultiCompanyStatus {
  totalCompanies: number;
  totalOpportunitiesToday: number;
  totalDealsToday: number;
  totalRevenueToday: number;
  companies: CompanyCycleStatus[];
  generatedAt: string;
}

// ─── Orchestrator ──────────────────────────────────────────────────

/**
 * Run the autonomous business cycle for EVERY active company in parallel.
 *
 * For each company:
 *   1. Look up the company's `industry` field.
 *   2. Map it to an industry playbook id via INDUSTRY_MAP.
 *   3. Call `runAutonomousCycle(playbookId)`.
 *   4. Record the result with the company id.
 *   5. Wrap in try/catch — one company's failure does not abort others.
 *
 * Returns a rolled-up summary with per-company results.
 *
 * NOTE: This is long-running. Each company's cycle takes ~30-60s, so
 * with N companies the total wall-time can exceed typical API timeouts.
 * The caller should set a generous timeout or invoke this from a
 * background job runner in production.
 */
export async function runMultiCompanyCycle(): Promise<MultiCompanyCycleResult> {
  const startedAt = new Date().toISOString();
  const companies = await listCompanies(undefined, { includeInactive: false });

  emit({
    type: "system",
    ts: startedAt,
    message: `Multi-company cycle started — ${companies.length} active compan${companies.length === 1 ? "y" : "ies"}`,
    level: "info",
  });

  // Run all company cycles in parallel — each is independently try/caught.
  const settled = await Promise.allSettled(
    companies.map(async (company): Promise<CompanyCycleResult> => {
      const cycleStart = new Date().toISOString();
      const playbookId = resolvePlaybookId(company.industry);
      try {
        const cycleResult = await runAutonomousCycle(playbookId);
        return {
          companyId: company.id,
          companyName: company.name,
          industry: company.industry,
          playbookId,
          cycleResult,
          success: cycleResult.errors.length === 0,
          startedAt: cycleStart,
          completedAt: new Date().toISOString(),
        };
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        logger.error("multi-company-cycles.cycle.error", {
          companyId: company.id,
          companyName: company.name,
          playbookId,
          error: errMsg,
        });
        return {
          companyId: company.id,
          companyName: company.name,
          industry: company.industry,
          playbookId,
          cycleResult: null,
          error: errMsg,
          success: false,
          startedAt: cycleStart,
          completedAt: new Date().toISOString(),
        };
      }
    }),
  );

  const results: CompanyCycleResult[] = settled.map((s) => {
    if (s.status === "fulfilled") return s.value;
    // Defensive: Promise.allSettled should never reject given our try/catch,
    // but if it does we synthesize a failure result.
    const reason = s.reason instanceof Error ? s.reason.message : String(s.reason);
    return {
      companyId: "unknown",
      companyName: "unknown",
      industry: null,
      playbookId: FALLBACK_PLAYBOOK_ID,
      cycleResult: null,
      error: reason,
      success: false,
      startedAt,
      completedAt: new Date().toISOString(),
    };
  });

  const successes = results.filter((r) => r.success).length;
  const failures = results.length - successes;
  const completedAt = new Date().toISOString();

  emit({
    type: "system",
    ts: completedAt,
    message: `Multi-company cycle complete — ${successes}/${results.length} succeeded, ${failures} failed`,
    level: failures === 0 ? "success" : "warn",
  });

  return {
    totalCompanies: companies.length,
    cyclesRun: results.length,
    successes,
    failures,
    startedAt,
    completedAt,
    results,
    note:
      "Multi-company cycles are long-running (30-60s per company × N). " +
      "This endpoint may timeout in environments with strict API timeouts. " +
      "In production, invoke from a background job runner.",
  };
}

// ─── Status Query ──────────────────────────────────────────────────

/**
 * Return a per-company summary of cycle activity from the last 24 hours.
 *
 * For each active company:
 *   - Resolve its industry → playbookId.
 *   - Count EarningOpportunities where source = `industry:${playbookId}`
 *     and createdAt ≥ 24h ago.
 *   - Count Deals where source = `industry:${playbookId}` and
 *     createdAt ≥ 24h ago.
 *   - Sum RevenueEvents linked to those deals (via dealId) in the last 24h
 *     + lifetime total.
 *   - lastCycleAt = most recent Deal createdAt for that industry (or null).
 *
 * Because Deals/EarningOpportunities are tagged with the industry
 * playbook id (not the company id), grouping by industry is the most
 * accurate per-company attribution available without schema changes.
 */
export async function getMultiCompanyStatus(): Promise<MultiCompanyStatus> {
  const generatedAt = new Date().toISOString();
  const companies = await listCompanies(undefined, { includeInactive: false });

  if (companies.length === 0) {
    return {
      totalCompanies: 0,
      totalOpportunitiesToday: 0,
      totalDealsToday: 0,
      totalRevenueToday: 0,
      companies: [],
      generatedAt,
    };
  }

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  // Resolve playbook ids for each company (dedup the lookups).
  const companyPlaybooks = companies.map((c) => ({
    company: c,
    playbookId: resolvePlaybookId(c.industry),
    industryKey: `industry:${resolvePlaybookId(c.industry)}`,
  }));

  // Run all per-company queries in parallel — each is independent.
  const companyStatuses = await Promise.all(
    companyPlaybooks.map(async (entry) => {
      const { company, playbookId, industryKey } = entry;
      try {
        // EarningOpportunities tagged with this industry in the last 24h.
        // Deals + RevenueEvents are attributed via the `industry:<id>`
        // source tag — RevenueEvent is linked to Deal by dealId (no Prisma
        // relation), so we fetch Deal ids first then aggregate revenue.
        const [oppsToday, dealsTodayCount, latestDeal, allIndustryDeals] =
          await Promise.all([
            db.earningOpportunity.count({
              where: { source: industryKey, createdAt: { gte: since } },
            }),
            db.deal.count({
              where: { source: industryKey, createdAt: { gte: since } },
            }),
            db.deal.findFirst({
              where: { source: industryKey },
              orderBy: { createdAt: "desc" },
              select: { createdAt: true },
            }),
            db.deal.findMany({
              where: { source: industryKey },
              select: { id: true, createdAt: true },
            }),
          ]);

        const dealIds = allIndustryDeals.map((d) => d.id);
        const recentDealIds = allIndustryDeals
          .filter((d) => d.createdAt >= since)
          .map((d) => d.id);

        const [revenueTodayAgg, revenueAllAgg] = dealIds.length
          ? await Promise.all([
              db.revenueEvent.aggregate({
                _sum: { amount: true },
                where: {
                  dealId: { in: recentDealIds.length ? recentDealIds : dealIds },
                  createdAt: { gte: since },
                },
              }),
              db.revenueEvent.aggregate({
                _sum: { amount: true },
                where: { dealId: { in: dealIds } },
              }),
            ])
          : [
              { _sum: { amount: 0 as number | null } },
              { _sum: { amount: 0 as number | null } },
            ];

        return {
          companyId: company.id,
          companyName: company.name,
          industry: company.industry,
          playbookId,
          lastCycleAt: latestDeal?.createdAt.toISOString() ?? null,
          opportunitiesToday: oppsToday,
          dealsToday: dealsTodayCount,
          revenueToday: revenueTodayAgg._sum.amount ?? 0,
          totalRevenue: revenueAllAgg._sum.amount ?? 0,
        } satisfies CompanyCycleStatus;
      } catch (err) {
        logger.error("multi-company-cycles.status.error", {
          companyId: company.id,
          error: String(err),
        });
        return {
          companyId: company.id,
          companyName: company.name,
          industry: company.industry,
          playbookId,
          lastCycleAt: null,
          opportunitiesToday: 0,
          dealsToday: 0,
          revenueToday: 0,
          totalRevenue: 0,
        } satisfies CompanyCycleStatus;
      }
    }),
  );

  return {
    totalCompanies: companyStatuses.length,
    totalOpportunitiesToday: companyStatuses.reduce(
      (s, c) => s + c.opportunitiesToday,
      0,
    ),
    totalDealsToday: companyStatuses.reduce((s, c) => s + c.dealsToday, 0),
    totalRevenueToday: companyStatuses.reduce((s, c) => s + c.revenueToday, 0),
    companies: companyStatuses,
    generatedAt,
  };
}
