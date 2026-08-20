import { NextResponse } from "next/server";
import { getPipelineSummary } from "@/lib/crm";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const summary = await getPipelineSummary();
    return NextResponse.json(summary);
  } catch (err) {
    logger.error("api.crm.pipeline.failed", { error: String(err) });
    return NextResponse.json({ error: "failed to get pipeline" }, { status: 500 });
  }
}
