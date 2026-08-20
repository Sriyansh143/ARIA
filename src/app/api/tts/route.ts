import { NextResponse } from "next/server";
import { getTTSStatus } from "@/lib/tts";

export const dynamic = "force-dynamic";

/**
 * GET /api/tts — returns TTS engine status.
 * Browser TTS (Web Speech API) is always available client-side.
 * Z-AI TTS is available if ZAI_TTS_ENABLED=true.
 */
export async function GET() {
  try {

  return NextResponse.json(getTTSStatus());

  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
