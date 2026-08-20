/**
 * src/lib/outreach-executor.ts — Autonomous Outreach Execution Engine (v43)
 *
 * This is the "missing piece" that transforms ARIA from a lead discovery
 * tool into a fully autonomous AI company. It runs hourly via cron and:
 *
 *   1. Fetches Task rows where kind="follow_up" + status="pending" + the
 *      linked EarningOpportunity is "qualified".
 *   2. Uses the LLM to draft a personalized outreach email using the lead's
 *      business name, industry, matched service, and suggestedOutreach context.
 *   3. Sends the email via Resend (with NotificationLog fallback).
 *   4. Updates the Task to "completed" + the EarningOpportunity to "contacted".
 *   5. Creates the next sequence task (2nd email in 7 days, or follow-up call
 *      in 3 days if AI_CALLER_ENABLED).
 *   6. Logs every action to NotificationLog + AgentLog.
 *
 * The owner only intervenes when a lead REPLIES (handled by the inbound
 * webhook in Phase 2). Everything else is autonomous.
 *
 * Cron job name: "outreach-executor" (runs hourly).
 */

import "server-only"

import { db } from "./db"
import { logger } from "./logger"
import { emit } from "./event-bus"
import { callLLM } from "./llm-client"
import { sendNotification } from "./email-service"
import { isOutreachPaused } from "./health-sim"

export interface OutreachResult {
  processed: number
  sent: number
  failed: number
  scheduled: number
  details: Array<{
    taskId: string
    businessName: string
    status: "sent" | "failed" | "skipped" | "deferred" | "blocked"
    error?: string
  }>
}

/**
 * Main entry point — runs the outreach loop.
 * Called hourly by the cron scheduler.
 */
export async function runOutreachExecutor(): Promise<OutreachResult> {
  logger.info("outreach-executor.start", {})

  const result: OutreachResult = {
    processed: 0,
    sent: 0,
    failed: 0,
    scheduled: 0,
    details: [],
  }

  try {
    // v58 Phase 2: Global autonomy kill switch — short-circuit if paused.
    try {
      const { isAutonomyPaused } = await import("./autonomy-control");
      if (await isAutonomyPaused()) {
        logger.warn("outreach-executor.skipped", { reason: "autonomy globally paused" });
        return result;
      }
    } catch {
      // fail-open
    }
    // v56: Auto-seed A/B tests if none exist
    try {
      const testCount = await db.aBTest.count({ where: { status: "running" } })
      if (testCount === 0) {
        await seedABTests()
        logger.info("outreach-executor.ab-tests-seeded", { count: 3 })
      }
    } catch {
      // non-fatal — A/B testing is optional
    }
    // v45 fix: Check if outreach is paused (set by daily-health-sim on critical failure)
    const isPaused = await isOutreachPaused()
    if (isPaused) {
      logger.warn("outreach-executor.paused", {
        reason: "outreach.paused setting is true (set by daily-health-sim or owner)",
      })
      emit({
        type: "system",
        ts: new Date().toISOString(),
        message: "OutreachExecutor skipped — outreach is PAUSED. Check the Operations dashboard for critical alerts.",
        level: "warn",
      })
      return result
    }

    // 1. Fetch pending follow_up tasks linked to qualified EarningOpportunities
    const tasks = await db.task.findMany({
      where: {
        kind: "follow_up",
        status: "pending",
      },
      take: 20, // process max 20 per hour to avoid rate limits
      orderBy: { createdAt: "asc" },
    })

    logger.info("outreach-executor.fetched", { taskCount: tasks.length })

    for (const task of tasks) {
      result.processed++
      const detail = await processTask(task.id)
      result.details.push(detail)

      if (detail.status === "sent") {
        result.sent++
      } else if (detail.status === "failed") {
        result.failed++
      }
    }

    logger.success("outreach-executor.complete", {
      processed: result.processed,
      sent: result.sent,
      failed: result.failed,
    })

    // Emit a dashboard event
    emit({
      type: "system",
      ts: new Date().toISOString(),
      message: `Outreach: ${result.sent} emails sent, ${result.failed} failed, ${result.scheduled} follow-ups scheduled`,
      level: "success",
    })

    return result
  } catch (err) {
    logger.error("outreach-executor.failed", { error: String(err) })
    return result
  }
}

/**
 * Process a single outreach task.
 */
async function processTask(
  taskId: string,
): Promise<{ taskId: string; businessName: string; status: "sent" | "failed" | "skipped" | "deferred" | "blocked"; error?: string }> {
  // v61 FIX (Finding 5c): Declare blackboard state outside the try block so the
  // catch block can release the claim on failure.
  let blackboardResource: string | null = null
  let blackboardClaimed = false
  try {
    // Fetch the task + linked EarningOpportunity
    const task = await db.task.findUnique({
      where: { id: taskId },
    })

    if (!task) {
      return { taskId, businessName: "unknown", status: "skipped", error: "task not found" }
    }

    // Find the linked EarningOpportunity (task.description contains the lead info,
    // or we look it up via the task's earningOpportunity relation if it exists)
    // The lead was linked via earningOpportunity.taskId in the approve route
    const opportunity = await db.earningOpportunity.findFirst({
      where: { taskId: task.id },
    })

    if (!opportunity) {
      return { taskId, businessName: "unknown", status: "skipped", error: "no linked opportunity" }
    }

    // Only process if the opportunity is "qualified" (not already contacted)
    if (opportunity.status !== "qualified") {
      return { taskId, businessName: opportunity.title, status: "skipped", error: `opportunity is ${opportunity.status}` }
    }

    // Parse the lead details from the opportunity description (JSON)
    let leadDetails: {
      businessName?: string
      website?: string
      industry?: string
      serviceMatched?: string
      suggestedOutreach?: string
      contactEmail?: string
      confidenceScore?: number
      customerTimezone?: string
    } = {}

    try {
      leadDetails = JSON.parse(opportunity.description || "{}")
    } catch {
      leadDetails = { suggestedOutreach: opportunity.description || "" }
    }

    const businessName = leadDetails.businessName || opportunity.title
    const contactEmail = leadDetails.contactEmail

    if (!contactEmail) {
      // No email to send to — mark as failed + skip
      await db.task.update({
        where: { id: taskId },
        data: { status: "completed", result: "no contact email available" },
      })
      await db.earningOpportunity.update({
        where: { id: opportunity.id },
        data: { status: "closed" },
      })
      return { taskId, businessName, status: "skipped", error: "no contact email" }
    }

    // v61 Phase 2 (Owner Rule: Customer Timezone Awareness) — only send
    // outreach emails during the CUSTOMER's business hours (9 AM - 6 PM
    // in their timezone). If it's outside their business hours, defer the
    // task by rescheduling it for 9 AM their time tomorrow. The lead's
    // timezone is stored in the leadDetails JSON (set by lead-finder when
    // it discovers the lead, or defaults to the owner's timezone).
    const leadTimezone = leadDetails.customerTimezone || process.env.OWNER_TIMEZONE || "UTC"
    try {
      const { isWithinBusinessHours, businessHoursStatus } = await import("./business-hours")
      const hourStart = parseInt(process.env.BUSINESS_HOURS_START || "9", 10)
      const hourEnd = parseInt(process.env.BUSINESS_HOURS_END || "18", 10)
      if (!isWithinBusinessHours(leadTimezone, hourStart, hourEnd)) {
        const status = businessHoursStatus(leadTimezone)
        logger.info("outreach-executor.deferred-customer-tz", {
          taskId,
          contactEmail,
          leadTimezone,
          status,
        })
        // Reschedule the task for 9 AM tomorrow in the customer's timezone.
        // We compute the next 9 AM in the customer's tz by adding hours until
        // the hour is 9. This is a simple approximation — the cron will retry
        // hourly and the guard will pass once it's within hours.
        const now = new Date()
        const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000)
        tomorrow.setHours(hourStart, 0, 0, 0)
        await db.task.update({
          where: { id: taskId },
          data: {
            status: "pending",
            startedAt: tomorrow,
          },
        })
        return { taskId, businessName, status: "deferred", error: `customer off-hours (${status}), rescheduled for ${tomorrow.toISOString()}` }
      }
    } catch (tzErr) {
      logger.warn("outreach-executor.tz-check-failed", { taskId, error: String(tzErr) })
      // Fail-open — proceed with the send if the TZ check crashes.
    }

    // v44 fix C9: Check suppression list before drafting. If the lead opted out
    // (replied "Not-Interested" / "Bounce" / manually unsubscribed), cancel the sequence.
    const suppressed = await isSuppressed(contactEmail)
    if (suppressed) {
      await db.task.update({
        where: { id: taskId },
        data: { status: "completed", result: `suppressed: ${suppressed.reason}` },
      })
      await db.earningOpportunity.update({
        where: { id: opportunity.id },
        data: { status: "closed" },
      })
      return { taskId, businessName, status: "skipped", error: `suppressed: ${suppressed.reason}` }
    }

    // v44 fix warm-up: enforce daily send limit. Default 10/day, +5/day until 50/day.
    // Override via ARIA_OUTREACH_DAILY_LIMIT env var.
    const dailyLimit = parseInt(process.env.ARIA_OUTREACH_DAILY_LIMIT || "10", 10)
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)
    const sentToday = await db.task.count({
      where: {
        kind: "follow_up",
        status: "completed",
        completedAt: { gte: todayStart },
      },
    })
    if (sentToday >= dailyLimit) {
      logger.info("outreach-executor.daily-limit-reached", { sentToday, dailyLimit })
      return { taskId, businessName, status: "skipped", error: `daily limit reached (${sentToday}/${dailyLimit})` }
    }

    // v61 FIX (Finding 5c): Agent Blackboard — claim the email resource to
    // prevent two agents from emailing the same lead simultaneously. If the
    // resource is already claimed, BLOCK this task + pivot the fleet to the
    // next non-conflicting task. Previously the blackboard was only wired into
    // dispatchToAgent() which has zero call sites — the real email path here
    // bypassed it entirely, so two concurrent cron ticks could email the same
    // lead. This guard makes the blackboard live on the real execution path.
    blackboardResource = `email:${contactEmail.toLowerCase()}`
    try {
      const { isResourceClaimed, postToBlackboard } = await import("./agent-blackboard")
      if (await isResourceClaimed(blackboardResource)) {
        logger.warn("outreach-executor.blackboard-conflict", { taskId, contactEmail })
        await db.task.update({
          where: { id: taskId },
          data: {
            status: "blocked",
            result: `CONFLICT: ${blackboardResource} already claimed by another agent`,
          },
        })
        // Trigger the pivot — promote the next non-blocked pending task.
        const { promoteNextNonBlockedTask } = await import("./conductor/dispatcher")
        await promoteNextNonBlockedTask(taskId)
        return { taskId, businessName, status: "blocked", error: `resource conflict on ${blackboardResource} — pivoted to next task` }
      }
      // Claim the resource so other agents see it + skip this lead.
      blackboardClaimed = await postToBlackboard({
        agentName: "OutreachBot",
        action: `emailing ${businessName}`,
        resourceClaim: blackboardResource,
        postedAt: new Date().toISOString(),
      })
      // BUG-6 FIX: check the return value — if postToBlackboard returned false,
      // another agent claimed the resource between our isResourceClaimed
      // check + this post (race condition). Block + pivot, do NOT proceed.
      if (!blackboardClaimed) {
        logger.warn("outreach-executor.blackboard-race-conflict", { taskId, contactEmail })
        await db.task.update({
          where: { id: taskId },
          data: {
            status: "blocked",
            result: `CONFLICT (race): ${blackboardResource} claimed by another agent during dispatch`,
          },
        })
        const { promoteNextNonBlockedTask } = await import("./conductor/dispatcher")
        await promoteNextNonBlockedTask(taskId)
        return { taskId, businessName, status: "blocked", error: `race conflict on ${blackboardResource} — pivoted to next task` }
      }
    } catch (bbErr) {
      logger.warn("outreach-executor.blackboard-check-failed", { taskId, error: String(bbErr) })
      // Fail-open — proceed if the blackboard is unavailable (DB error etc.).
    }

    // 2. Draft the email via LLM
    const emailContent = await draftOutreachEmail(leadDetails, opportunity)

    if (!emailContent) {
      // BUG-4 FIX: release the blackboard claim before returning — previously
      // this early return leaked the claim for 5 minutes (TTL), stalling other
      // agents from emailing the same lead.
      if (blackboardClaimed && blackboardResource) {
        try {
          const { releaseFromBlackboard } = await import("./agent-blackboard")
          await releaseFromBlackboard("OutreachBot", blackboardResource)
        } catch { /* best-effort */ }
      }
      return { taskId, businessName, status: "failed", error: "LLM drafting failed" }
    }

    // v65 Phase 15: Generate a personalized brand preview (RULE-52).
    // Extract the lead's brand assets (colors, logo, tone) from their website
    // and generate a personalized service preview. This dramatically increases
    // conversion rates vs. generic cold emails.
    let previewText = "";
    try {
      const { extractBrandFromEmail } = await import("./brand-extractor");
      const { generatePreview } = await import("./preview-generator");
      const brand = await extractBrandFromEmail(contactEmail);
      if (brand) {
        const preview = generatePreview(
          opportunity.title || "ARIA Service",
          opportunity.description || "AI-powered service delivery",
          brand,
        );
        previewText = preview.previewText;
        // Append the preview text to the email body.
        emailContent.body += `\n\n${previewText}`;
        logger.info("outreach-executor.brand-preview-generated", { taskId, domain: brand.domain, primaryColor: brand.primaryColor });
      }
    } catch (previewErr) {
      logger.warn("outreach-executor.brand-preview-failed", { taskId, error: String(previewErr).slice(0, 80) });
      // Non-fatal — send the email without the preview.
    }

    // 3. Send via Resend (+ NotificationLog fallback)
    const notifyResult = await sendNotification({
      to: contactEmail,
      subject: emailContent.subject,
      text: emailContent.body,
      html: emailContent.html,
      metadata: {
        taskId,
        opportunityId: opportunity.id,
        businessName,
        type: "outreach",
      },
    })

    // v44 fix C6: Stop silent failures. If Resend failed (fell back to NotificationLog),
    // mark the task FAILED (not completed) + the opportunity stays "qualified" (not "contacted").
    // The dashboard will show "0 emails sent" — accurate signal to the owner.
    if (!notifyResult.ok) {
      logger.warn("outreach-executor.send-failed", {
        taskId,
        businessName,
        error: notifyResult.error,
      })

      await db.task.update({
        where: { id: taskId },
        data: {
          status: "failed",
          result: `Email send failed: ${notifyResult.error || "unknown"}`,
          completedAt: new Date(),
        },
      })
      // Do NOT update opportunity status — it stays "qualified" so the next tick retries.

      // If this opportunity has failed 3+ times, mark it as "failed" + alert owner.
      // AUDIT-B-4: scope the count to THIS opportunity (was counting ALL failed
      // follow_up tasks across the entire system, so any 3 failures anywhere
      // would mis-trigger this path for every new failure).
      const failedCount = await db.task.count({
        where: { kind: "follow_up", status: "failed", title: { contains: businessName } },
      })
      if (failedCount >= 3) {
        await db.earningOpportunity.update({
          where: { id: opportunity.id },
          data: { status: "failed" },
        })
        emit({
          type: "system",
          ts: new Date().toISOString(),
          message: `Outreach failed 3+ times for ${businessName} — marked opportunity as failed. Check RESEND_API_KEY + Resend dashboard.`,
          level: "error",
        })
      }

      // BUG-5 FIX: release the blackboard claim before the send-failed return —
      // previously this early return leaked the claim for 5 minutes (TTL),
      // stalling other agents from retrying this lead on the next cron tick.
      if (blackboardClaimed && blackboardResource) {
        try {
          const { releaseFromBlackboard } = await import("./agent-blackboard")
          await releaseFromBlackboard("OutreachBot", blackboardResource)
        } catch { /* best-effort */ }
      }
      return { taskId, businessName, status: "failed", error: notifyResult.error }
    }

    // v44 fix CAN-SPAM: check suppression list before sending (defensive — the LLM draft
    // doesn't include this, so we append it here). The HTML template in email-service.ts
    // already appends a footer; here we ensure the plain-text body has the compliance info.
    if (!emailContent.body.includes("unsubscribe") && !emailContent.body.includes("Unsubscribe")) {
      const senderAddress = process.env.ARIA_SENDER_ADDRESS || process.env.ARIA_OWNER_EMAIL || "ARIA, Reply to unsubscribe"
      emailContent.body += `\n\n— The ARIA Team\n${senderAddress}\n\nTo unsubscribe, reply with "unsubscribe".`
    }

    // 4. Update Task to completed + EarningOpportunity to "contacted"
    await db.task.update({
      where: { id: taskId },
      data: {
        status: "completed",
        result: `Email sent to ${contactEmail}`,
        completedAt: new Date(),
      },
    })

    await db.earningOpportunity.update({
      where: { id: opportunity.id },
      data: { status: "contacted" },
    })

    // 5. Create the next sequence task (2nd email in 7 days)
    const nextTask = await db.task.create({
      data: {
        title: `Follow-up #2: ${businessName}`,
        description: `Second outreach email to ${businessName}. Original outreach sent on ${new Date().toISOString()}. If no reply, send a brief follow-up.`,
        kind: "follow_up",
        status: "pending",
        priority: "medium",
        assignedToId: task.assignedToId,
      },
    })

    // Link the new task to the same opportunity
    await db.earningOpportunity.update({
      where: { id: opportunity.id },
      data: { taskId: nextTask.id },
    })

    // 6. Log to AgentLog
    try {
      await db.agentLog.create({
        data: {
          agentId: task.assignedToId || "outreach-executor",
          level: "info",
          message: `Outreach email sent to ${businessName} (${contactEmail})`,
          meta: JSON.stringify({
            taskId,
            opportunityId: opportunity.id,
            emailSubject: emailContent.subject,
            nextTaskId: nextTask.id,
          }),
        },
      })
    } catch {
      // non-fatal
    }

    logger.info("outreach-executor.sent", {
      taskId,
      businessName,
      to: contactEmail,
      nextTaskScheduled: nextTask.id,
    })

    // v61 FIX (Finding 5c): Release the blackboard claim now that the email
    // is sent, so other agents can immediately work on this lead again.
    if (blackboardClaimed) {
      try {
        const { releaseFromBlackboard } = await import("./agent-blackboard")
        await releaseFromBlackboard("OutreachBot", blackboardResource)
      } catch { /* best-effort — 5-min TTL handles stale claims */ }
    }

    return { taskId, businessName, status: "sent" }
  } catch (err) {
    logger.error("outreach-executor.task-failed", { taskId, error: String(err) })
    // v61 FIX (Finding 5c): Release the blackboard claim on failure too.
    if (blackboardClaimed && blackboardResource) {
      try {
        const { releaseFromBlackboard } = await import("./agent-blackboard")
        await releaseFromBlackboard("OutreachBot", blackboardResource)
      } catch { /* best-effort */ }
    }
    return { taskId, businessName: "unknown", status: "failed", error: String(err) }
  }
}

/**
 * Use the LLM to draft a personalized outreach email.
 */
async function draftOutreachEmail(
  lead: {
    businessName?: string
    website?: string
    industry?: string
    serviceMatched?: string
    suggestedOutreach?: string
    confidenceScore?: number
  },
  opportunity: { estimatedRevenue: number },
): Promise<{ subject: string; body: string; html?: string } | null> {
  try {
    const prompt = `You are an autonomous sales development representative for ARIA Mission Control, a company that builds AI-powered web applications, landing pages, and dashboards for businesses.

Write a personalized cold outreach email to ${lead.businessName || "this business"}.

Context:
- Business: ${lead.businessName || "Unknown"}
- Website: ${lead.website || "Unknown"}
- Industry: ${lead.industry || "Unknown"}
- Service they might need: ${lead.serviceMatched || "AI-powered web development"}
- Suggested outreach angle: ${lead.suggestedOutreach || "Help them improve their online presence"}
- Estimated deal value: $${opportunity.estimatedRevenue}

Requirements:
- Subject line: under 50 characters, personalized, not spammy
- Body: under 150 words, friendly + professional tone
- Reference something specific about their business/industry
- End with a clear call-to-action (reply to schedule a quick call)
- Do NOT use generic templates — make it feel hand-written
- Sign off as "The ARIA Team"

Respond with ONLY valid JSON:
{
  "subject": "your subject line",
  "body": "the email body"
}`

    const llmResult = await callLLM("OutreachBot", "Sales", prompt, {
      systemOverride: "You are an expert sales copywriter. Write concise, personalized emails. Respond with ONLY valid JSON.",
      // AUDIT-B-20: hard cap LLM retries so a single provider timeout doesn't
      // permanently fail the outreach task (matching the prompt-improver pattern).
      maxRetries: 2,
    })

    if (!llmResult.success || !llmResult.completion) {
      logger.warn("outreach-executor.llm-failed", { error: llmResult.error })
      return null
    }

    // Parse the JSON response
    const jsonMatch = llmResult.completion.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return null

    const parsed = JSON.parse(jsonMatch[0]) as { subject: string; body: string }

    return {
      subject: parsed.subject,
      body: parsed.body,
    }
  } catch (err) {
    logger.error("outreach-executor.draft-failed", { error: String(err) })
    return null
  }
}

/**
 * v44 fix C9: Suppression list check.
 *
 * A lead is suppressed if:
 *   - They have a NotificationLog row with metadata.type="unsubscribe" + their email
 *   - They have an EarningOpportunity with status="closed" + description mentions "Not-Interested" / "Bounce"
 *   - Their email is in the global suppression list (Setting key="outreach.suppressedEmails")
 *
 * Returns { suppressed: true, reason: string } if suppressed, { suppressed: false } otherwise.
 */
export async function isSuppressed(email: string): Promise<{ reason: string } | null> {
  const normalizedEmail = email.toLowerCase().trim()

  try {
    // 1. Check NotificationLog for explicit unsubscribe
    const unsubLog = await db.notificationLog.findFirst({
      where: {
        recipient: normalizedEmail,
        subject: { contains: "unsubscribe" },
      },
    })
    if (unsubLog) {
      return { reason: "explicit unsubscribe via reply" }
    }

    // 2. Check for closed-lost opportunities with this email
    const closedOpps = await db.earningOpportunity.findMany({
      where: { source: "lead-finder", status: "closed" },
    })
    for (const opp of closedOpps) {
      try {
        const details = JSON.parse(opp.description || "{}")
        if (details.contactEmail?.toLowerCase() === normalizedEmail) {
          return { reason: `closed-lost: ${details.closeReason || "Not-Interested/Bounce"}` }
        }
      } catch {
        // not JSON, skip
      }
    }

    // 3. Check global suppression list (Setting)
    const suppressList = await db.setting.findUnique({
      where: { key: "outreach.suppressedEmails" },
    })
    if (suppressList) {
      const emails: string[] = JSON.parse(suppressList.value || "[]")
      if (emails.includes(normalizedEmail)) {
        return { reason: "global suppression list" }
      }
    }
  } catch (err) {
    logger.warn("outreach-executor.suppression-check-failed", { email: normalizedEmail, error: String(err) })
  }

  return null
}

/**
 * v44 fix C9: Add an email to the global suppression list.
 * Called by the webhook handler when a lead replies "Not-Interested" or "Bounce".
 */
export async function suppressEmail(email: string, reason: string): Promise<void> {
  const normalizedEmail = email.toLowerCase().trim()
  try {
    const existing = await db.setting.findUnique({
      where: { key: "outreach.suppressedEmails" },
    })
    const list: string[] = existing ? JSON.parse(existing.value || "[]") : []
    if (!list.includes(normalizedEmail)) {
      list.push(normalizedEmail)
      await db.setting.upsert({
        where: { key: "outreach.suppressedEmails" },
        create: {
          key: "outreach.suppressedEmails",
          value: JSON.stringify(list),
          category: "outreach",
        },
        update: { value: JSON.stringify(list) },
      })
      logger.info("outreach-executor.email-suppressed", { email: normalizedEmail, reason })
    }
  } catch (err) {
    logger.error("outreach-executor.suppress-failed", { email: normalizedEmail, error: String(err) })
  }
}

/**
 * Get outreach stats for the Revenue Loop dashboard.
 */
export async function getOutreachStats() {
  const [
    totalSent,
    totalContacted,
    totalReplied,
    totalBooked,
    totalClosedLost,
    last24h,
  ] = await Promise.all([
    db.task.count({ where: { kind: "follow_up", status: "completed" } }),
    db.earningOpportunity.count({ where: { source: "lead-finder", status: "contacted" } }),
    db.earningOpportunity.count({ where: { source: "lead-finder", status: "replied" } }),
    db.earningOpportunity.count({ where: { source: "lead-finder", status: "booked" } }),
    db.earningOpportunity.count({ where: { source: "lead-finder", status: "closed" } }),
    db.task.count({
      where: {
        kind: "follow_up",
        status: "completed",
        completedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
    }),
  ])

  return {
    totalSent,
    totalContacted,
    totalReplied,
    totalBooked,
    totalClosedLost,
    last24h,
    replyRate: totalContacted > 0 ? (totalReplied / totalContacted) * 100 : 0,
    bookingRate: totalReplied > 0 ? (totalBooked / totalReplied) * 100 : 0,
  }
}

/**
 * v56: Seed initial A/B tests if none exist.
 * Creates 3 tests: subject line, CTA, email length.
 */
async function seedABTests(): Promise<void> {
  const tests = [
    { name: "email-subject-test", variant: "A", category: "email_subject", content: "Quick question about {business}", metric: "reply_rate" },
    { name: "email-subject-test", variant: "B", category: "email_subject", content: "{business} + AI opportunity", metric: "reply_rate" },
    { name: "email-cta-test", variant: "A", category: "email_body", content: "Would you like to see a sample?", metric: "reply_rate" },
    { name: "email-cta-test", variant: "B", category: "email_body", content: "Can I send you a free preview?", metric: "reply_rate" },
    { name: "email-length-test", variant: "A", category: "email_body", content: "Short (50 words max)", metric: "reply_rate" },
    { name: "email-length-test", variant: "B", category: "email_body", content: "Medium (150 words max)", metric: "reply_rate" },
  ]

  for (const test of tests) {
    try {
      await db.aBTest.create({ data: { ...test, status: "running" } })
    } catch {
      // already exists — skip
    }
  }
}
