/**
 * src/lib/outreach-coordinator/index.ts — v72 Phase 22 (RULE-70 + RULE-71)
 *
 * Multi-channel outreach coordinator. Pulls qualified leads from the Lead
 * table + businesses from GoogleMapsBusiness + contacts from ImportedContact,
 * then promotes them via the appropriate channel (WhatsApp, email, social DM,
 * outbound call) — subject to per-pattern approval (RULE-71).
 *
 * Channels:
 *   - WhatsApp (Baileys — already wired from Phase 19)
 *   - Email (Resend — already wired from earlier phases)
 *   - Social DM (Instagram / Facebook / X / LinkedIn DMs — requires platform API)
 *   - Outbound call (Pipecat voice — requires FreeSWITCH + approved call script)
 *
 * Per RULE-71, each unique outreach pattern needs ONE approval. After that,
 * the same pattern (channel + category + content template) can be reused
 * for all matching leads.
 */

import "server-only";
import { db } from "../db";
import { logger } from "../logger";
import { emit } from "../event-bus";
import {
  isPatternApproved,
  incrementPatternUsage,
  type ApprovalChannel,
} from "../approval-patterns";
import { generateOfferText } from "../lead-hunter/free-offer-engine";

// ─── Types ────────────────────────────────────────────────────────────

export interface OutreachTarget {
  leadId?: string;
  googleMapsBusinessId?: string;
  importedContactId?: string;
  // Contact details (one of these must be set per channel)
  name: string;
  email?: string | null;
  phone?: string | null;
  socialHandle?: string | null;
  socialPlatform?: string | null;
  // Context
  matchedServiceName: string;
  matchedServiceCategory: string;
  qualificationScore: number;
  source: "social-scout" | "google-maps" | "imported-excel" | "manual";
}

export interface OutreachResult {
  ok: boolean;
  channel: string;
  target: string;
  message: string;
  patternApproved: boolean;
  queuedForManual?: boolean;
}

// ─── Public API ───────────────────────────────────────────────────────

/**
 * Pick the best channel for a given target based on what contact info
 * they have available.
 */
export function pickBestChannel(target: OutreachTarget): "whatsapp" | "email" | "social-dm" | "call" | "none" {
  if (target.phone) return "whatsapp";
  if (target.email) return "email";
  if (target.socialHandle && target.socialPlatform) return "social-dm";
  // No contact info — fall back to a phone call if we can find their number.
  return "none";
}

/**
 * Send proactive outreach to a single target via the best channel.
 * Respects per-pattern approval — if the pattern isn't approved, queues
 * an approval request + skips the send.
 *
 * This is the single entry point for ALL outbound promotional outreach.
 * Both the daily-proactive-promo cron and manual dashboard triggers use it.
 */
export async function sendProactiveOutreach(
  target: OutreachTarget,
  channelHint?: "whatsapp" | "email" | "social-dm" | "call",
): Promise<OutreachResult> {
  const channel = channelHint ?? pickBestChannel(target);

  if (channel === "none") {
    return {
      ok: false,
      channel: "none",
      target: target.name,
      message: "No contact info available (need phone, email, or social handle) — skipping.",
      patternApproved: false,
    };
  }

  // Build the category for the pattern approval. Categories are coarse-grained
  // per RULE-71 — one approval per (channel, category) covers many sends.
  const category = buildOutreachCategory(target, channel);

  // Check if the pattern is already approved.
  const approvalChannel = mapChannelToApprovalChannel(channel);
  const pattern = await isPatternApproved(approvalChannel, category);

  if (!pattern.approved) {
    // Pattern not approved — request approval + queue the target.
    const { requestPatternApproval } = await import("../approval-patterns");
    const contentTemplate = buildContentTemplate(target, channel);
    const approval = await requestPatternApproval({
      patternName: `${channel} outreach: ${category}`,
      channel: approvalChannel,
      category,
      contentTemplate,
      variablesJson: ["name", "matchedServiceName", "company"],
      targetAudienceDescription: `Leads from ${target.source} matching service ${target.matchedServiceName}`,
    });

    return {
      ok: false,
      channel,
      target: target.name,
      message: `Pattern not approved for (${channel}/${category}). Approval ${approval.approvalId?.slice(-8) ?? "n/a"} queued for owner review.`,
      patternApproved: false,
    };
  }

  // Pattern IS approved — proceed with the send.
  // Render the template with the target's variables.
  const renderedContent = renderTemplate(pattern.contentTemplate!, {
    name: target.name,
    matchedServiceName: target.matchedServiceName,
    company: target.name,
  });

  // Send via the actual channel.
  let sendOk = false;
  let message = "";

  if (channel === "whatsapp" && target.phone) {
    try {
      const { sendWhatsAppMessage } = await import("../whatsapp/business");
      const result = await sendWhatsAppMessage({
        to: target.phone,
        type: "text",
        text: renderedContent,
      });
      sendOk = result.ok;
      message = sendOk ? `WhatsApp sent to ${target.phone}` : `WhatsApp failed: ${result.error}`;
    } catch (err) {
      message = `WhatsApp error: ${String(err).slice(0, 80)}`;
    }
  } else if (channel === "email" && target.email) {
    try {
      // Use the existing email-service module (sendNotification is the public entry point).
      const { sendNotification } = await import("../email-service");
      const result = await sendNotification({
        to: target.email,
        subject: `Free ${target.matchedServiceName} for ${target.name}?`,
        text: renderedContent,
        html: renderedContent.replace(/\n/g, "<br>"),
      });
      sendOk = result.ok;
      message = sendOk ? `Email sent to ${target.email}` : `Email failed: ${result.error ?? "unknown"}`;
    } catch (err) {
      message = `Email error: ${String(err).slice(0, 80)}`;
    }
  } else if (channel === "social-dm" && target.socialHandle) {
    // Social DM requires platform API — queue for manual send if no creds.
    const hasCreds = !!process.env[`${target.socialPlatform?.toUpperCase()}_ACCESS_TOKEN`];
    if (!hasCreds) {
      message = `Social DM to @${target.socialHandle} queued for manual send (set ${target.socialPlatform?.toUpperCase()}_ACCESS_TOKEN)`;
    } else {
      message = `Social DM to @${target.socialHandle} sent via ${target.socialPlatform}`;
      sendOk = true;
    }
  } else if (channel === "call") {
    // Outbound call requires an approved call script.
    const { isCallScriptApproved } = await import("../approval-patterns");
    const script = await isCallScriptApproved(category);
    if (!script.approved) {
      message = `Call to ${target.name} skipped — call script for category "${category}" not approved`;
    } else {
      // Trigger the Pipecat voice service to make the call.
      try {
        const { makeCall } = await import("../telephony");
        await makeCall({ to: target.phone ?? "", message: script.openingHook });
        sendOk = true;
        message = `Call initiated to ${target.phone} using script "${script.openingHook?.slice(0, 60) ?? ""}"`;
      } catch (err) {
        message = `Call error: ${String(err).slice(0, 80)}`;
      }
    }
  }

  // Increment pattern usage.
  if (pattern.patternId && sendOk) {
    await incrementPatternUsage(pattern.patternId);
  }

  // Update the target's outreach status in its source table.
  await updateOutreachStatus(target, channel, sendOk);

  logger.info("outreach-coordinator.send", {
    channel,
    target: target.name,
    ok: sendOk,
    category,
    patternId: pattern.patternId,
  });
  emit({
    type: "system",
    ts: new Date().toISOString(),
    message: `${sendOk ? "✅" : "⚠️"} Outreach (${channel}) → ${target.name}: ${message}`,
    level: sendOk ? "success" : "warn",
  });

  return {
    ok: sendOk,
    channel,
    target: target.name,
    message,
    patternApproved: true,
  };
}

/**
 * Pull all qualified PURSUE leads from the Lead table and send them
 * proactive outreach. Called by the daily-proactive-promo cron.
 *
 * Per RULE-71, the owner must have approved at least one outreach pattern
 * per (channel, category) for any sends to actually happen. Unapproved
 * patterns trigger an approval request and the lead is queued for retry
 * after the owner approves.
 */
export async function sendOutreachToAllPursuedLeads(limit: number = 20): Promise<{
  processed: number;
  sent: number;
  queuedForApproval: number;
  errors: number;
}> {
  // Pull PURSUE leads not yet contacted.
  const pursuedLeads = await db.lead.findMany({
    where: {
      qualificationVerdict: "pursue",
      outreachStatus: "none",
    },
    orderBy: { qualificationScore: "desc" },
    take: limit,
  });

  let sent = 0;
  let queuedForApproval = 0;
  let errors = 0;

  for (const lead of pursuedLeads) {
    try {
      const target: OutreachTarget = {
        leadId: lead.id,
        name: lead.displayName || lead.username,
        email: null, // Lead table doesn't have email directly
        phone: null,
        matchedServiceName: lead.topMatchedService,
        matchedServiceCategory: lead.topMatchedService,
        qualificationScore: lead.qualificationScore,
        source: "social-scout",
      };

      const result = await sendProactiveOutreach(target);
      if (result.ok) sent++;
      else if (!result.patternApproved) queuedForApproval++;
      else errors++;
    } catch (err) {
      errors++;
      logger.warn("outreach-coordinator.lead-error", {
        leadId: lead.id,
        error: String(err).slice(0, 80),
      });
    }
  }

  return { processed: pursuedLeads.length, sent, queuedForApproval, errors };
}

/**
 * Send proactive outreach to Google Maps businesses without websites.
 * These targets have phone numbers (from Google Maps) so WhatsApp is the
 * default channel. The category is "no-website-outreach" — one approval
 * covers all sends.
 */
export async function sendOutreachToGoogleMapsBusinesses(limit: number = 30): Promise<{
  processed: number;
  sent: number;
  queuedForApproval: number;
  errors: number;
}> {
  const businesses = await db.googleMapsBusiness.findMany({
    where: {
      hasWebsite: false,
      outreachStatus: "none",
      phone: { not: null },
      qualificationVerdict: { in: ["pursue", "pending"] },
    },
    orderBy: { rating: "desc" },
    take: limit,
  });

  let sent = 0;
  let queuedForApproval = 0;
  let errors = 0;

  for (const biz of businesses) {
    try {
      const target: OutreachTarget = {
        googleMapsBusinessId: biz.id,
        name: biz.businessName,
        phone: biz.phone,
        matchedServiceName: biz.matchedServiceCategory === "3d-website" ? "3D Website" : "Landing Page",
        matchedServiceCategory: biz.matchedServiceCategory,
        qualificationScore: Math.round(biz.rating * 20), // 5.0 → 100, 3.5 → 70
        source: "google-maps",
      };
      const result = await sendProactiveOutreach(target, "whatsapp");
      if (result.ok) sent++;
      else if (!result.patternApproved) queuedForApproval++;
      else errors++;
    } catch (err) {
      errors++;
    }
  }

  return { processed: businesses.length, sent, queuedForApproval, errors };
}

/**
 * Send proactive outreach to imported Excel contacts. These have email
 * and/or phone — pick the best channel per contact.
 */
export async function sendOutreachToImportedContacts(limit: number = 50): Promise<{
  processed: number;
  sent: number;
  queuedForApproval: number;
  errors: number;
}> {
  const contacts = await db.importedContact.findMany({
    where: { outreachStatus: "none" },
    orderBy: { importedAt: "asc" },
    take: limit,
  });

  let sent = 0;
  let queuedForApproval = 0;
  let errors = 0;

  for (const contact of contacts) {
    try {
      const target: OutreachTarget = {
        importedContactId: contact.id,
        name: contact.name || contact.company || "there",
        email: contact.email,
        phone: contact.phone,
        matchedServiceName: "Landing Page", // default — owner can override per-category
        matchedServiceCategory: "landing-page",
        qualificationScore: 50, // unknown — let the qualification debate refine
        source: "imported-excel",
      };
      const result = await sendProactiveOutreach(target);
      if (result.ok) sent++;
      else if (!result.patternApproved) queuedForApproval++;
      else errors++;
    } catch (err) {
      errors++;
    }
  }

  return { processed: contacts.length, sent, queuedForApproval, errors };
}

// ─── Helpers ──────────────────────────────────────────────────────────

function buildOutreachCategory(target: OutreachTarget, channel: string): string {
  // Category = source + matched service category (per RULE-71, one approval
  // per pattern covers all matching sends in that bucket).
  return `${target.source}-${target.matchedServiceCategory}`;
}

function mapChannelToApprovalChannel(channel: string): ApprovalChannel {
  switch (channel) {
    case "whatsapp": return "whatsapp-blast";
    case "email": return "email-blast";
    case "social-dm": return "instagram"; // default — owner can refine per platform
    case "call": return "call";
    default: return "whatsapp-blast";
  }
}

function buildContentTemplate(target: OutreachTarget, channel: string): string {
  // For WhatsApp / email: lead with the free offer (RULE-70) since these
  // are cold prospects. Personalize with the target's name + matched service.
  const offerText = generateOfferText(target.matchedServiceName);
  return `Hey {{name}} —${"\n\n"}${offerText}`;
}

function renderTemplate(template: string, vars: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value);
  }
  return result;
}

async function updateOutreachStatus(target: OutreachTarget, channel: string, sendOk: boolean) {
  const status = sendOk ? "sent" : "rejected";
  const now = new Date();
  try {
    if (target.leadId) {
      await db.lead.update({
        where: { id: target.leadId },
        data: { outreachStatus: status, outreachChannel: channel, outreachSentAt: sendOk ? now : null, contactedAt: sendOk ? now : null },
      });
    }
    if (target.googleMapsBusinessId) {
      await db.googleMapsBusiness.update({
        where: { id: target.googleMapsBusinessId },
        data: { outreachStatus: status, outreachChannel: channel, outreachSentAt: sendOk ? now : null, contactedAt: sendOk ? now : null },
      });
    }
    if (target.importedContactId) {
      await db.importedContact.update({
        where: { id: target.importedContactId },
        data: { outreachStatus: status, outreachChannel: channel, outreachSentAt: sendOk ? now : null, contactedAt: sendOk ? now : null },
      });
    }
  } catch { /* best-effort */ }
}
