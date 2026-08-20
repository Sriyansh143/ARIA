import { NextRequest, NextResponse } from "next/server";
import { makeCall, getTelephonyStatus } from "@/lib/telephony";
import { logger } from "@/lib/logger";
import { z } from "zod";

export const dynamic = "force-dynamic";

const CallSchema = z.object({
  to: z.string().min(4).max(20), // phone number (E.164 or local format)
  from: z.string().optional(),
  message: z.string().max(1000).optional(),
  provider: z.enum(["auto", "freeswitch", "dograh", "twilio"]).default("auto"),
});

/**
 * POST /api/telephony/call — initiate a phone call.
 *
 * Body: { to: "+91...", from?: "+91...", message?: "Hello...", provider?: "auto" }
 *
 * Tries FreeSWITCH first (native, lower latency), then Dograh (cloud).
 * Both providers require AI_CALLER_ENABLED=true and
 * AI_CALLER_CONSENT_VERIFIED=true in .env (legal compliance gate).
 *
 * Returns: { ok, callId, provider, status, error? }
 */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const result = CallSchema.safeParse(body);
  if (!result.success) {
    return NextResponse.json(
      { error: "validation failed", issues: result.error.issues },
      { status: 400 }
    );
  }

  const { to, from, message, provider } = result.data;

  try {
    const callResult = await makeCall({ to, from, message, provider });

    logger.info("api.telephony.call", {
      to,
      provider: callResult.provider,
      status: callResult.status,
      ok: callResult.ok,
    });

    return NextResponse.json(callResult, { status: callResult.ok ? 200 : 502 });
  } catch (err) {
    logger.error("api.telephony.call.error", { error: String(err) });
    return NextResponse.json(
      { ok: false, provider: "freeswitch", status: "failed", error: "internal error" },
      { status: 500 }
    );
  }
}

/** GET /api/telephony/call — returns telephony config status. */
export async function GET() {
  return NextResponse.json(getTelephonyStatus());
}
