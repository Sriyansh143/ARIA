/**
 * GET /api/capabilities — v74 Phase 24 (RULE-77)
 *
 * Returns the live capability manifest (API endpoints, lib modules, crons,
 * constitution rules). Triggers a fresh scan on each request unless ?cached=1.
 *
 * POST /api/capabilities — manually trigger a manifest regeneration.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuthOrResponse } from "@/lib/auth";
import { generateCapabilityManifest } from "@/lib/capability-registry";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  // This is owner-only (reveals internal architecture).
  const auth = await requireAuthOrResponse("GET", "/api/capabilities");
  if (auth instanceof NextResponse) return auth;

  try {
    const cached = req.nextUrl.searchParams.get("cached") === "1";
    if (cached) {
      // Return the most recent manifest.
      const latest = await db.capabilityManifest.findFirst({
        orderBy: { generatedAt: "desc" },
      });
      if (!latest) {
        // No cached manifest → trigger a fresh generation.
        const manifest = await generateCapabilityManifest();
        return NextResponse.json({ ok: true, manifest });
      }
      return NextResponse.json({
        ok: true,
        manifest: JSON.parse(latest.manifestJson),
        generatedAt: latest.generatedAt.toISOString(),
      });
    }

    // Fresh generation.
    const manifest = await generateCapabilityManifest();
    return NextResponse.json({ ok: true, manifest });
  } catch (err) {
    logger.error("api.capabilities.get.failed", { error: String(err) });
    return NextResponse.json({ ok: false, error: String(err).slice(0, 200) }, { status: 500 });
  }
}

export async function POST() {
  const auth = await requireAuthOrResponse("POST", "/api/capabilities");
  if (auth instanceof NextResponse) return auth;

  try {
    const manifest = await generateCapabilityManifest();
    return NextResponse.json({
      ok: true,
      manifest,
      message: `Capability manifest regenerated: ${manifest.stats.apiCount} APIs, ${manifest.stats.moduleCount} modules, ${manifest.stats.cronCount} crons, ${manifest.stats.ruleCount} rules. docs/CAPABILITIES.md updated.`,
    });
  } catch (err) {
    logger.error("api.capabilities.post.failed", { error: String(err) });
    return NextResponse.json({ ok: false, error: String(err).slice(0, 200) }, { status: 500 });
  }
}
