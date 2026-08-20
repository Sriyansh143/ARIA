import { NextRequest, NextResponse } from "next/server"
import crypto from "crypto"
import { db } from "@/lib/db"
import { logger } from "@/lib/logger"
import { callLLM } from "@/lib/llm-client"
import { sendNotification } from "@/lib/email-service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * POST /api/webhooks/resend — inbound email reply webhook.
 *
 * Configure Resend to send inbound emails here:
 *   Resend Dashboard → Webhooks → Add endpoint → POST /api/webhooks/resend
 *
 * v47 fix 4: Webhook signature verification (Svix). The webhook secret from
 * the Resend dashboard must be set as RESEND_WEBHOOK_SECRET env var. Requests
 * with invalid/missing signatures are rejected with 401. If the env var is
 * not set, the webhook refuses to process (fail-closed) + logs an error.
 *
 * The webhook receives the parsed email content. This route:
 *   1. Verifies the Svix signature
 *   2. Extracts the sender email + body
 *   3. Finds the matching EarningOpportunity by contactEmail
 *   4. Updates the lead status to "replied"
 *   5. Uses the LLM to classify the reply intent
 *   6. Auto-routes based on intent
 */

const BOOKING_URL = process.env.BOOKING_URL || "https://cal.com/aria-mission-control"

/**
 * v47 fix 4: Verify the Svix webhook signature.
 *
 * Svix (used by Resend) signs webhooks with HMAC-SHA256. The signature is
 * computed over: `${svix-id}.${svix-timestamp}.${rawBody}`. The signature
 * header contains one or more space-separated "v1,base64(sig)" tokens.
 * We verify by recomputing the HMAC + comparing in constant time.
 *
 * Also enforces a 5-minute freshness window to prevent replay attacks.
 */
function verifySvixSignature(
  rawBody: string,
  svixId: string,
  svixTimestamp: string,
  svixSignature: string,
  secret: string,
): { valid: boolean; reason?: string } {
  // Freshness check: reject timestamps older than 5 minutes
  const nowMs = Date.now()
  const tsMs = parseInt(svixTimestamp, 10) * 1000
  if (isNaN(tsMs)) {
    return { valid: false, reason: "invalid svix-timestamp (not a number)" }
  }
  if (Math.abs(nowMs - tsMs) > 5 * 60 * 1000) {
    return { valid: false, reason: `timestamp outside 5-min window (skew=${Math.abs(nowMs - tsMs)}ms)` }
  }

  // Svix secrets are prefixed with "whsec_" — strip if present
  const secretKey = secret.startsWith("whsec_") ? secret.slice(6) : secret

  // Compute the expected signature
  const signedPayload = `${svixId}.${svixTimestamp}.${rawBody}`
  const expectedSig = crypto
    .createHmac("sha256", secretKey)
    .update(signedPayload)
    .digest("base64")

  // The svix-signature header is space-separated "v1,base64(sig)" tokens
  // (multiple for key rotation). Check if any matches.
  const signatures = svixSignature.split(" ").map((s) => s.trim())
  for (const sigToken of signatures) {
    // Strip "v1," prefix if present
    const sig = sigToken.startsWith("v1,") ? sigToken.slice(3) : sigToken
    if (sig.length === expectedSig.length) {
      // Constant-time comparison to prevent timing attacks
      if (crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))) {
        return { valid: true }
      }
    }
  }

  return { valid: false, reason: "no matching signature" }
}

export async function POST(req: NextRequest) {
  try {
    // v47 fix 4: Verify the Svix webhook signature.
    const webhookSecret = process.env.RESEND_WEBHOOK_SECRET
    if (!webhookSecret) {
      logger.error("webhook.resend.no-secret", {
        hint: "Set RESEND_WEBHOOK_SECRET env var (from Resend Dashboard → Webhooks → Signing secret)",
      })
      return NextResponse.json(
        { error: "Webhook signature verification not configured (RESEND_WEBHOOK_SECRET missing)" },
        { status: 503 },
      )
    }

    // Get the raw body + Svix headers
    const rawBody = await req.text()
    const svixId = req.headers.get("svix-id") || ""
    const svixTimestamp = req.headers.get("svix-timestamp") || ""
    const svixSignature = req.headers.get("svix-signature") || ""

    if (!svixId || !svixTimestamp || !svixSignature) {
      logger.warn("webhook.resend.missing-svix-headers", {
        hasId: !!svixId,
        hasTs: !!svixTimestamp,
        hasSig: !!svixSignature,
      })
      return NextResponse.json(
        { error: "Missing Svix signature headers (svix-id, svix-timestamp, svix-signature required)" },
        { status: 401 },
      )
    }

    const sigCheck = verifySvixSignature(rawBody, svixId, svixTimestamp, svixSignature, webhookSecret)
    if (!sigCheck.valid) {
      logger.warn("webhook.resend.invalid-signature", { reason: sigCheck.reason })
      return NextResponse.json(
        { error: "Invalid webhook signature" },
        { status: 401 },
      )
    }

    // Parse the verified body
    const body = JSON.parse(rawBody)

    // Resend webhook payload structure (simplified — adapt to actual Resend format)
    const fromEmail = String(body.from || body.sender || "").trim()
    const toEmail = String(body.to || "").trim()
    const subject = String(body.subject || "").trim()
    const textBody = String(body.text || body.body || "").trim()
    const htmlBody = String(body.html || "").trim()

    if (!fromEmail || !textBody) {
      return NextResponse.json({ error: "missing from or body" }, { status: 400 })
    }

    // v45 fix I7: Idempotency. Resend retries webhooks for up to 24h.
    // Use the Resend event ID (body.id or body.event_id) as the dedup key.
    // If we've already processed this event ID, return 200 OK without re-processing.
    const webhookEventId = String(body.id || body.event_id || body.messageId || "").trim()
    if (webhookEventId) {
      const existing = await db.notificationLog.findFirst({
        where: {
          provider: "webhook",
          metadata: { contains: `"webhookEventId":"${webhookEventId}"` },
        },
      })
      if (existing) {
        logger.info("webhook.resend.duplicate", { webhookEventId, logId: existing.id })
        return NextResponse.json({ ok: true, duplicate: true, logId: existing.id })
      }
    }

    logger.info("webhook.resend.inbound", { from: fromEmail, subject: subject.slice(0, 80), webhookEventId })

    // 1. Find the matching EarningOpportunity by contactEmail in the description JSON
    //    We search all "contacted" opportunities for one with this email
    const opportunities = await db.earningOpportunity.findMany({
      where: { source: "lead-finder", status: "contacted" },
    })

    let matchedOpp: Awaited<ReturnType<typeof db.earningOpportunity.findFirst>> = null
    for (const opp of opportunities) {
      try {
        const details = JSON.parse(opp.description || "{}")
        if (details.contactEmail?.toLowerCase() === fromEmail.toLowerCase()) {
          matchedOpp = opp
          break
        }
      } catch {
        continue
      }
    }

    if (!matchedOpp) {
      logger.info("webhook.resend.no-match", { from: fromEmail })
      // Still log it — might be a reply from a non-lead
      await db.notificationLog.create({
        data: {
          channel: "email",
          recipient: fromEmail,
          subject: `Inbound reply: ${subject}`,
          body: textBody.slice(0, 2000),
          status: "sent",
          provider: "webhook",
          metadata: JSON.stringify({ type: "unmatched_reply", subject, webhookEventId }),
        },
      })
      return NextResponse.json({ ok: true, matched: false })
    }

    // 2. Update the lead status to "replied"
    await db.earningOpportunity.update({
      where: { id: matchedOpp.id },
      data: {
        status: "replied",
        description: `${matchedOpp.description}\n---\nReply received: ${subject}\n${textBody.slice(0, 500)}`,
      },
    })

    // 3. Classify the reply intent via LLM
    const intent = await classifyReplyIntent(textBody, matchedOpp.title)

    logger.info("webhook.resend.classified", {
      opportunityId: matchedOpp.id,
      intent: intent.classification,
      confidence: intent.confidence,
    })

    // 4. Auto-route based on intent
    await routeByIntent(intent, matchedOpp, fromEmail, textBody)

    // 5. Log to NotificationLog
    await db.notificationLog.create({
      data: {
        channel: "email",
        recipient: fromEmail,
        subject: `Lead replied: ${matchedOpp.title} [${intent.classification}]`,
        body: textBody.slice(0, 2000),
        status: "sent",
        provider: "webhook",
        metadata: JSON.stringify({
          opportunityId: matchedOpp.id,
          intent: intent.classification,
          confidence: intent.confidence,
          webhookEventId, // v45 fix I7: idempotency key
        }),
      },
    })

    return NextResponse.json({
      ok: true,
      matched: true,
      opportunityId: matchedOpp.id,
      intent: intent.classification,
    })
  } catch (err) {
    logger.error("webhook.resend.failed", { error: String(err) })
    return NextResponse.json({ error: "webhook failed" }, { status: 500 })
  }
}

/**
 * Classify the reply intent using the LLM.
 */
async function classifyReplyIntent(
  replyBody: string,
  leadTitle: string,
): Promise<{ classification: string; confidence: number; reasoning: string }> {
  try {
    const prompt = `You are an intent classifier for sales email replies. Read this reply and classify it.

Lead: ${leadTitle}
Reply: "${replyBody.slice(0, 1000)}"

Classify into exactly ONE of:
- Interested (wants to learn more, schedule a call, asked for pricing)
- Objection (raised a concern, asked a question, needs more info)
- Out-of-Office (auto-reply, will be back later)
- Not-Interested (explicitly declined, not for me)
- Bounce (delivery failed, invalid email)

Respond with ONLY valid JSON:
{"classification": "Interested", "confidence": 85, "reasoning": "1 sentence"}`

    const llmResult = await callLLM("IntentClassifier", "Sales", prompt, {
      systemOverride: "You are an intent classifier. Respond with ONLY valid JSON.",
    })

    if (!llmResult.success) {
      return { classification: "Objection", confidence: 50, reasoning: "LLM classification failed, defaulting to Objection" }
    }

    const jsonMatch = llmResult.completion.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      return { classification: "Objection", confidence: 50, reasoning: "Could not parse LLM response" }
    }

    const parsed = JSON.parse(jsonMatch[0])
    return {
      classification: parsed.classification || "Objection",
      confidence: Math.max(0, Math.min(100, Number(parsed.confidence) || 50)),
      reasoning: parsed.reasoning || "",
    }
  } catch (err) {
    return { classification: "Objection", confidence: 50, reasoning: String(err) }
  }
}

/**
 * Auto-route based on the classified intent.
 */
async function routeByIntent(
  intent: { classification: string; confidence: number; reasoning: string },
  opportunity: { id: string; title: string },
  fromEmail: string,
  replyBody: string,
): Promise<void> {
  switch (intent.classification) {
    case "Interested": {
      // Auto-reply with booking link
      await sendNotification({
        to: fromEmail,
        subject: "Re: Your inquiry — let's schedule a call!",
        text: `Hi,\n\nThanks for your interest! I'd love to learn more about your needs and show you what we can build.\n\nBook a 15-minute call here: ${BOOKING_URL}\n\nLooking forward to it!\n\n— The ARIA Team`,
        metadata: { opportunityId: opportunity.id, type: "booking_auto_reply" },
      })

      // Create a high-priority Task for the owner to prep for the meeting
      await db.task.create({
        data: {
          title: `PREP MEETING: ${opportunity.title}`,
          description: `Lead replied with interest. Reply: "${replyBody.slice(0, 300)}". Prepare for the booked meeting. Booking link: ${BOOKING_URL}`,
          kind: "follow_up",
          status: "pending",
          priority: "critical",
        },
      })

      // Update opportunity to "booked"
      await db.earningOpportunity.update({
        where: { id: opportunity.id },
        data: { status: "booked" },
      })

      logger.success("outreach.interested", { opportunityId: opportunity.id, bookingUrl: BOOKING_URL })
      break
    }

    case "Not-Interested":
    case "Bounce": {
      // Mark as closed-lost, stop the sequence
      await db.earningOpportunity.update({
        where: { id: opportunity.id },
        data: { status: "closed" },
      })

      // Cancel any pending follow_up tasks for this opportunity
      const pendingTasks = await db.task.findMany({
        where: { kind: "follow_up", status: "pending" },
      })
      for (const task of pendingTasks) {
        const opp = await db.earningOpportunity.findFirst({ where: { taskId: task.id } })
        if (opp?.id === opportunity.id) {
          await db.task.update({
            where: { id: task.id },
            data: { status: "completed", result: `Cancelled: lead ${intent.classification}` },
          })
        }
      }

      logger.info("outreach.closed-lost", { opportunityId: opportunity.id, reason: intent.classification })
      break
    }

    case "Out-of-Office": {
      // Keep status as "replied" but schedule a retry in 3 days
      await db.task.create({
        data: {
          title: `Retry outreach: ${opportunity.title} (OOO)`,
          description: `Lead was out-of-office. Retry in 3 days. Original reply: ${replyBody.slice(0, 200)}`,
          kind: "follow_up",
          status: "pending",
          priority: "low",
        },
      })
      break
    }

    case "Objection":
    default: {
      // Route to owner's notification center for manual intervention
      await db.notificationLog.create({
        data: {
          channel: "internal",
          recipient: "owner",
          subject: `Lead needs manual follow-up: ${opportunity.title}`,
          body: `Intent: ${intent.classification} (${intent.confidence}% confidence)\nReasoning: ${intent.reasoning}\n\nReply:\n${replyBody.slice(0, 1000)}`,
          status: "pending",
          provider: "internal",
          metadata: JSON.stringify({
            opportunityId: opportunity.id,
            intent: intent.classification,
            type: "manual_followup_needed",
          }),
        },
      })
      break
    }
  }
}
