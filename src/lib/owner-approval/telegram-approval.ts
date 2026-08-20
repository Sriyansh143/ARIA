/**
 * src/lib/owner-approval/telegram-approval.ts — Phase 29
 *
 * Telegram-FIRST owner approval workflow. Replaces the dashboard-only
 * `sendApprovalNotification()` (which only sent a text "Respond in the
 * dashboard to approve or deny") with a richer Telegram message that
 * carries an inline keyboard:
 *
 *   [✅ Approve]  [❌ Deny]
 *   [💬 Ask Question]  [✏️ Suggest Improvement]
 *
 * When the owner taps a button, Telegram sends a `callback_query` update
 * to /api/telegram/webhook. The webhook (in src/lib/telegram-bot.ts)
 * routes the callback here via `handleOwnerCallback()`.
 *
 * Conversation messages (questions, answers, suggestions, revisions) are
 * stored in the new `ApprovalConversation` table — one row per approval.
 *
 * DESIGN NOTES
 * ------------
 * - Dashboard remains a FALLBACK. If Telegram is not configured
 *   (TELEGRAM_BOT_TOKEN/CHAT_ID missing), `requestOwnerApproval()` is
 *   a no-op + the existing dashboard emit() path still fires.
 * - Telegram messages use Markdown. We sanitize user-supplied strings
 *   (titles, summaries) to avoid breaking the Telegram Markdown parser.
 * - High-risk spend approvals (action="spend" or risk="critical") still
 *   REQUIRE the existing /pay-approve cooldown flow — the inline
 *   "✅ Approve" button is replaced with "⚠️ Pay-Approve Required" text
 *   for those, pointing the owner to the existing command.
 * - The ApprovalConversation row is created on first question/suggestion
 *   (lazy). It's resolved when the approval is decided.
 */

import "server-only";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { sendTelegramMessage } from "@/lib/telegram-notifier";
import { briefFromJson } from "@/lib/approval-brief";

// ─── Types ───────────────────────────────────────────────────────────

export type ApprovalType = "workflow" | "refactor" | "outreach" | "expenditure" | "generic";

export interface ApprovalRequestPayload {
  /** The Approval row id. */
  id: string;
  /** High-level type — drives the message icon + button set. */
  type: ApprovalType;
  /** Short title (already stored on the Approval row). */
  title: string;
  /** One-sentence "what is this" summary. */
  summary: string;
  /** Risks identified by the brief generator (string[]). */
  risks: string[];
  /** The single sentence the agent recommends ("Approve to deploy service order XYZ to prod"). */
  suggestedAction: string;
  /** Optional metadata (e.g. { amount, currency, agentRole }). */
  metadata?: Record<string, unknown>;
}

export interface OwnerCallbackResult {
  ok: boolean;
  replyText: string;
  /** Set true to show a Telegram alert popup (callback_query.answer). */
  showAlert?: boolean;
}

interface ApprovalConversationMessage {
  role: "owner" | "agent" | "system";
  content: string;
  ts: string;
  kind: "question" | "answer" | "suggestion" | "revision" | "note" | "decision";
}

// ─── Sanitizer (Telegram Markdown safety) ───────────────────────────

/**
 * Escape characters that have special meaning in Telegram Markdown V1
 * (the parser is far stricter than GFM). Strips the chars entirely
 * for inline-button labels (which cannot contain Markdown at all).
 */
function escapeMarkdown(text: string): string {
  if (!text) return "";
  // Replace problematic chars with a single space, then collapse runs.
  return text
    .replace(/[*_`[\]]/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function truncate(text: string, max: number): string {
  if (!text) return "";
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
}

// ─── Message formatting ──────────────────────────────────────────────

function formatApprovalMessage(req: ApprovalRequestPayload): string {
  const icon =
    req.type === "expenditure" ? "💸" :
    req.type === "workflow" ? "⚙️" :
    req.type === "refactor" ? "🔧" :
    req.type === "outreach" ? "📨" :
    "⏳";

  const lines: string[] = [];
  lines.push(`${icon} *ARIA Approval Required*`);
  lines.push("");
  lines.push(`*Title:* ${escapeMarkdown(req.title)}`);
  if (req.summary) {
    lines.push(`*Summary:* ${escapeMarkdown(truncate(req.summary, 280))}`);
  }
  lines.push(`*Type:* ${req.type.toUpperCase()}`);
  if (req.risks.length > 0) {
    const risks = req.risks.slice(0, 5).map((r) => `• ${escapeMarkdown(truncate(r, 100))}`).join("\n");
    lines.push(`*Risks:*\n${risks}`);
  }
  if (req.suggestedAction) {
    lines.push(`*Suggested:* ${escapeMarkdown(truncate(req.suggestedAction, 200))}`);
  }
  if (req.metadata?.amount != null) {
    const currency = (req.metadata.currency as string) || "USD";
    lines.push(`*Amount:* ${currency} ${(req.metadata.amount as number).toLocaleString()}`);
  }
  lines.push("");
  lines.push(`*ID:* \`${req.id}\``);
  return lines.join("\n");
}

/**
 * Build the inline keyboard for the approval message.
 * Returns null if the approval requires /pay-approve (no inline approve button).
 */
export function buildApprovalKeyboard(approvalId: string, requiresPayApprove: boolean) {
  const approveBtn = requiresPayApprove
    ? { text: "⚠️ Pay-Approve Required", callback_data: `payrequired:${approvalId}` }
    : { text: "✅ Approve", callback_data: `approve:${approvalId}` };

  return {
    inline_keyboard: [
      [approveBtn, { text: "❌ Deny", callback_data: `deny:${approvalId}` }],
      [
        { text: "💬 Ask Question", callback_data: `ask:${approvalId}` },
        { text: "✏️ Suggest Improvement", callback_data: `suggest:${approvalId}` },
      ],
    ],
  };
}

// ─── Telegram send (with inline keyboard) ───────────────────────────

async function sendTelegramWithKeyboard(
  text: string,
  keyboard: unknown,
): Promise<{ ok: boolean; messageId?: number; reason?: string }> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    return { ok: false, reason: "telegram-not-configured" };
  }

  try {
    const body: Record<string, unknown> = {
      chat_id: chatId,
      text,
      parse_mode: "Markdown",
      disable_web_page_preview: true,
    };
    if (keyboard) {
      body.reply_markup = keyboard;
    }

    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    const data = await res.json();
    if (!data.ok) {
      // Retry as plain text without markdown (same v77 fix as telegram-notifier.ts).
      if (data.description?.includes("parse") || data.description?.includes("entities")) {
        const plainRes = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: chatId,
            text: text.replace(/[*_`\[\]]/g, ""),
            disable_web_page_preview: true,
            reply_markup: keyboard,
          }),
          signal: AbortSignal.timeout(10_000),
        });
        const plainData = await plainRes.json();
        if (!plainData.ok) {
          logger.error("telegram-approval.send-failed-plain", { error: plainData.description });
          return { ok: false, reason: plainData.description };
        }
        return { ok: true, messageId: plainData.result?.message_id };
      }
      logger.error("telegram-approval.send-failed", { error: data.description });
      return { ok: false, reason: data.description };
    }
    return { ok: true, messageId: data.result?.message_id };
  } catch (err) {
    logger.error("telegram-approval.network-error", { error: String(err) });
    return { ok: false, reason: String(err) };
  }
}

/**
 * Edit an existing Telegram message (used to flip button state after decision).
 * Falls back silently if the edit fails (message may have been deleted).
 */
async function editTelegramMessage(
  messageId: number,
  newText: string,
  newKeyboard?: unknown,
): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return false;

  try {
    const body: Record<string, unknown> = {
      chat_id: chatId,
      message_id: messageId,
      text: newText,
      parse_mode: "Markdown",
      disable_web_page_preview: true,
    };
    if (newKeyboard !== undefined) {
      body.reply_markup = newKeyboard;
    }
    const res = await fetch(`https://api.telegram.org/bot${token}/editMessageText`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    const data = await res.json();
    return !!data.ok;
  } catch (err) {
    logger.warn("telegram-approval.edit-failed", { error: String(err) });
    return false;
  }
}

// ─── Public: requestOwnerApproval ────────────────────────────────────

/**
 * Send a Telegram-first approval request to the owner with inline
 * Approve / Deny / Ask / Suggest buttons.
 *
 * Falls back silently if Telegram is not configured (the dashboard
 * emit() path still fires from the calling site).
 *
 * Stores the resulting Telegram `message_id` in the ApprovalConversation
 * row so a later decision can edit the same message (flip button state).
 */
export async function requestOwnerApproval(
  req: ApprovalRequestPayload,
): Promise<{ sent: boolean; messageId?: number; reason?: string }> {
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) {
    return { sent: false, reason: "telegram-not-configured" };
  }

  // Determine whether /pay-approve is required (high-risk spend).
  const requiresPayApprove =
    req.type === "expenditure" ||
    (req.metadata?.risk as string) === "critical" ||
    (req.metadata?.risk as string) === "high";

  const text = formatApprovalMessage(req);
  const keyboard = buildApprovalKeyboard(req.id, requiresPayApprove);
  const result = await sendTelegramWithKeyboard(text, keyboard);

  if (!result.ok || !result.messageId) {
    return { sent: false, reason: result.reason };
  }

  // Upsert the ApprovalConversation row to store the telegramMessageId.
  try {
    const existing = await db.approvalConversation.findFirst({
      where: { approvalId: req.id },
    });
    if (existing) {
      await db.approvalConversation.update({
        where: { id: existing.id },
        data: { telegramMessageId: String(result.messageId) },
      });
    } else {
      await db.approvalConversation.create({
        data: {
          approvalId: req.id,
          telegramMessageId: String(result.messageId),
          messages: JSON.stringify([
            {
              role: "system",
              content: `Approval request sent to Telegram at ${new Date().toISOString()}`,
              ts: new Date().toISOString(),
              kind: "note",
            },
          ]),
        },
      });
    }
  } catch (err) {
    // Non-fatal — the Telegram message was already sent.
    logger.warn("telegram-approval.conversation-persist-failed", { approvalId: req.id, error: String(err) });
  }

  return { sent: true, messageId: result.messageId };
}

// ─── Conversation helpers ────────────────────────────────────────────

async function getOrCreateConversation(
  approvalId: string,
): Promise<{ id: string; messages: ApprovalConversationMessage[]; telegramMessageId: string | null }> {
  const existing = await db.approvalConversation.findFirst({
    where: { approvalId },
    orderBy: { createdAt: "desc" },
  });
  if (existing) {
    return {
      id: existing.id,
      messages: safeParseMessages(existing.messages),
      telegramMessageId: existing.telegramMessageId,
    };
  }
  const created = await db.approvalConversation.create({
    data: { approvalId, messages: "[]" },
  });
  return { id: created.id, messages: [], telegramMessageId: null };
}

function safeParseMessages(raw: string): ApprovalConversationMessage[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function appendConversationMessage(
  conversationId: string,
  msg: ApprovalConversationMessage,
): Promise<void> {
  const row = await db.approvalConversation.findUnique({ where: { id: conversationId } });
  if (!row) return;
  const list = safeParseMessages(row.messages);
  list.push(msg);
  await db.approvalConversation.update({
    where: { id: conversationId },
    data: { messages: JSON.stringify(list) },
  });
}

// ─── Public: handleOwnerCallback ─────────────────────────────────────

/**
 * Dispatch a Telegram `callback_query` to the appropriate approval action.
 *
 * Callback data format: `<action>:<approvalId>` where action ∈
 * { approve, deny, ask, suggest, payrequired }.
 *
 * The webhook handler in src/lib/telegram-bot.ts is responsible for
 * calling `answerCallbackQuery` to dismiss the loading spinner on the
 * Telegram client. This function returns the reply text + whether to
 * show a popup alert.
 */
export async function handleOwnerCallback(
  callbackData: string,
  ownerInput?: string,
): Promise<OwnerCallbackResult> {
  const colonIdx = callbackData.indexOf(":");
  if (colonIdx < 0) {
    return { ok: false, replyText: "Invalid callback format.", showAlert: true };
  }
  const action = callbackData.slice(0, colonIdx);
  const approvalId = callbackData.slice(colonIdx + 1);

  switch (action) {
    case "approve":
      return handleInlineApprove(approvalId);
    case "deny":
      return handleInlineDeny(approvalId);
    case "ask":
      return handleInlineAsk(approvalId, ownerInput);
    case "suggest":
      return handleInlineSuggest(approvalId, ownerInput);
    case "payrequired":
      return {
        ok: false,
        replyText: `This approval requires /pay-approve ${approvalId.slice(-8)} (60s cooldown enforced). Tap the chat input and type the command.`,
        showAlert: true,
      };
    default:
      return { ok: false, replyText: `Unknown action: ${action}`, showAlert: true };
  }
}

// ─── Approve / Deny handlers ─────────────────────────────────────────

async function handleInlineApprove(approvalId: string): Promise<OwnerCallbackResult> {
  const { db } = await import("../db");
  const { executeApprovalAction } = await import("../approval-executor");
  const { emit } = await import("../event-bus");
  const { serializeApproval } = await import("../approval-brief");

  const approval = await db.approval.findUnique({ where: { id: approvalId } });
  if (!approval) {
    return { ok: false, replyText: "Approval not found.", showAlert: true };
  }
  if (approval.status !== "pending") {
    return {
      ok: false,
      replyText: `Already ${approval.status}. No action taken.`,
      showAlert: true,
    };
  }
  // /pay-approve guard for spend / high-risk.
  if (approval.action === "spend" || approval.risk === "critical" || approval.risk === "high") {
    return {
      ok: false,
      replyText: `Blocked — use /pay-approve ${approvalId.slice(-8)} (60s cooldown enforced for high-risk spends).`,
      showAlert: true,
    };
  }

  const updated = await db.approval.update({
    where: { id: approvalId },
    data: { status: "approved", decidedAt: new Date() },
  });

  let actionMsg = "no action";
  try {
    const outcome = await executeApprovalAction({
      id: updated.id,
      action: updated.action,
      title: updated.title,
      amount: updated.amount,
      payload: updated.payload,
      requester: updated.requester,
    });
    actionMsg = outcome.message;
  } catch (err) {
    logger.error("telegram-approval.approve-action-failed", { approvalId, error: String(err) });
    actionMsg = `action failed: ${String(err).slice(0, 80)}`;
  }

  try {
    emit({ type: "approval", ts: new Date().toISOString(), approval: serializeApproval(updated) });
  } catch { /* best-effort */ }

  // Phase 29: record audit entry for the Telegram-initiated approval.
  try {
    const { recordAudit } = await import("../audit-log");
    await recordAudit({
      actor: "owner",
      actorRole: "owner",
      action: "approve",
      resource: "Approval",
      resourceId: updated.id,
      before: { status: approval.status, title: approval.title },
      after: { status: "approved", title: updated.title, actionResult: actionMsg, source: "telegram-inline" },
      source: "telegram",
      context: { chatId: process.env.TELEGRAM_CHAT_ID },
    });
  } catch { /* best-effort */ }

  // Resolve conversation + edit the Telegram message.
  await resolveConversation(approvalId, "approved");
  await tryEditApprovalMessage(approvalId, `✅ *APPROVED* — ${updated.title}\n\n_Result: ${actionMsg}_`);

  return {
    ok: true,
    replyText: `✅ Approved: ${updated.title}\nResult: ${actionMsg}`,
    showAlert: false,
  };
}

async function handleInlineDeny(approvalId: string): Promise<OwnerCallbackResult> {
  const { db } = await import("../db");
  const { emit } = await import("../event-bus");
  const { serializeApproval } = await import("../approval-brief");

  const approval = await db.approval.findUnique({ where: { id: approvalId } });
  if (!approval) {
    return { ok: false, replyText: "Approval not found.", showAlert: true };
  }
  if (approval.status !== "pending") {
    return { ok: false, replyText: `Already ${approval.status}.`, showAlert: true };
  }

  const updated = await db.approval.update({
    where: { id: approvalId },
    data: { status: "denied", decidedAt: new Date() },
  });

  try {
    emit({ type: "approval", ts: new Date().toISOString(), approval: serializeApproval(updated) });
  } catch { /* best-effort */ }

  // Phase 29: record audit entry for the Telegram-initiated denial.
  try {
    const { recordAudit } = await import("../audit-log");
    await recordAudit({
      actor: "owner",
      actorRole: "owner",
      action: "deny",
      resource: "Approval",
      resourceId: updated.id,
      before: { status: approval.status, title: approval.title },
      after: { status: "denied", title: updated.title, source: "telegram-inline" },
      source: "telegram",
      context: { chatId: process.env.TELEGRAM_CHAT_ID },
    });
  } catch { /* best-effort */ }

  await resolveConversation(approvalId, "denied");
  await tryEditApprovalMessage(approvalId, `❌ *DENIED* — ${updated.title}`);

  return {
    ok: true,
    replyText: `❌ Denied: ${updated.title}`,
    showAlert: false,
  };
}

// ─── Ask Question / Suggest Improvement ──────────────────────────────

/**
 * Owner tapped "💬 Ask Question". If `ownerInput` is empty, prompt them to
 * type their question as a reply. If provided, persist it + try to answer.
 *
 * The actual LLM-based answer reuses the existing `discussApproval()`
 * function from approval-brief.ts (which already handles the LLM call,
 * fallback answer, and appends to the approval's discussionLog).
 */
async function handleInlineAsk(
  approvalId: string,
  ownerInput?: string,
): Promise<OwnerCallbackResult> {
  if (!ownerInput || ownerInput.trim().length === 0) {
    return {
      ok: true,
      replyText: `💬 Reply with your question for approval ${approvalId.slice(-8)}. Example:\n/ask ${approvalId.slice(-8)} What is the expected ROI if we approve this?`,
      showAlert: true,
    };
  }

  const { discussApproval } = await import("../approval-brief");
  try {
    const { answer } = await discussApproval(approvalId, ownerInput);

    const conv = await getOrCreateConversation(approvalId);
    await appendConversationMessage(conv.id, {
      role: "owner",
      content: ownerInput,
      ts: new Date().toISOString(),
      kind: "question",
    });
    await appendConversationMessage(conv.id, {
      role: "agent",
      content: answer,
      ts: new Date().toISOString(),
      kind: "answer",
    });

    return {
      ok: true,
      replyText: `💬 Answer:\n\n${truncate(answer, 800)}`,
      showAlert: false,
    };
  } catch (err) {
    logger.error("telegram-approval.ask-failed", { approvalId, error: String(err) });
    return {
      ok: false,
      replyText: `Failed to fetch answer: ${String(err).slice(0, 120)}`,
      showAlert: true,
    };
  }
}

/**
 * Owner tapped "✏️ Suggest Improvement". If `ownerInput` is empty, prompt
 * them for the suggestion text. If provided, persist it + mark the
 * approval as "awaiting revision". The agent can later pick it up via
 * the refactor-proposal review flow (Phase 24).
 *
 * For now, we don't auto-generate a revised brief — that requires an LLM
 * call which we deliberately keep out of the inline-callback path to
 * avoid blocking Telegram's 5s callback timeout. The owner gets a
 * confirmation + the suggestion is queued for the next agent tick.
 */
async function handleInlineSuggest(
  approvalId: string,
  ownerInput?: string,
): Promise<OwnerCallbackResult> {
  if (!ownerInput || ownerInput.trim().length === 0) {
    return {
      ok: true,
      replyText: `✏️ Reply with your suggested improvement for approval ${approvalId.slice(-8)}. Example:\n/suggest ${approvalId.slice(-8)} Use a smaller batch size and add a rollback plan.`,
      showAlert: true,
    };
  }

  const conv = await getOrCreateConversation(approvalId);
  await appendConversationMessage(conv.id, {
    role: "owner",
    content: ownerInput,
    ts: new Date().toISOString(),
    kind: "suggestion",
  });
  await appendConversationMessage(conv.id, {
    role: "system",
    content: "Suggestion recorded. The agent will produce a revised brief on the next tick — owner will be notified.",
    ts: new Date().toISOString(),
    kind: "note",
  });

  // Update the approval's brief to mark "revision-requested".
  // We do NOT change the approval status (still pending) — the agent's
  // next tick will look for pending approvals with unresolved suggestions.
  try {
    const { db } = await import("../db");
    await db.approval.update({
      where: { id: approvalId },
      data: {
        summary: `[revision-requested] ${ownerInput.slice(0, 200)}`,
      },
    });
  } catch (err) {
    logger.warn("telegram-approval.suggest-update-failed", { approvalId, error: String(err) });
  }

  return {
    ok: true,
    replyText: `✏️ Suggestion recorded. The agent will revise this approval and notify you. You can still Approve / Deny the original in the meantime.`,
    showAlert: false,
  };
}

// ─── Conversation resolution + message edit ───────────────────────────

async function resolveConversation(approvalId: string, decision: "approved" | "denied"): Promise<void> {
  try {
    // Use getOrCreateConversation so a conversation row is created even
    // if requestOwnerApproval() never fired (e.g. Telegram not configured
    // — the owner interacted via dashboard or text command instead).
    const conv = await getOrCreateConversation(approvalId);
    await appendConversationMessage(conv.id, {
      role: "system",
      content: `Approval ${decision} at ${new Date().toISOString()}`,
      ts: new Date().toISOString(),
      kind: "decision",
    });
    await db.approvalConversation.update({
      where: { id: conv.id },
      data: { status: "resolved" },
    });
  } catch (err) {
    logger.warn("telegram-approval.resolve-conversation-failed", { approvalId, error: String(err) });
  }
}

async function tryEditApprovalMessage(approvalId: string, newText: string): Promise<void> {
  try {
    const conv = await db.approvalConversation.findFirst({
      where: { approvalId },
      orderBy: { createdAt: "desc" },
    });
    if (!conv?.telegramMessageId) return;
    const messageId = parseInt(conv.telegramMessageId, 10);
    if (!Number.isFinite(messageId)) return;
    // Remove the inline keyboard (so the buttons don't keep firing).
    await editTelegramMessage(messageId, newText, { inline_keyboard: [] });
  } catch (err) {
    logger.warn("telegram-approval.edit-message-failed", { approvalId, error: String(err) });
  }
}

// ─── Public helpers (used by tests + the telegram-bot module) ────────

/**
 * Get the conversation thread for an approval (used by the dashboard
 * to render the conversation history alongside the approval card).
 */
export async function getApprovalConversation(
  approvalId: string,
): Promise<{ messages: ApprovalConversationMessage[]; status: string; revisedBrief: unknown } | null> {
  const row = await db.approvalConversation.findFirst({
    where: { approvalId },
    orderBy: { createdAt: "desc" },
  });
  if (!row) return null;
  let revisedBrief: unknown = null;
  if (row.revisedBrief) {
    try {
      revisedBrief = JSON.parse(row.revisedBrief);
    } catch {
      revisedBrief = null;
    }
  }
  return {
    messages: safeParseMessages(row.messages),
    status: row.status,
    revisedBrief,
  };
}

/**
 * List pending approvals that have unresolved owner suggestions
 * (so the agent can pick them up on the next tick).
 */
export async function getApprovalsAwaitingRevision(limit = 10): Promise<
  { approvalId: string; suggestion: string; suggestedAt: string }[]
> {
  const rows = await db.approvalConversation.findMany({
    where: { status: "open" },
    take: limit,
    orderBy: { updatedAt: "desc" },
  });
  const out: { approvalId: string; suggestion: string; suggestedAt: string }[] = [];
  for (const row of rows) {
    const msgs = safeParseMessages(row.messages);
    const lastSuggestion = [...msgs].reverse().find((m) => m.kind === "suggestion");
    if (lastSuggestion) {
      out.push({
        approvalId: row.approvalId,
        suggestion: lastSuggestion.content,
        suggestedAt: lastSuggestion.ts,
      });
    }
  }
  return out;
}

// ─── Convenience: build ApprovalRequestPayload from an Approval row ──

/**
 * Helper used by the approval-creation sites (workflow-engine, etc.)
 * to convert a freshly-created Approval row into the payload expected
 * by `requestOwnerApproval()`. Avoids duplicating the brief parsing
 * logic at every call site.
 */
export async function buildApprovalRequestFromRow(
  approvalId: string,
  type?: ApprovalType,
): Promise<ApprovalRequestPayload | null> {
  const { db } = await import("../db");
  const row = await db.approval.findUnique({ where: { id: approvalId } });
  if (!row) return null;

  const brief = briefFromJson(row.brief);
  const risks = brief?.risks ?? [];
  const why = brief?.why ?? row.summary ?? "";

  // Infer the type from the action / risk if not provided.
  let inferredType: ApprovalType = type ?? "generic";
  if (!type) {
    if (row.action === "spend") inferredType = "expenditure";
    else if (row.action === "deploy" || row.action === "execute_workflow_or_skill") inferredType = "workflow";
    else if (row.action === "send_email" || row.action === "send_outreach") inferredType = "outreach";
    else if (row.action === "refactor") inferredType = "refactor";
  }

  return {
    id: row.id,
    type: inferredType,
    title: row.title,
    summary: why,
    risks,
    suggestedAction: brief?.ifApproved ?? "Approve to proceed.",
    metadata: {
      amount: row.amount ?? undefined,
      risk: row.risk,
      currency: "USD",
      requester: row.requester ?? undefined,
      agentRole: row.agentId ?? undefined,
    },
  };
}

// Re-export the type for downstream callers.
export type { ApprovalConversationMessage };
