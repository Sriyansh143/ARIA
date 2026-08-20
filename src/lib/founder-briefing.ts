/**
 * src/lib/founder-briefing.ts — Daily Morning Report Engine (v44)
 *
 * Runs daily at 8:00 AM via cron. Aggregates the last 24 hours of activity
 * across revenue, sales pipeline, operations, and system health, then sends
 * a beautifully formatted HTML email to the owner via Resend.
 *
 * The founder wakes up to a single email that tells them exactly how their
 * autonomous AI company performed yesterday — no dashboard login required.
 *
 * Aggregates:
 *   - Revenue: crypto payments verified + auto-delivered
 *   - Sales Pipeline: leads discovered, outreach sent, replies, meetings booked
 *   - Operations: ServiceBuilder jobs completed, quality gate pass/fail
 *   - System Health: self-heal events, critical errors, uptime
 *
 * Cron job name: "founder-briefing" (schedule: "0 8 * * *")
 */

import "server-only"

import { db } from "./db"
import { logger } from "./logger"
import { emit } from "./event-bus"
import { sendNotification } from "./email-service"
import { getOutreachStats } from "./outreach-executor"

export interface BriefingData {
  date: string
  revenue: {
    collectedCents: number
    ordersDelivered: number
    ordersPending: number
    ordersRefunded: number
  }
  sales: {
    leadsDiscovered: number
    leadsQualified: number
    emailsSent: number
    repliesReceived: number
    meetingsBooked: number
    replyRate: number
  }
  operations: {
    buildsCompleted: number
    buildsFailed: number
    qualityGatePassRate: number
  }
  system: {
    selfHealEvents: number
    criticalErrors: number
    totalErrors: number
    bootstrapped: boolean
  }
  topLeads: Array<{
    title: string
    confidenceScore: number
    status: string
  }>
}

/**
 * Main entry point — runs the daily briefing.
 */
export async function runFounderBriefing(): Promise<{ ok: boolean; sent: boolean; error?: string }> {
  logger.info("founder-briefing.start", {})

  try {
    // 1. Gather the data
    const data = await gatherBriefingData()

    // 2. Get the owner's email
    const ownerEmail = process.env.ARIA_OWNER_EMAIL
    if (!ownerEmail) {
      logger.warn("founder-briefing.no-owner-email", {})
      return { ok: true, sent: false, error: "ARIA_OWNER_EMAIL not set" }
    }

    // 3. Build the HTML email
    const subject = buildSubjectLine(data)
    const html = buildBriefingHtml(data)
    const text = buildBriefingText(data)

    // 4. Send via Resend (+ NotificationLog fallback)
    const result = await sendNotification({
      to: ownerEmail,
      subject,
      html,
      text,
      metadata: { type: "founder-briefing", date: data.date },
    })

    logger.success("founder-briefing.sent", {
      to: ownerEmail,
      subject,
      collectedCents: data.revenue.collectedCents,
      emailsSent: data.sales.emailsSent,
    })

    // Emit a dashboard event
    emit({
      type: "system",
      ts: new Date().toISOString(),
      message: `Founder briefing sent: $${(data.revenue.collectedCents / 100).toFixed(2)} collected, ${data.sales.emailsSent} outreach emails, ${data.sales.meetingsBooked} meetings booked`,
      level: "success",
    })

    return { ok: true, sent: result.ok }
  } catch (err) {
    logger.error("founder-briefing.failed", { error: String(err) })
    return { ok: false, sent: false, error: String(err) }
  }
}

/**
 * Gather 24 hours of activity from the database.
 */
async function gatherBriefingData(): Promise<BriefingData> {
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const today = new Date()

  // Run all queries in parallel
  const [
    deliveredOrders,
    pendingOrders,
    refundedOrders,
    leadsDiscovered,
    leadsQualified,
    outreachStats,
    repliesReceived,
    meetingsBooked,
    buildsCompleted,
    buildsFailed,
    selfHealStatus,
    criticalErrors,
    totalErrors,
    topLeads,
  ] = await Promise.all([
    // Revenue
    db.serviceOrder.count({
      where: { status: "delivered", deliveredAt: { gte: yesterday } },
    }),
    db.serviceOrder.count({
      where: { status: { in: ["pending_payment", "building"] }, createdAt: { gte: yesterday } },
    }),
    db.serviceOrder.count({
      where: { status: "refunded", updatedAt: { gte: yesterday } },
    }),
    // Sales
    db.earningOpportunity.count({
      where: { source: "lead-finder", discoveredAt: { gte: yesterday } },
    }),
    db.earningOpportunity.count({
      where: { source: "lead-finder", status: { in: ["qualified", "contacted", "replied", "booked"] }, updatedAt: { gte: yesterday } },
    }),
    getOutreachStats(),
    db.earningOpportunity.count({
      where: { source: "lead-finder", status: { in: ["replied", "booked"] }, updatedAt: { gte: yesterday } },
    }),
    db.earningOpportunity.count({
      where: { source: "lead-finder", status: "booked", updatedAt: { gte: yesterday } },
    }),
    // Operations
    db.serviceOrder.count({
      where: { status: "delivered", deliveredAt: { gte: yesterday } },
    }),
    db.serviceOrder.count({
      where: { status: "failed", updatedAt: { gte: yesterday } },
    }),
    // System health
    getSelfHealStatusSafe(),
    db.errorLog.count({
      where: { severity: "fatal", createdAt: { gte: yesterday } },
    }),
    db.errorLog.count({
      where: { createdAt: { gte: yesterday } },
    }),
    // Top leads
    db.earningOpportunity.findMany({
      where: { source: "lead-finder", discoveredAt: { gte: yesterday } },
      orderBy: { feasibilityScore: "desc" },
      take: 3,
      select: { title: true, feasibilityScore: true, status: true, description: true },
    }),
  ])

  // Calculate revenue collected
  const deliveredOrdersData = await db.serviceOrder.findMany({
    where: { status: "delivered", deliveredAt: { gte: yesterday } },
    select: { priceCents: true },
  })
  const collectedCents = deliveredOrdersData.reduce((sum, o) => sum + o.priceCents, 0)

  // Parse top leads
  const topLeadsParsed = topLeads.map((lead) => {
    let confidence = lead.feasibilityScore * 100
    try {
      const details = JSON.parse(lead.description || "{}")
      confidence = details.confidenceScore ?? confidence
    } catch {
      // keep default
    }
    return {
      title: lead.title,
      confidenceScore: Math.round(confidence),
      status: lead.status,
    }
  })

  // Calculate quality gate pass rate (completed / (completed + failed))
  const totalBuilds = buildsCompleted + buildsFailed
  const qualityGatePassRate = totalBuilds > 0 ? (buildsCompleted / totalBuilds) * 100 : 100

  return {
    date: today.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" }),
    revenue: {
      collectedCents,
      ordersDelivered: deliveredOrders,
      ordersPending: pendingOrders,
      ordersRefunded: refundedOrders,
    },
    sales: {
      leadsDiscovered,
      leadsQualified,
      emailsSent: outreachStats.last24h,
      repliesReceived,
      meetingsBooked,
      replyRate: outreachStats.replyRate,
    },
    operations: {
      buildsCompleted,
      buildsFailed,
      qualityGatePassRate,
    },
    system: {
      selfHealEvents: selfHealStatus?.healCount ?? 0,
      criticalErrors,
      totalErrors,
      bootstrapped: selfHealStatus?.bootstrapped ?? false,
    },
    topLeads: topLeadsParsed,
  }
}

/**
 * Get self-heal status safely (never throws).
 */
async function getSelfHealStatusSafe(): Promise<{ healCount: number; bootstrapped: boolean } | null> {
  try {
    const { getSelfHealStatus } = await import("./self-heal")
    return getSelfHealStatus()
  } catch {
    return null
  }
}

/**
 * Build a dynamic subject line.
 * Example: "☀️ ARIA Daily Briefing: $42.00 collected, 5 leads contacted"
 */
function buildSubjectLine(data: BriefingData): string {
  const collected = (data.revenue.collectedCents / 100).toFixed(2)
  const contacted = data.sales.emailsSent
  return `☀️ ARIA Daily Briefing: $${collected} collected, ${contacted} leads contacted`
}

/**
 * Build a beautiful responsive HTML email.
 */
function buildBriefingHtml(data: BriefingData): string {
  const dashboardUrl = process.env.NEXTAUTH_URL || process.env.ARIA_PUBLIC_URL || "http://localhost:3000"
  const collected = (data.revenue.collectedCents / 100).toFixed(2)
  const replyRate = data.sales.replyRate.toFixed(1)
  const passRate = data.operations.qualityGatePassRate.toFixed(0)

  // Health status
  const healthColor = data.system.criticalErrors > 0 ? "#f87171" : data.system.totalErrors > 5 ? "#fbbf24" : "#34d399"
  const healthStatus = data.system.criticalErrors > 0 ? "Needs Attention" : data.system.totalErrors > 5 ? "Minor Issues" : "All Systems Go"

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ARIA Daily Briefing</title>
</head>
<body style="margin:0;padding:0;background-color:#0a0e0f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#0a0e0f;padding:24px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background-color:#141a1d;border:1px solid #2a3338;border-radius:12px;overflow:hidden;max-width:600px;width:100%;">

        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,#10b981,#0d9488);padding:24px 32px;">
            <h1 style="margin:0;color:#fff;font-size:22px;font-weight:700;">☀️ ARIA Daily Briefing</h1>
            <p style="margin:4px 0 0 0;color:rgba(255,255,255,0.8);font-size:13px;">${data.date}</p>
          </td>
        </tr>

        <!-- Subject Summary -->
        <tr>
          <td style="padding:24px 32px 16px;">
            <div style="background:rgba(16,185,129,0.08);border:1px solid rgba(16,185,129,0.2);border-radius:8px;padding:16px;">
              <p style="margin:0;color:#34d399;font-size:18px;font-weight:700;">$${collected} collected · ${data.sales.emailsSent} emails sent · ${data.sales.meetingsBooked} meetings booked</p>
            </div>
          </td>
        </tr>

        <!-- Revenue Section -->
        <tr>
          <td style="padding:8px 32px 16px;">
            <h2 style="margin:0 0 12px 0;color:#f0f4f3;font-size:14px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;">💰 Revenue</h2>
            <table style="width:100%;border-collapse:collapse;">
              <tr><td style="padding:6px 0;color:#9ca3a3;font-size:13px;border-bottom:1px solid #2a3338;">Collected (24h)</td><td style="padding:6px 0;color:#34d399;font-size:14px;font-weight:600;text-align:right;border-bottom:1px solid #2a3338;">$${collected}</td></tr>
              <tr><td style="padding:6px 0;color:#9ca3a3;font-size:13px;border-bottom:1px solid #2a3338;">Orders Delivered</td><td style="padding:6px 0;color:#f0f4f3;font-size:14px;text-align:right;border-bottom:1px solid #2a3338;">${data.revenue.ordersDelivered}</td></tr>
              <tr><td style="padding:6px 0;color:#9ca3a3;font-size:13px;border-bottom:1px solid #2a3338;">Orders Pending</td><td style="padding:6px 0;color:#fbbf24;font-size:14px;text-align:right;border-bottom:1px solid #2a3338;">${data.revenue.ordersPending}</td></tr>
              <tr><td style="padding:6px 0;color:#9ca3a3;font-size:13px;">Orders Refunded</td><td style="padding:6px 0;color:#f87171;font-size:14px;text-align:right;">${data.revenue.ordersRefunded}</td></tr>
            </table>
          </td>
        </tr>

        <!-- Sales Pipeline Section -->
        <tr>
          <td style="padding:8px 32px 16px;">
            <h2 style="margin:0 0 12px 0;color:#f0f4f3;font-size:14px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;">🎯 Sales Pipeline</h2>
            <table style="width:100%;border-collapse:collapse;">
              <tr><td style="padding:6px 0;color:#9ca3a3;font-size:13px;border-bottom:1px solid #2a3338;">Leads Discovered</td><td style="padding:6px 0;color:#f0f4f3;font-size:14px;text-align:right;border-bottom:1px solid #2a3338;">${data.sales.leadsDiscovered}</td></tr>
              <tr><td style="padding:6px 0;color:#9ca3a3;font-size:13px;border-bottom:1px solid #2a3338;">Leads Qualified</td><td style="padding:6px 0;color:#f0f4f3;font-size:14px;text-align:right;border-bottom:1px solid #2a3338;">${data.sales.leadsQualified}</td></tr>
              <tr><td style="padding:6px 0;color:#9ca3a3;font-size:13px;border-bottom:1px solid #2a3338;">Outreach Emails Sent</td><td style="padding:6px 0;color:#f0f4f3;font-size:14px;text-align:right;border-bottom:1px solid #2a3338;">${data.sales.emailsSent}</td></tr>
              <tr><td style="padding:6px 0;color:#9ca3a3;font-size:13px;border-bottom:1px solid #2a3338;">Replies Received</td><td style="padding:6px 0;color:#f0f4f3;font-size:14px;text-align:right;border-bottom:1px solid #2a3338;">${data.sales.repliesReceived}</td></tr>
              <tr><td style="padding:6px 0;color:#9ca3a3;font-size:13px;border-bottom:1px solid #2a3338;">Meetings Booked</td><td style="padding:6px 0;color:#34d399;font-size:14px;font-weight:600;text-align:right;border-bottom:1px solid #2a3338;">${data.sales.meetingsBooked}</td></tr>
              <tr><td style="padding:6px 0;color:#9ca3a3;font-size:13px;">Reply Rate</td><td style="padding:6px 0;color:#a78bfa;font-size:14px;text-align:right;">${replyRate}%</td></tr>
            </table>
          </td>
        </tr>

        <!-- Operations Section -->
        <tr>
          <td style="padding:8px 32px 16px;">
            <h2 style="margin:0 0 12px 0;color:#f0f4f3;font-size:14px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;">⚙️ Operations</h2>
            <table style="width:100%;border-collapse:collapse;">
              <tr><td style="padding:6px 0;color:#9ca3a3;font-size:13px;border-bottom:1px solid #2a3338;">Builds Completed</td><td style="padding:6px 0;color:#34d399;font-size:14px;text-align:right;border-bottom:1px solid #2a3338;">${data.operations.buildsCompleted}</td></tr>
              <tr><td style="padding:6px 0;color:#9ca3a3;font-size:13px;border-bottom:1px solid #2a3338;">Builds Failed</td><td style="padding:6px 0;color:#f87171;font-size:14px;text-align:right;border-bottom:1px solid #2a3338;">${data.operations.buildsFailed}</td></tr>
              <tr><td style="padding:6px 0;color:#9ca3a3;font-size:13px;">Quality Gate Pass Rate</td><td style="padding:6px 0;color:#f0f4f3;font-size:14px;text-align:right;">${passRate}%</td></tr>
            </table>
          </td>
        </tr>

        <!-- System Health Section -->
        <tr>
          <td style="padding:8px 32px 16px;">
            <h2 style="margin:0 0 12px 0;color:#f0f4f3;font-size:14px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;">🛡️ System Health</h2>
            <table style="width:100%;border-collapse:collapse;">
              <tr><td style="padding:6px 0;color:#9ca3a3;font-size:13px;border-bottom:1px solid #2a3338;">Status</td><td style="padding:6px 0;color:${healthColor};font-size:14px;font-weight:600;text-align:right;border-bottom:1px solid #2a3338;">${healthStatus}</td></tr>
              <tr><td style="padding:6px 0;color:#9ca3a3;font-size:13px;border-bottom:1px solid #2a3338;">Self-Heal Events</td><td style="padding:6px 0;color:#f0f4f3;font-size:14px;text-align:right;border-bottom:1px solid #2a3338;">${data.system.selfHealEvents}</td></tr>
              <tr><td style="padding:6px 0;color:#9ca3a3;font-size:13px;border-bottom:1px solid #2a3338;">Critical Errors</td><td style="padding:6px 0;color:${data.system.criticalErrors > 0 ? "#f87171" : "#34d399"};font-size:14px;text-align:right;border-bottom:1px solid #2a3338;">${data.system.criticalErrors}</td></tr>
              <tr><td style="padding:6px 0;color:#9ca3a3;font-size:13px;">Total Errors (24h)</td><td style="padding:6px 0;color:#f0f4f3;font-size:14px;text-align:right;">${data.system.totalErrors}</td></tr>
            </table>
          </td>
        </tr>

        ${data.topLeads.length > 0 ? `
        <!-- Top Leads -->
        <tr>
          <td style="padding:8px 32px 16px;">
            <h2 style="margin:0 0 12px 0;color:#f0f4f3;font-size:14px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;">⭐ Top New Leads</h2>
            ${data.topLeads.map((lead, i) => `
              <div style="background:rgba(167,139,250,0.06);border:1px solid rgba(167,139,250,0.15);border-radius:6px;padding:10px 12px;margin-bottom:8px;">
                <div style="display:flex;justify-content:space-between;align-items:center;">
                  <span style="color:#f0f4f3;font-size:13px;font-weight:500;">${i + 1}. ${lead.title}</span>
                  <span style="color:${lead.confidenceScore >= 80 ? "#34d399" : lead.confidenceScore >= 50 ? "#fbbf24" : "#f87171"};font-size:12px;font-weight:600;">${lead.confidenceScore}/100</span>
                </div>
                <span style="color:#6b7280;font-size:11px;">Status: ${lead.status}</span>
              </div>
            `).join("")}
          </td>
        </tr>
        ` : ""}

        <!-- CTA -->
        <tr>
          <td style="padding:16px 32px 24px;">
            <a href="${dashboardUrl}/dashboard" style="display:inline-block;background:linear-gradient(135deg,#10b981,#0d9488);color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:14px;font-weight:600;">
              View Full Dashboard →
            </a>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="padding:16px 32px;border-top:1px solid #2a3338;">
            <p style="margin:0;color:#6b7280;font-size:11px;">
              This is an automated daily briefing from ARIA Mission Control.<br>
              You're receiving this because you're the owner. Reply to this email if you have questions.
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`
}

/**
 * Build a plain-text fallback (for email clients that don't render HTML).
 */
function buildBriefingText(data: BriefingData): string {
  const dashboardUrl = process.env.NEXTAUTH_URL || process.env.ARIA_PUBLIC_URL || "http://localhost:3000"
  const collected = (data.revenue.collectedCents / 100).toFixed(2)

  return `ARIA DAILY BRIEFING — ${data.date}

REVENUE
  Collected (24h):    $${collected}
  Orders Delivered:   ${data.revenue.ordersDelivered}
  Orders Pending:     ${data.revenue.ordersPending}
  Orders Refunded:    ${data.revenue.ordersRefunded}

SALES PIPELINE
  Leads Discovered:   ${data.sales.leadsDiscovered}
  Leads Qualified:    ${data.sales.leadsQualified}
  Emails Sent:        ${data.sales.emailsSent}
  Replies Received:   ${data.sales.repliesReceived}
  Meetings Booked:    ${data.sales.meetingsBooked}
  Reply Rate:         ${data.sales.replyRate.toFixed(1)}%

OPERATIONS
  Builds Completed:   ${data.operations.buildsCompleted}
  Builds Failed:      ${data.operations.buildsFailed}
  Quality Gate Pass:  ${data.operations.qualityGatePassRate.toFixed(0)}%

SYSTEM HEALTH
  Self-Heal Events:   ${data.system.selfHealEvents}
  Critical Errors:    ${data.system.criticalErrors}
  Total Errors (24h): ${data.system.totalErrors}

${data.topLeads.length > 0 ? "TOP NEW LEADS\n" + data.topLeads.map((l, i) => `  ${i + 1}. ${l.title} (${l.confidenceScore}/100) — ${l.status}`).join("\n") + "\n" : ""}
View full dashboard: ${dashboardUrl}/dashboard

— ARIA Mission Control (automated)`
}
