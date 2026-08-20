/**
 * /api/contact-finder — v72 Phase 22 (RULE-70)
 *
 * POST — find contact details (email + phone + social) for a company or individual.
 *   Body: { query: "Acme Corp", domain?: "acme.com" }
 *
 * GET — same via query params (?query=Acme+Corp&domain=acme.com).
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuthOrResponse } from "@/lib/auth";
import { findContactDetails } from "@/lib/lead-hunter/contact-finder";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requireAuthOrResponse("GET", "/api/contact-finder");
  if (auth instanceof NextResponse) return auth;
  try {
    const query = req.nextUrl.searchParams.get("query");
    const domain = req.nextUrl.searchParams.get("domain") ?? undefined;
    if (!query) {
      return NextResponse.json({ ok: false, error: "Missing 'query' parameter" }, { status: 400 });
    }
    const result = await findContactDetails(query, domain);
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    logger.error("api.contact-finder.get.failed", { error: String(err) });
    return NextResponse.json({ ok: false, error: String(err).slice(0, 100) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAuthOrResponse("POST", "/api/contact-finder");
  if (auth instanceof NextResponse) return auth;
  try {
    const body = await req.json();
    const { query, domain } = body;
    if (!query) {
      return NextResponse.json({ ok: false, error: "Missing 'query' field" }, { status: 400 });
    }
    const result = await findContactDetails(query, domain);
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err).slice(0, 100) }, { status: 500 });
  }
}
