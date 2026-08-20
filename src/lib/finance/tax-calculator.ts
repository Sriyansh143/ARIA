/**
 * src/lib/finance/tax-calculator.ts — Phase 30
 *
 * Tax calculation service. Supports two sources:
 *   1. Stripe Tax API (if STRIPE_SECRET_KEY is configured + tax calculation enabled)
 *   2. Static fallback table (for jurisdictions not supported by Stripe Tax,
 *      or when Stripe Tax is unavailable)
 *
 * WORKFLOW
 * --------
 *   1. calculateTax({ subtotalCents, currency, customerLocation })
 *   2. If Stripe Tax is configured → call `stripe.tax.calculations.create()`
 *      → store result in TaxCalculation table → return tax amount + rate + jurisdiction
 *   3. Else → use static fallback (lookup by country + state) → store result → return
 *
 * STATIC FALLBACK RATES
 * ---------------------
 * Conservative defaults (as-of 2025-Q1). Used ONLY if Stripe Tax is unavailable.
 *
 *   US: per-state sales tax (8.638% avg, simplified to 8.5% national avg)
 *   EU: per-country VAT (DE 19%, FR 20%, IT 22%, ES 21%, NL 21%, others 20%)
 *   IN: 18% GST (national)
 *   GB: 20% VAT
 *   CA: 5% GST (federal) + provincial (omitted — varies 0-10%)
 *   AU: 10% GST
 *   Others: 0% (treat as zero-rated or non-taxable)
 *
 * DESIGN NOTES
 * ------------
 * - Stripe Tax requires a Customer object with a billing address. If the
 *   customer doesn't have one, we fall back to the static table.
 * - Tax is calculated on the SUBTOTAL (before shipping). Shipping tax
 *   is a separate calculation not covered here.
 * - Tax amounts are in cents (integer) to avoid floating-point issues.
 * - Every calculation is persisted to the TaxCalculation table for audit.
 */

import "server-only";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

// ─── Types ───────────────────────────────────────────────────────────

export interface TaxCalculationInput {
  subtotalCents: number;
  currency: string;
  customerCountry?: string; // ISO 3166-1 alpha-2 (e.g. "US", "DE", "IN")
  customerState?: string; // ISO 3166-2 (e.g. "US-CA", "DE-BY")
  customerZip?: string;
  serviceOrderId?: string;
  contractId?: string;
}

export interface TaxCalculationOutput {
  ok: boolean;
  taxAmountCents: number;
  taxRate: number; // decimal, e.g. 0.0825 = 8.25%
  taxJurisdiction: string;
  totalCents: number; // subtotal + tax
  source: "stripe-tax" | "static-fallback";
  stripeCalculationId?: string;
  stripeTaxCode?: string;
  error?: string;
}

// ─── Static fallback rates ───────────────────────────────────────────

interface StaticRate {
  rate: number;
  jurisdiction: string;
  label: string;
}

// Country-level rates (used when state isn't specified or state lookup fails).
const COUNTRY_RATES: Record<string, StaticRate> = {
  US: { rate: 0.085, jurisdiction: "US", label: "US Sales Tax (national avg)" },
  DE: { rate: 0.19, jurisdiction: "EU-DE", label: "Germany VAT (MwSt)" },
  FR: { rate: 0.20, jurisdiction: "EU-FR", label: "France VAT (TVA)" },
  IT: { rate: 0.22, jurisdiction: "EU-IT", label: "Italy VAT (IVA)" },
  ES: { rate: 0.21, jurisdiction: "EU-ES", label: "Spain VAT (IVA)" },
  NL: { rate: 0.21, jurisdiction: "EU-NL", label: "Netherlands VAT (BTW)" },
  GB: { rate: 0.20, jurisdiction: "GB", label: "United Kingdom VAT" },
  IN: { rate: 0.18, jurisdiction: "IN", label: "India GST" },
  CA: { rate: 0.05, jurisdiction: "CA", label: "Canada GST (federal only)" },
  AU: { rate: 0.10, jurisdiction: "AU", label: "Australia GST" },
  SG: { rate: 0.09, jurisdiction: "SG", label: "Singapore GST" },
  AE: { rate: 0.05, jurisdiction: "AE", label: "UAE VAT" },
};

// US state-level overrides (sales tax varies by state).
// Source: state-level simplified averages as-of 2025-Q1.
const US_STATE_RATES: Record<string, StaticRate> = {
  "US-CA": { rate: 0.0725, jurisdiction: "US-CA", label: "California Sales Tax" },
  "US-NY": { rate: 0.08, jurisdiction: "US-NY", label: "New York Sales Tax" },
  "US-TX": { rate: 0.0625, jurisdiction: "US-TX", label: "Texas Sales Tax" },
  "US-FL": { rate: 0.06, jurisdiction: "US-FL", label: "Florida Sales Tax" },
  "US-WA": { rate: 0.065, jurisdiction: "US-WA", label: "Washington Sales Tax" },
  "US-MA": { rate: 0.0625, jurisdiction: "US-MA", label: "Massachusetts Sales Tax" },
  "US-IL": { rate: 0.0625, jurisdiction: "US-IL", label: "Illinois Sales Tax" },
  "US-PA": { rate: 0.06, jurisdiction: "US-PA", label: "Pennsylvania Sales Tax" },
  "US-OH": { rate: 0.0575, jurisdiction: "US-OH", label: "Ohio Sales Tax" },
  "US-GA": { rate: 0.04, jurisdiction: "US-GA", label: "Georgia Sales Tax" },
  "US-NC": { rate: 0.0475, jurisdiction: "US-NC", label: "North Carolina Sales Tax" },
  "US-MI": { rate: 0.06, jurisdiction: "US-MI", label: "Michigan Sales Tax" },
};

// ─── Public: calculateTax ───────────────────────────────────────────

export async function calculateTax(input: TaxCalculationInput): Promise<TaxCalculationOutput> {
  // Try Stripe Tax first.
  const stripeResult = await tryStripeTax(input);
  if (stripeResult.ok) {
    await persistCalculation({
      ...stripeResult,
      input,
      source: "stripe-tax",
    });
    return stripeResult;
  }

  // Fall back to static rates.
  const fallbackResult = computeStaticTax(input);
  await persistCalculation({
    ...fallbackResult,
    input,
    source: "static-fallback",
  });
  return fallbackResult;
}

// ─── Stripe Tax integration ──────────────────────────────────────────

async function tryStripeTax(input: TaxCalculationInput): Promise<TaxCalculationOutput & { ok: boolean }> {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  const taxEnabled = process.env.STRIPE_TAX_ENABLED === "true";
  if (!secretKey || !taxEnabled) {
    return { ok: false, taxAmountCents: 0, taxRate: 0, taxJurisdiction: "", totalCents: input.subtotalCents, source: "stripe-tax", error: "stripe-tax-not-enabled" };
  }

  // Stripe Tax requires a customer address. If we don't have one, fall back.
  if (!input.customerCountry) {
    return { ok: false, taxAmountCents: 0, taxRate: 0, taxJurisdiction: "", totalCents: input.subtotalCents, source: "stripe-tax", error: "no-customer-country" };
  }

  try {
    const Stripe = (await import("stripe")).default;
    const stripe = new Stripe(secretKey, { apiVersion: "2024-06-20" as any });

    // Build the address from input.
    const state = input.customerState?.split("-")[1] ?? input.customerState;
    const address = {
      country: input.customerCountry,
      ...(state ? { state } : {}),
      ...(input.customerZip ? { postal_code: input.customerZip } : {}),
    };

    const calculation = await stripe.tax.calculations.create({
      currency: input.currency.toLowerCase(),
      line_items: [
        {
          amount: input.subtotalCents,
          reference: input.contractId ?? input.serviceOrderId ?? `order-${Date.now()}`,
          tax_code: "txcd_10000000", // general taxable line item
        },
      ],
      customer_details: {
        address: address,
        address_source: "shipping",
      },
    });

    // Use the amount_total + tax_breakdown from the calculation result.
    // The Stripe types vary by API version — use `as any` defensively to
    // access fields that exist in practice but may not be in the type defs.
    const calcAny = calculation as unknown as {
      amount_total: number;
      tax_breakdown: Array<{
        tax_amount?: number;
        rate?: { decimal?: string };
        jurisdiction?: { display_name?: string };
      }>;
      id: string;
    };

    const taxAmountCents = calcAny.tax_breakdown?.reduce(
      (sum: number, b: { tax_amount?: number }) => sum + (b.tax_amount ?? 0),
      0,
    ) ?? 0;
    const taxRate = calcAny.tax_breakdown?.[0]?.rate?.decimal
      ? parseFloat(calcAny.tax_breakdown[0].rate.decimal)
      : 0;
    const jurisdiction = calcAny.tax_breakdown?.[0]?.jurisdiction?.display_name ?? input.customerCountry;

    return {
      ok: true,
      taxAmountCents,
      taxRate,
      taxJurisdiction: jurisdiction ?? "",
      totalCents: calcAny.amount_total ?? input.subtotalCents + taxAmountCents,
      source: "stripe-tax",
      stripeCalculationId: calcAny.id,
      stripeTaxCode: "txcd_10000000",
    };
  } catch (err) {
    logger.warn("tax-calculator.stripe-failed", { error: String(err) });
    return { ok: false, taxAmountCents: 0, taxRate: 0, taxJurisdiction: "", totalCents: input.subtotalCents, source: "stripe-tax", error: String(err) };
  }
}

// ─── Static fallback ─────────────────────────────────────────────────

function computeStaticTax(input: TaxCalculationInput): TaxCalculationOutput {
  const country = (input.customerCountry ?? "").toUpperCase();
  const state = (input.customerState ?? "").toUpperCase();

  let rate: StaticRate | null = null;

  // 1. Try state-level lookup (US states).
  if (state && US_STATE_RATES[state]) {
    rate = US_STATE_RATES[state];
  } else if (country === "US" && state) {
    // US state we don't have in the table — fall back to national avg.
    rate = COUNTRY_RATES.US;
  } else if (country && COUNTRY_RATES[country]) {
    rate = COUNTRY_RATES[country];
  }

  if (!rate) {
    // Unknown country — treat as zero-rated.
    return {
      ok: true,
      taxAmountCents: 0,
      taxRate: 0,
      taxJurisdiction: country || "unknown",
      totalCents: input.subtotalCents,
      source: "static-fallback",
    };
  }

  const taxAmountCents = Math.round(input.subtotalCents * rate.rate);
  return {
    ok: true,
    taxAmountCents,
    taxRate: rate.rate,
    taxJurisdiction: rate.jurisdiction,
    totalCents: input.subtotalCents + taxAmountCents,
    source: "static-fallback",
  };
}

// ─── Persist calculation ────────────────────────────────────────────

async function persistCalculation(
  result: TaxCalculationOutput & { input: TaxCalculationInput; source: string },
): Promise<void> {
  try {
    await db.taxCalculation.create({
      data: {
        source: result.source,
        subtotalCents: result.input.subtotalCents,
        currency: result.input.currency,
        customerCountry: result.input.customerCountry ?? "",
        customerState: result.input.customerState ?? "",
        customerZip: result.input.customerZip ?? "",
        taxAmountCents: result.taxAmountCents,
        taxRate: result.taxRate,
        taxJurisdiction: result.taxJurisdiction,
        stripeCalculationId: result.stripeCalculationId ?? "",
        stripeTaxCode: result.stripeTaxCode ?? "",
        contractId: result.input.contractId,
        serviceOrderId: result.input.serviceOrderId,
      },
    });
  } catch (err) {
    logger.warn("tax-calculator.persist-failed", { error: String(err) });
  }
}

// ─── Public: update Stripe checkout session with automatic_tax ──────

/**
 * Build the `automatic_tax` + `tax_ids` options for a Stripe Checkout
 * Session. Used by /api/stripe/checkout to enable tax calculation at
 * checkout time.
 *
 * Returns null if Stripe Tax is not enabled (so the caller can skip
 * adding the option to the checkout session).
 */
export function getStripeAutomaticTaxConfig(): { enabled: boolean } | null {
  if (process.env.STRIPE_TAX_ENABLED !== "true") return null;
  return { enabled: true };
}

// ─── Public: get historical tax calculations (for dashboard) ────────

export async function getTaxCalculations(filters: {
  contractId?: string;
  serviceOrderId?: string;
  source?: string;
  limit?: number;
}): Promise<Array<{
  id: string;
  source: string;
  subtotalCents: number;
  taxAmountCents: number;
  taxRate: number;
  taxJurisdiction: string;
  calculatedAt: Date;
}>> {
  const where: Record<string, unknown> = {};
  if (filters.contractId) where.contractId = filters.contractId;
  if (filters.serviceOrderId) where.serviceOrderId = filters.serviceOrderId;
  if (filters.source) where.source = filters.source;

  return db.taxCalculation.findMany({
    where,
    orderBy: { calculatedAt: "desc" },
    take: Math.min(filters.limit ?? 50, 500),
  });
}
