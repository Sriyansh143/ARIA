/**
 * GET /api/currency/convert?amount=<n>&from=<USD>&to=<INR>
 *
 * Returns: { amount, currency, formatted, source: "live"|"static" }
 *
 * Uses the cached FX rates (1h TTL). If the cache is stale or missing,
 * the first call triggers a live fetch from exchangerate.host.
 */
import { NextRequest, NextResponse } from "next/server";
import { convertCurrency, formatMoney, isSupportedCurrency, listSupportedCurrencies } from "@/lib/currency-converter";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const amountStr = sp.get("amount");
    const fromCode = (sp.get("from") ?? "USD").toUpperCase();
    const toCode = (sp.get("to") ?? "USD").toUpperCase();

    if (!amountStr) {
      return NextResponse.json({
        error: "amount query param is required",
        supportedCurrencies: listSupportedCurrencies(),
      }, { status: 400 });
    }
    const amount = parseFloat(amountStr);
    if (!Number.isFinite(amount)) {
      return NextResponse.json({ error: "amount must be a finite number" }, { status: 400 });
    }
    if (!isSupportedCurrency(fromCode)) {
      return NextResponse.json({ error: `unsupported 'from' currency: ${fromCode}`, supportedCurrencies: listSupportedCurrencies() }, { status: 400 });
    }
    if (!isSupportedCurrency(toCode)) {
      return NextResponse.json({ error: `unsupported 'to' currency: ${toCode}`, supportedCurrencies: listSupportedCurrencies() }, { status: 400 });
    }

    const result = await convertCurrency({ amount, currency: fromCode }, toCode);
    return NextResponse.json({
      from: { amount, currency: fromCode },
      to: { amount: result.amount, currency: result.currency },
      formatted: formatMoney(result),
    });
  } catch (err) {
    logger.error("api.currency.convert-failed", { error: String(err) });
    return NextResponse.json({ error: "internal_error", detail: String(err) }, { status: 500 });
  }
}
