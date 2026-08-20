/**
 * POST /api/refactor-proposals/[id]/merge — v73 Phase 23 (RULE-72)
 *
 * Owner approves a refactor proposal → execute the merge:
 *   1. Backup the original file.
 *   2. Overwrite with the proposed code.
 *   3. Run `bun run build`.
 *   4. If build passes → trigger PM2 restart.
 *   5. If build fails → revert + mark proposal as 'failed'.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuthOrResponse } from "@/lib/auth";
import { executeMerge } from "@/lib/self-evolution/refactor-engine";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuthOrResponse("POST", "/api/refactor-proposals/[id]/merge");
  if (auth instanceof NextResponse) return auth;

  try {
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const approvedBy = body.approvedBy ?? "owner";

    const result = await executeMerge(id, approvedBy);
    if (result.ok) {
      return NextResponse.json({ ok: true, message: "Merge complete — build passed, PM2 restarted." });
    } else {
      return NextResponse.json({ ok: false, error: result.reason }, { status: 400 });
    }
  } catch (err) {
    logger.error("api.refactor-proposals.merge.failed", { error: String(err) });
    return NextResponse.json({ ok: false, error: String(err).slice(0, 100) }, { status: 500 });
  }
}
