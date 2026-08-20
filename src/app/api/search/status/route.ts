/**
 * GET /api/search/status — Phase 31
 *
 * Returns the status of all configured search providers + an optional test
 * search to verify the chain is working.
 *
 * Query params:
 *   ?test=true       — run a test search ("hello world") + return results
 *   ?provider=<name> — run the test search ONLY on the specified provider
 */
import { NextRequest, NextResponse } from "next/server";
import { getSearchProviderStatus, searchWithFallback } from "@/lib/search/search-provider";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const runTest = sp.get("test") === "true";
    const providerFilter = sp.get("provider");

    const providers = getSearchProviderStatus();

    if (!runTest) {
      return NextResponse.json({ providers });
    }

    const testQuery = "hello world";
    const result = providerFilter
      ? await searchWithFallback(testQuery, {
          num: 3,
          skipZAI: providerFilter !== "zai",
          skipDDG: providerFilter !== "duckduckgo",
        })
      : await searchWithFallback(testQuery, { num: 3 });

    return NextResponse.json({
      providers,
      test: {
        query: testQuery,
        provider: result.provider,
        count: result.results.length,
        sample: result.results.slice(0, 3),
      },
    });
  } catch (err) {
    logger.error("api.search.status.failed", { error: String(err) });
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
