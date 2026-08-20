import { NextRequest, NextResponse } from "next/server";
import { sendSms } from "@/lib/telephony";
import { logger } from "@/lib/logger";
import { z } from "zod";

export const dynamic = "force-dynamic";

const SmsSchema = z.object({
  to: z.string().min(4).max(20),
  message: z.string().min(1).max(1600),
  provider: z.enum(["auto", "dograh", "twilio"]).default("auto"),
});

/**
 * POST /api/telephony/sms — send an SMS via Dograh.
 *
 * Body: { to: "+91...", message: "..." }
 *
 * Requires AI_CALLER_ENABLED=true and AI_CALLER_CONSENT_VERIFIED=true.
 *
 * Returns: { ok, messageId, provider, status, error? }
 */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const result = SmsSchema.safeParse(body);
  if (!result.success) {
    return NextResponse.json(
      { error: "validation failed", issues: result.error.issues },
      { status: 400 }
    );
  }

  const { to, message } = result.data;

  try {
    const smsResult = await sendSms({ to, message });

    logger.info("api.telephony.sms", {
      to,
      status: smsResult.status,
      ok: smsResult.ok,
    });

    return NextResponse.json(smsResult, { status: smsResult.ok ? 200 : 502 });
  } catch (err) {
    logger.error("api.telephony.sms.error", { error: String(err) });
    return NextResponse.json(
      { ok: false, provider: "dograh", status: "failed", error: "internal error" },
      { status: 500 }
    );
  }
}
