/**
 * GET /api/search/synthesize?query=<...> — Phase 32 Feature #5
 *
 * Unified search + synthesis with inline citations (Perplexity-style).
 *
 * Query params:
 *   ?query=<text>       — the search query (required)
 *   ?num=<n>            — max results (default 5, max 10)
 *
 * Returns:
 *   {
 *     "ok": true,
 *     "query": "best AI website builders",
 *     "answer": "The top AI website builders include Wix ADI [1]...",
 *     "citations": [{ "number": 1, "url": "...", "title": "..." }],
 *     "provider": "zai",
 *     "latencyMs": 3500
 *   }
 */
import { NextRequest, NextResponse } from "next/server";
import { searchAndSynthesize } from "@/lib/search/answer-synthesis";
import { recordAudit } from "@/lib/audit-log";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const query = req.nextUrl.searchParams.get("query");
    if (!query) {
      return NextResponse.json({ error: "query parameter is required" }, { status: 400 });
    }

    const num = Math.min(parseInt(req.nextUrl.searchParams.get("num") ?? "5", 10) || 5, 10);

    const result = await searchAndSynthesize(query, { numResults: num });

    // Record audit log.
    await recordAudit({
      actor: "owner",
      actorRole: "owner",
      action: "search-synthesize",
      resource: "SearchSynthesis",
      after: {
        query: query.slice(0, 200),
        provider: result.provider,
        citationCount: result.citations.length,
        latencyMs: result.latencyMs,
        ok: result.ok,
      },
      source: "api",
    });

    return NextResponse.json(result);
  } catch (err) {
    logger.error("api.search.synthesize.failed", { error: String(err) });
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}

/**
 * POST /api/search/synthesize — same as GET but accepts a JSON body
 * (useful for longer queries that exceed URL length limits).
 *
 * Body: { "query": "...", "num": 5 }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const query = body.query;
    if (!query) {
      return NextResponse.json({ error: "query is required" }, { status: 400 });
    }

    const num = Math.min(body.num ?? 5, 10);

    const result = await searchAndSynthesize(query, { numResults: num });

    await recordAudit({
      actor: "owner",
      actorRole: "owner",
      action: "search-synthesize",
      resource: "SearchSynthesis",
      after: {
        query: String(query).slice(0, 200),
        provider: result.provider,
        citationCount: result.citations.length,
        latencyMs: result.latencyMs,
        ok: result.ok,
      },
      source: "api",
    });

    return NextResponse.json(result);
  } catch (err) {
    logger.error("api.search.synthesize.post.failed", { error: String(err) });
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
