/**
 * src/lib/currency-converter.ts — Phase 29
 *
 * Multi-currency conversion module. Previously the app was USD-only —
 * all amounts (approval amounts, ledger entries, deal values) were
 * stored as raw numbers with no currency code. This module adds:
 *
 *   1. A `Money` type that pairs an amount with an ISO 4217 currency code.
 *   2. A `convertCurrency()` function that converts between currencies
 *      using either:
 *        a) a live FX rate cache (refreshed from exchangerate.host every
 *           hour, no API key required), OR
 *        b) a static fallback table (used if the live fetch fails).
 *   3. A `formatMoney()` helper for display ("$1,234.56 USD" or "₹98,765 INR").
 *
 * DESIGN NOTES
 * ------------
 * - The FX cache is in-memory + 1h TTL. The first conversion of the hour
 *   triggers a fetch; subsequent conversions use the cache.
 * - If the live fetch fails, we fall back to the static rates below —
 *   these are intentionally conservative (as-of 2025-Q1) and should be
 *   refreshed periodically. They are ONLY used if the live fetch fails.
 * - Storage layer: amounts stay as `Float` in the DB. Callers that care
 *   about currency should store the currency code in the resource's
 *   payload JSON (e.g. `payload: { amount: 1000, currency: "USD" }`).
 *   The existing `amount: Float` column is interpreted as "the amount
 *   in the resource's currency" (USD by default for backward compatibility).
 */

import "server-only";
import { logger } from "@/lib/logger";

// ─── Types ───────────────────────────────────────────────────────────

export type CurrencyCode = "USD" | "EUR" | "GBP" | "INR" | "JPY" | "AUD" | "CAD" | "SGD" | "AED" | "CNY";

export interface Money {
  amount: number;
  currency: CurrencyCode;
}

// ─── Static fallback rates (USD → X) ─────────────────────────────────
// Used ONLY if the live fetch fails. Refreshed as-of 2025-Q1.
// Source: approximate mid-market rates from public financial aggregators.
const STATIC_RATES: Record<CurrencyCode, number> = {
  USD: 1,
  EUR: 0.92,
  GBP: 0.79,
  INR: 83.5,
  JPY: 149.5,
  AUD: 1.52,
  CAD: 1.36,
  SGD: 1.34,
  AED: 3.67,
  CNY: 7.24,
};

// Currency symbols for display.
const CURRENCY_SYMBOLS: Record<CurrencyCode, string> = {
  USD: "$",
  EUR: "€",
  GBP: "£",
  INR: "₹",
  JPY: "¥",
  AUD: "A$",
  CAD: "C$",
  SGD: "S$",
  AED: "د.إ",
  CNY: "¥",
};

// ─── FX rate cache ──────────────────────────────────────────────────

interface FxCache {
  rates: Record<CurrencyCode, number>; // USD → X
  fetchedAt: number; // epoch millis
  source: "live" | "static";
}

let fxCache: FxCache | null = null;
const FX_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Fetch live FX rates from exchangerate.host (no API key required).
 * Returns null on failure (caller falls back to static rates).
 */
async function fetchLiveRates(): Promise<Record<CurrencyCode, number> | null> {
  try {
    const res = await fetch(
      "https://api.exchangerate.host/latest?base=USD&symbols=USD,EUR,GBP,INR,JPY,AUD,CAD,SGD,AED,CNY",
      { signal: AbortSignal.timeout(5_000) },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { rates?: Record<string, number> };
    if (!data.rates) return null;

    // Validate every expected currency is present + numeric.
    const out: Record<string, number> = {};
    for (const code of Object.keys(STATIC_RATES)) {
      const val = data.rates[code];
      if (typeof val !== "number" || !Number.isFinite(val) || val <= 0) return null;
      out[code] = val;
    }
    return out as Record<CurrencyCode, number>;
  } catch (err) {
    logger.warn("currency-converter.live-fetch-failed", { error: String(err) });
    return null;
  }
}

/**
 * Get the current FX rates (USD → X). Refreshes the cache if stale.
 */
export async function getFxRates(): Promise<{ rates: Record<CurrencyCode, number>; source: "live" | "static" }> {
  const now = Date.now();
  if (fxCache && now - fxCache.fetchedAt < FX_CACHE_TTL_MS) {
    return { rates: fxCache.rates, source: fxCache.source };
  }

  const live = await fetchLiveRates();
  if (live) {
    fxCache = { rates: live, fetchedAt: now, source: "live" };
    return { rates: live, source: "live" };
  }

  // Fall back to static rates.
  if (!fxCache) {
    fxCache = { rates: STATIC_RATES, fetchedAt: now, source: "static" };
  }
  return { rates: fxCache.rates, source: fxCache.source };
}

/**
 * Convert an amount from one currency to another.
 *
 *   convertCurrency({ amount: 100, currency: "USD" }, "INR")
 *   → { amount: 8350, currency: "INR" }
 *
 * The conversion uses the cached USD-base rates: amount_in_target =
 * (amount / rate[from]) * rate[to].
 */
export async function convertCurrency(
  source: Money,
  target: CurrencyCode,
): Promise<Money> {
  if (source.currency === target) return { amount: source.amount, currency: target };

  const { rates } = await getFxRates();
  const rateFrom = rates[source.currency];
  const rateTo = rates[target];
  if (!rateFrom || !rateTo) {
    throw new Error(`Unsupported currency conversion: ${source.currency} → ${target}`);
  }

  // Convert: source → USD → target.
  const usdAmount = source.amount / rateFrom;
  const targetAmount = usdAmount * rateTo;

  // Round to 2 decimal places (or 0 for JPY which has no minor unit).
  const decimals = target === "JPY" ? 0 : 2;
  const rounded = Math.round(targetAmount * Math.pow(10, decimals)) / Math.pow(10, decimals);

  return { amount: rounded, currency: target };
}

/**
 * Format a Money value for display: "$1,234.56 USD" / "₹98,765.00 INR".
 *
 * For JPY (which has no minor unit), no decimals are shown.
 */
export function formatMoney(money: Money): string {
  const symbol = CURRENCY_SYMBOLS[money.currency] ?? "";
  const decimals = money.currency === "JPY" ? 0 : 2;
  const formatted = money.amount.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return `${symbol}${formatted} ${money.currency}`;
}

/**
 * Validate that a string is a supported currency code.
 */
export function isSupportedCurrency(code: string): code is CurrencyCode {
  return code in STATIC_RATES;
}

/**
 * Get the list of supported currency codes (for UI dropdowns).
 */
export function listSupportedCurrencies(): CurrencyCode[] {
  return Object.keys(STATIC_RATES) as CurrencyCode[];
}

/**
 * Force-refresh the FX cache. Used by the cron job that periodically
 * refreshes rates + by tests.
 */
export function clearFxCache(): void {
  fxCache = null;
}
