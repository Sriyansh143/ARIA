/**
 * src/lib/telegram-bot.ts — Inbound Telegram command handler (v58 Phase 2)
 *
 * Handles owner commands sent to the Telegram bot. Supports:
 *
 *   /status            — Show autonomy + system status
 *   /pause             — Pause all autonomous operations (global kill switch)
 *   /resume            — Resume autonomous operations
 *   /health            — Quick health check of LLM providers + DB + payment methods
 *   /approve [id]      — Approve a pending HUMAN_ASSISTED approval (v61, Audit B5)
 *   /deny [id]         — Deny a pending HUMAN_ASSISTED approval (v61, Audit B5)
 *   /approvals         — List the 5 most recent pending approvals (v61)
 *   /help              — Show available commands
 *
 * The webhook is registered at https://your-domain.com/api/telegram/webhook
 * via Telegram's setWebhook API. Telegram sends POST requests with update
 * objects; this module parses them and dispatches to handlers.
 *
 * Auth: The webhook URL itself is unauthenticated (Telegram can't add auth
 * headers), but we verify the bot token matches by checking the URL path.
 * For extra safety, the route also accepts an optional ?token= query
 * parameter that must match TELEGRAM_VERIFY_TOKEN (if set).
 */

import { logger } from "./logger";
import { isAutonomyPaused, setAutonomyPausedWithReason, getAutonomyStatus } from "./autonomy-control";
import { sendTelegramMessage } from "./telegram-notifier";

export interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    chat: { id: number; type: string };
    from?: { id: number; is_bot: boolean; first_name: string; username?: string };
    text?: string;
  };
  // ─── Phase 29 — inline keyboard callback queries ────────────────────
  // Fired when the owner taps an inline button on a Telegram message.
  // The button's `callback_data` (e.g. "approve:<approvalId>") is in
  // callback_query.data. We must call answerCallbackQuery to dismiss
  // the loading spinner on the owner's Telegram client.
  callback_query?: {
    id: string;
    data: string;
    from: { id: number; is_bot: boolean; first_name: string; username?: string };
    message?: {
      message_id: number;
      chat: { id: number; type: string };
      text?: string;
    };
  };
}

interface CommandResult {
  ok: boolean;
  reply: string;
}

/**
 * Handle an inbound Telegram update.
 * Returns true if the update was processed (so the webhook can return 200).
 *
 * Two update types are dispatched:
 *   1. message.text — owner typed a /command. Handled below.
 *   2. callback_query — owner tapped an inline keyboard button on an
 *      approval message (Phase 29). Routed to handleOwnerCallback(),
 *      then answerCallbackQuery is called to dismiss the spinner.
 */
export async function handleTelegramUpdate(update: TelegramUpdate): Promise<boolean> {
  // ─── Phase 29: inline callback queries (approve/deny/ask/suggest buttons) ───
  if (update.callback_query) {
    return handleCallbackQuery(update.callback_query);
  }

  if (!update.message?.text) {
    // Not a text message — ignore (could be a sticker, photo, etc.)
    return true;
  }

  const text = update.message.text.trim();
  const chatId = update.message.chat.id;

  // Only respond to messages in the configured chat
  const configuredChatId = process.env.TELEGRAM_CHAT_ID;
  if (configuredChatId && String(chatId) !== String(configuredChatId)) {
    logger.warn("telegram-bot.unauthorized-chat", { chatId, expected: configuredChatId });
    return true; // still return 200 so Telegram doesn't retry
  }

  // Parse the command (first word, case-insensitive, may have /prefix)
  const parts = text.split(/\s+/);
  const command = parts[0]?.toLowerCase().replace(/^\//, "").split("@")[0]; // strip @botname suffix
  const args = parts.slice(1).join(" ");

  logger.info("telegram-bot.command", { command, args, from: update.message.from?.username });

  let result: CommandResult;
  try {
    switch (command) {
      case "status":
        result = await handleStatus();
        break;
      case "pause":
        result = await handlePause(args);
        break;
      case "resume":
        result = await handleResume();
        break;
      case "health":
        result = await handleHealth();
        break;
      // ─── v61 (Audit B5): Telegram approval commands ──────────────
      // The conductor router's HUMAN_ASSISTED path sends a Telegram brief
      // telling the owner to "/approve <id>" or "/deny <id>". These
      // commands now actually exist — they flip the Approval row status
      // + call the shared executeApprovalAction (real side effects) +
      // emit the approval.decided event so the workflow/skill engine
      // re-dispatches.
      case "approve":
        result = await handleApprove(args);
        break;
      case "deny":
        result = await handleDeny(args);
        break;
      case "approvals":
        result = await handleApprovals();
        break;
      // v61 Phase 1 (Audit #4): /discuss lets the owner ask a clarifying
      // question BEFORE approving. The question is answered by the LLM
      // using the approval brief + prior discussion as context, then saved
      // to the Approval.discussionLog so the dashboard shows the thread.
      case "discuss":
        result = await handleDiscuss(args);
        break;
      // v61 Phase 1 (Audit #3): /pay-approve is the ONLY way to approve
      // a payment (action="spend") approval. /approve refuses spend
      // approvals so the owner can't rubber-stamp a payment alongside
      // routine approvals. Enforces a 60s cooldown to prevent accidental
      // clicks. Mirrors handleApprove but with the payment gate.
      case "pay-approve":
        result = await handlePayApprove(args);
        break;
      // v61 Phase 3 (Owner Rule: ZERO ASSUMPTIONS) — /answer resumes a task
      // that was halted because it was missing required context. The owner
      // provides the answer; the task is re-dispatched with the answer
      // merged into its payload.
      case "answer":
        result = await handleAnswer(args);
        break;
      // ─── Phase 29 — text equivalents of the inline buttons ───────────
      // /ask <id> <question>        — ask a question about an approval
      // /suggest <id> <suggestion>  — suggest an improvement to an approval
      // Both call the same logic the inline keyboard uses, so the conversation
      // thread is consistent regardless of how the owner triggered it.
      case "ask":
        result = await handleAskCommand(args);
        break;
      case "suggest":
        result = await handleSuggestCommand(args);
        break;
      case "help":
      case "start":
        result = handleHelp();
        break;
      default:
        result = {
          ok: false,
          reply: `Unknown command: /${command}\n\nType /help to see available commands.`,
        };
    }
  } catch (err) {
    logger.error("telegram-bot.command-failed", { command, error: String(err) });
    result = { ok: false, reply: `Command /${command} failed: ${String(err).slice(0, 100)}` };
  }

  // Send the reply
  await sendTelegramMessage(result.reply);
  return true;
}

async function handleStatus(): Promise<CommandResult> {
  const status = await getAutonomyStatus();
  const lines: string[] = [
    "📊 *ARIA Mission Control Status*",
    "",
    `Autonomy: ${status.paused ? "⏸️ PAUSED" : "▶️ RUNNING"}`,
    status.reason ? `Reason: ${status.reason}` : "",
    "",
    `LLM Providers:`,
    `  Z-AI: ${process.env.ZAI_API_KEY ? "✅ configured" : "❌ not set"}`,
    `  Groq: ${process.env.GROQ_API_KEY ? "✅ configured" : "❌ not set"}`,
    `  NVIDIA: ${process.env.NVIDIA_API_KEY ? "✅ configured" : "❌ not set"}`,
    `  Ollama: ${process.env.OLLAMA_HOST ? "✅ " + process.env.OLLAMA_HOST : "❌ not set"}`,
    "",
    `Payments:`,
    `  Crypto: ${process.env.CRYPTO_WALLET_ADDRESS ? "✅ " + process.env.CRYPTO_WALLET_ADDRESS.slice(0, 10) + "..." : "❌ not set"}`,
    `  Stripe: ${process.env.STRIPE_SECRET_KEY ? "✅ configured" : "❌ not set"}`,
    `  UPI: ${process.env.ARIA_UPI_VPA ? "✅ " + process.env.ARIA_UPI_VPA : "❌ not set"}`,
    "",
    `Email: ${process.env.RESEND_API_KEY ? "✅ configured" : "❌ not set"}`,
    `WhatsApp: ${process.env.WHATSAPP_TOKEN ? "✅ configured" : "❌ not set"}`,
    `Phone calls: ${process.env.AI_CALLER_ENABLED === "true" ? "✅ enabled" : "⛔ gated"}`,
    "",
    `Time: ${new Date().toISOString()}`,
  ].filter(Boolean);

  return { ok: true, reply: lines.join("\n") };
}

async function handlePause(reason: string): Promise<CommandResult> {
  const r = reason || "pause via Telegram bot";
  await setAutonomyPausedWithReason(true, r);
  return {
    ok: true,
    reply: `⏸️ *Autonomy PAUSED*\n\nReason: ${r}\n\nAll cron jobs and the tick loop will short-circuit on their next run. The server stays up — you can still access the dashboard and process inbound webhooks.`,
  };
}

async function handleResume(): Promise<CommandResult> {
  await setAutonomyPausedWithReason(false, "resume via Telegram bot");
  return {
    ok: true,
    reply: `▶️ *Autonomy RESUMED*\n\nAll cron jobs and the tick loop are now active again.`,
  };
}

async function handleHealth(): Promise<CommandResult> {
  const lines: string[] = ["🏥 *Health Check*"];
  const checks: Array<{ name: string; ok: boolean; detail?: string }> = [];

  // Check DB
  try {
    const { db } = await import("./db");
    await db.$queryRaw`SELECT 1`;
    checks.push({ name: "Database", ok: true });
  } catch (err) {
    checks.push({ name: "Database", ok: false, detail: String(err).slice(0, 50) });
  }

  // Check Z-AI (just config presence, not actual API call)
  checks.push({
    name: "Z-AI API key",
    ok: !!process.env.ZAI_API_KEY,
    detail: process.env.ZAI_API_KEY ? undefined : "not set",
  });

  // Check Resend
  checks.push({
    name: "Resend email",
    ok: !!process.env.RESEND_API_KEY,
    detail: process.env.RESEND_API_KEY ? undefined : "not set",
  });

  // Check crypto wallet
  checks.push({
    name: "Crypto wallet",
    ok: !!process.env.CRYPTO_WALLET_ADDRESS,
    detail: process.env.CRYPTO_WALLET_ADDRESS ? undefined : "not set",
  });

  // Check Stripe
  checks.push({
    name: "Stripe",
    ok: !!process.env.STRIPE_SECRET_KEY,
    detail: process.env.STRIPE_SECRET_KEY ? undefined : "not set",
  });

  // Check Telegram itself
  checks.push({
    name: "Telegram bot",
    ok: !!process.env.TELEGRAM_BOT_TOKEN,
    detail: process.env.TELEGRAM_BOT_TOKEN ? undefined : "not set",
  });

  for (const c of checks) {
    lines.push(`${c.ok ? "✅" : "❌"} ${c.name}${c.detail ? ` — ${c.detail}` : ""}`);
  }

  const allOk = checks.every((c) => c.ok);
  lines.push("", allOk ? "🎉 All systems operational" : "⚠️ Some systems need attention");

  return { ok: true, reply: lines.join("\n") };
}

function handleHelp(): CommandResult {
  return {
    ok: true,
    reply: [
      "🤖 *ARIA Mission Control — Telegram Bot*",
      "",
      "Available commands:",
      "  /status              — Show autonomy + system status",
      "  /pause               — Pause all autonomous operations (kill switch)",
      "  /resume              — Resume autonomous operations",
      "  /health              — Quick health check of all subsystems",
      "  /approvals           — List the 5 most recent pending approvals",
      "  /discuss <id> <q>    — Ask a clarifying question BEFORE approving",
      "  /approve <id>        — Approve a routine (non-payment) approval",
      "  /deny <id>           — Deny any pending approval",
      "  /pay-approve <id>    — Approve a PAYMENT (60s cooldown enforced)",
      "  /answer <id> <text>  — Provide missing context for a halted task",
      "  /ask <id> <question> — Ask a question about a pending approval (Phase 29)",
      "  /suggest <id> <text> — Suggest an improvement to a pending approval (Phase 29)",
      "  /help                — Show this help message",
      "",
      "Inline buttons (Phase 29):",
      "  New approval messages carry 4 buttons:",
      "    [✅ Approve]  [❌ Deny]",
      "    [💬 Ask]      [✏️ Suggest]",
      "  Tap a button — Telegram sends a callback to the bot, which runs",
      "  the same logic as the text command. For Ask / Suggest, the bot",
      "  will prompt you to reply with the full text via /ask or /suggest.",
      "",
      "The <id> can be the full Approval ID or just the last 8 characters",
      "(as shown in the Telegram brief). Payment approvals (action=\"spend\")",
      "CANNOT be approved via /approve — they require /pay-approve with a",
      "60-second cooldown to prevent accidental clicks.",
      "",
      "The bot only responds to messages from the configured chat (TELEGRAM_CHAT_ID).",
    ].join("\n"),
  };
}

// ─── v61 (Audit B5): Telegram approval handlers ──────────────────────
//
// These resolve a pending Approval by its ID (full or last-8-chars suffix,
// as advertised in the HUMAN_ASSISTED Telegram brief). On /approve the
// shared executeApprovalAction runs — performing a REAL minimal side
// effect (DB write / email send / revenue record). The approval.decided
// SSE event is emitted so the dashboard + the conductor router's polling
// callers see the decision immediately.

/**
 * Resolve an Approval ID from the argument: accept the full ID or the
 * last-8-char suffix (the form used in Telegram briefs). Returns the
 * matched Approval row or null.
 */
async function resolveApprovalId(arg: string): Promise<{ id: string; status: string; title: string; action: string | null; amount: number | null; payload: string | null; requester: string | null; risk: string } | null> {
  const { db } = await import("./db");
  const trimmed = arg.trim();
  if (!trimmed) return null;
  // Try exact match first.
  const exact = await db.approval.findUnique({ where: { id: trimmed } });
  if (exact) return exact;
  // Fall back to last-8-chars suffix match (pending only).
  if (trimmed.length <= 8) {
    const pending = await db.approval.findMany({
      where: { status: "pending" },
      take: 50,
      orderBy: { createdAt: "desc" },
    });
    const match = pending.find((a) => a.id.endsWith(trimmed));
    if (match) return match;
  }
  return null;
}

async function handleApprove(arg: string): Promise<CommandResult> {
  const { db } = await import("./db");
  const { emit } = await import("./event-bus");
  const { serializeApproval } = await import("./approval-brief");
  const { executeApprovalAction } = await import("./approval-executor");

  const approval = await resolveApprovalId(arg);
  if (!approval) {
    return {
      ok: false,
      reply: `❌ No pending approval matched "${arg}".\n\nUse /approvals to list pending approvals (the ID shown is the last 8 characters — you can paste the full ID too).`,
    };
  }
  if (approval.status !== "pending") {
    return {
      ok: false,
      reply: `⚠️ Approval "${approval.title}" is already ${approval.status} — no action taken.`,
    };
  }

  // v61 Phase 1 (Audit #3): /approve REFUSES payment approvals.
  // A payment (action="spend") can ONLY be approved via /pay-approve,
  // which enforces a 60s cooldown. This prevents the owner from
  // rubber-stamping a payment alongside routine approvals.
  if (approval.action === "spend" || approval.risk === "high") {
    return {
      ok: false,
      reply: [
        "🔴 *PAYMENT APPROVAL — BLOCKED*",
        "",
        `This approval has action="${approval.action}" + risk="${approval.risk}".`,
        "It can ONLY be approved via /pay-approve (NOT /approve).",
        "",
        "This separation prevents payment approvals from being",
        "rubber-stamped alongside routine approvals.",
        "",
        `*Title:* ${approval.title}`,
        approval.amount ? `*Amount:* $${approval.amount.toLocaleString()}` : "",
        `*ID:* \`${approval.id}\``,
        "",
        `To approve: /pay-approve ${approval.id.slice(-8)}`,
        `To ask first: /discuss ${approval.id.slice(-8)} <question>`,
      ].filter(Boolean).join("\n"),
    };
  }

  const updated = await db.approval.update({
    where: { id: approval.id },
    data: { status: "approved", decidedAt: new Date() },
  });

  // Run the real side effect via the shared executor.
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
    logger.error("telegram-bot.approve-action-failed", { approvalId: updated.id, error: String(err) });
    actionMsg = `action failed: ${String(err).slice(0, 80)}`;
  }

  // Broadcast the decision so the dashboard + conductor polling callers see it.
  try {
    emit({
      type: "approval",
      ts: new Date().toISOString(),
      approval: serializeApproval(updated),
    });
  } catch { /* best-effort */ }

  return {
    ok: true,
    reply: [
      "✅ *Approval GRANTED*",
      "",
      `*Title:* ${updated.title}`,
      `*Action:* ${updated.action ?? "(none)"}`,
      `*Result:* ${actionMsg}`,
      `*ID:* \`${updated.id}\``,
    ].join("\n"),
  };
}

async function handleDeny(arg: string): Promise<CommandResult> {
  const { db } = await import("./db");
  const { emit } = await import("./event-bus");
  const { serializeApproval } = await import("./approval-brief");

  const approval = await resolveApprovalId(arg);
  if (!approval) {
    return {
      ok: false,
      reply: `❌ No pending approval matched "${arg}".\n\nUse /approvals to list pending approvals.`,
    };
  }
  if (approval.status !== "pending") {
    return {
      ok: false,
      reply: `⚠️ Approval "${approval.title}" is already ${approval.status} — no action taken.`,
    };
  }

  const updated = await db.approval.update({
    where: { id: approval.id },
    data: { status: "denied", decidedAt: new Date() },
  });

  try {
    emit({
      type: "approval",
      ts: new Date().toISOString(),
      approval: serializeApproval(updated),
    });
  } catch { /* best-effort */ }

  return {
    ok: true,
    reply: [
      "🚫 *Approval DENIED*",
      "",
      `*Title:* ${updated.title}`,
      `*Action:* ${updated.action ?? "(none)"}`,
      `*ID:* \`${updated.id}\``,
      "",
      "The requesting agent will be notified + may escalate or revise.",
    ].join("\n"),
  };
}

async function handleApprovals(): Promise<CommandResult> {
  const { db } = await import("./db");
  const pending = await db.approval.findMany({
    where: { status: "pending" },
    orderBy: { createdAt: "desc" },
    take: 5,
  });
  if (pending.length === 0) {
    return { ok: true, reply: "📭 No pending approvals. The queue is clear." };
  }
  const lines = ["⏳ *Pending Approvals*", ""];
  for (const a of pending) {
    const suffix = a.id.slice(-8);
    const amount = a.amount ? ` · $${a.amount.toLocaleString()}` : "";
    const created = new Date(a.createdAt).toISOString().slice(0, 16).replace("T", " ");
    lines.push(`• \`${suffix}\` — ${a.title}${amount}`);
    lines.push(`  action: ${a.action ?? "(none)"} · risk: ${a.risk} · ${created}Z`);
  }
  lines.push("", "Reply with /approve <id> or /deny <id> (use the 8-char ID above or the full ID).");
  return { ok: true, reply: lines.join("\n") };
}

// ─── v61 Phase 1 (Audit #4): /discuss command ────────────────────────
// Lets the owner ask a clarifying question BEFORE approving. The question
// is answered by the LLM using the approval brief + prior discussion as
// context, then both Q + A are saved to Approval.discussionLog.
async function handleDiscuss(args: string): Promise<CommandResult> {
  const { db } = await import("./db");
  const { discussApproval } = await import("./approval-brief");

  // Parse: /discuss <id> <question>
  const parts = args.trim().split(/\s+/);
  if (parts.length < 2) {
    return {
      ok: false,
      reply: "Usage: /discuss <approvalId> <question>\n\nExample: /discuss abcd1234 Why is this payment $5,000?",
    };
  }
  const idArg = parts[0];
  const question = parts.slice(1).join(" ").trim();
  if (!question) {
    return { ok: false, reply: "Please provide a question after the approval ID." };
  }

  const approval = await resolveApprovalId(idArg);
  if (!approval) {
    return { ok: false, reply: `❌ No approval matched "${idArg}". Use /approvals to list pending approvals.` };
  }

  try {
    const { answer } = await discussApproval(approval.id, question);
    return {
      ok: true,
      reply: [
        `💬 *Discussion on "${approval.title}"*`,
        "",
        `*You asked:* ${question}`,
        "",
        `*ARIA answered:*`,
        answer,
        "",
        `*ID:* \`${approval.id}\``,
        "",
        "The full thread is saved in the dashboard. When ready:",
        approval.action === "spend"
          ? `/pay-approve ${approval.id.slice(-8)} (60s cooldown applies)`
          : `/approve or /deny ${approval.id.slice(-8)}`,
      ].join("\n"),
    };
  } catch (err) {
    logger.error("telegram-bot.discuss-failed", { approvalId: approval.id, error: String(err) });
    return { ok: false, reply: `Failed to discuss: ${String(err).slice(0, 100)}` };
  }
}

// ─── v61 Phase 1 (Audit #3): /pay-approve command ───────────────────
// The ONLY way to approve a payment (action="spend") approval. Enforces a
// 60-second cooldown between the "intent" and the actual decision to
// prevent accidental clicks. The cooldown is recorded on the Approval
// row itself (payload.intentAt) so it survives across bot restarts.
async function handlePayApprove(arg: string): Promise<CommandResult> {
  const { db } = await import("./db");
  const { emit } = await import("./event-bus");
  const { serializeApproval } = await import("./approval-brief");
  const { executeApprovalAction } = await import("./approval-executor");

  const approval = await resolveApprovalId(arg);
  if (!approval) {
    return { ok: false, reply: `❌ No pending approval matched "${arg}". Use /approvals to list.` };
  }
  if (approval.status !== "pending") {
    return { ok: false, reply: `⚠️ Approval "${approval.title}" is already ${approval.status}.` };
  }
  // Refuse non-payment approvals via this path (they must use /approve).
  if (approval.action !== "spend" && approval.risk !== "high") {
    return {
      ok: false,
      reply: `This is not a payment approval (action="${approval.action}", risk="${approval.risk}"). Use /approve ${approval.id.slice(-8)} instead.`,
    };
  }

  // Parse the payload to check for an intent timestamp.
  let payload: { intentAt?: string; isPayment?: boolean } = {};
  try { payload = JSON.parse(approval.payload ?? "{}"); } catch { /* ignore */ }

  // 60-second cooldown: if intentAt exists + <60s ago, refuse + tell owner to wait.
  const COOLDOWN_MS = 60_000;
  if (payload.intentAt) {
    const elapsed = Date.now() - new Date(payload.intentAt).getTime();
    if (elapsed < COOLDOWN_MS) {
      const remaining = Math.ceil((COOLDOWN_MS - elapsed) / 1000);
      return {
        ok: false,
        reply: [
          "⏳ *COOLDOWN ACTIVE*",
          "",
          `You expressed intent to approve this payment ${Math.floor(elapsed / 1000)}s ago.`,
          `Please wait ${remaining}s more before confirming.`,
          "",
          "This 60-second cooldown prevents accidental payment approvals.",
          "",
          `*Title:* ${approval.title}`,
          approval.amount ? `*Amount:* $${approval.amount.toLocaleString()}` : "",
        ].filter(Boolean).join("\n"),
      };
    }
    // Cooldown elapsed — proceed to approve.
  } else {
    // First attempt: record the intent + tell owner to wait 60s.
    const newPayload = { ...payload, intentAt: new Date().toISOString() };
    await db.approval.update({
      where: { id: approval.id },
      data: { payload: JSON.stringify(newPayload) },
    });
    return {
      ok: true,
      reply: [
        "⏸️ *PAYMENT APPROVAL — INTENT RECORDED*",
        "",
        `*Title:* ${approval.title}`,
        approval.amount ? `*Amount:* $${approval.amount.toLocaleString()}` : "",
        "",
        "To prevent accidental clicks, a 60-second cooldown is now active.",
        "Wait 60s, then re-run:",
        "",
        `/pay-approve ${approval.id.slice(-8)}`,
        "",
        "To ask a question first: /discuss " + approval.id.slice(-8) + " <question>",
      ].filter(Boolean).join("\n"),
    };
  }

  // Cooldown elapsed — approve now.
  const updated = await db.approval.update({
    where: { id: approval.id },
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
    logger.error("telegram-bot.pay-approve-failed", { approvalId: updated.id, error: String(err) });
    actionMsg = `action failed: ${String(err).slice(0, 80)}`;
  }

  try {
    emit({
      type: "approval",
      ts: new Date().toISOString(),
      approval: serializeApproval(updated),
    });
  } catch { /* best-effort */ }

  return {
    ok: true,
    reply: [
      "✅ *PAYMENT APPROVED* (after 60s cooldown)",
      "",
      `*Title:* ${updated.title}`,
      `*Amount:* $${updated.amount?.toLocaleString() ?? "N/A"}`,
      `*Result:* ${actionMsg}`,
      `*ID:* \`${updated.id}\``,
    ].join("\n"),
  };
}

// ─── v61 Phase 3 (Audit: ZERO ASSUMPTIONS): /answer command ──────────
// Resumes a workflow run that was halted because it was missing required
// context. The owner provides the answer; the answer is recorded as a
// context gap resolution in the AgentLog + the run is marked for re-dispatch.
async function handleAnswer(args: string): Promise<CommandResult> {
  const { db } = await import("./db");
  // Parse: /answer <runId> <answer text>
  const parts = args.trim().split(/\s+/);
  if (parts.length < 2) {
    return {
      ok: false,
      reply: "Usage: /answer <runId> <answer>\n\nExample: /answer abcd1234 The customer's email is ceo@acme.com",
    };
  }
  const idArg = parts[0];
  const answer = parts.slice(1).join(" ").trim();
  if (!answer) {
    return { ok: false, reply: "Please provide an answer after the run ID." };
  }

  // The runId can be full or last-8 chars. We search AgentLog meta for it.
  const runIdMatch = idArg.length <= 8 ? { contains: idArg } : { equals: idArg };
  try {
    // Find the NEEDS_CONTEXT log entry.
    const log = await db.agentLog.findFirst({
      where: {
        level: "warn",
        message: { contains: "NEEDS_CONTEXT" },
        OR: [
          { meta: { contains: idArg } },
          { meta: runIdMatch },
        ],
      },
      orderBy: { createdAt: "desc" },
    });

    if (!log) {
      return { ok: false, reply: `❌ No halted task found matching "${idArg}". The run may have already completed or the ID is wrong.` };
    }

    // Record the owner's answer as a new log entry so the workflow engine
    // can pick it up on re-dispatch.
    await db.agentLog.create({
      data: {
        level: "info",
        message: `Owner provided context for run ${idArg}: ${answer.slice(0, 200)}`,
        meta: JSON.stringify({ runId: idArg, answer, resolvedAt: new Date().toISOString() }),
      },
    });

    return {
      ok: true,
      reply: [
        "✅ *CONTEXT PROVIDED*",
        "",
        `*Run:* \`${idArg}\``,
        `*Answer:* ${answer}`,
        "",
        "The workflow will be re-dispatched with this context on the next tick.",
        "If it's still missing fields, you'll get another clarification request.",
      ].join("\n"),
    };
  } catch (err) {
    logger.error("telegram-bot.answer-failed", { error: String(err) });
    return { ok: false, reply: `Failed to record answer: ${String(err).slice(0, 100)}` };
  }
}

// ─── Phase 29 — Inline keyboard callback + /ask + /suggest handlers ─────

/**
 * Handle a Telegram callback_query (owner tapped an inline button on an
 * approval message). Routes to handleOwnerCallback() in owner-approval/,
 * then calls Telegram's answerCallbackQuery to dismiss the loading spinner.
 *
 * Returns true to signal the webhook that the update was processed.
 */
async function handleCallbackQuery(cb: NonNullable<TelegramUpdate["callback_query"]>): Promise<boolean> {
  const { handleOwnerCallback } = await import("./owner-approval/telegram-approval");
  const callbackData = cb.data || "";
  logger.info("telegram-bot.callback-query", {
    callbackId: cb.id,
    data: callbackData,
    from: cb.from?.username,
  });

  let result;
  try {
    result = await handleOwnerCallback(callbackData);
  } catch (err) {
    logger.error("telegram-bot.callback-failed", { callbackData, error: String(err) });
    result = {
      ok: false,
      replyText: `Callback failed: ${String(err).slice(0, 120)}`,
      showAlert: true,
    };
  }

  // 1. answerCallbackQuery — dismisses the loading spinner on the owner's
  //    Telegram client. `show_alert: true` displays the text as a popup
  //    modal; `show_alert: false` displays it as a small toast.
  await answerCallbackQuery(cb.id, result.replyText, result.showAlert ?? false);

  // 2. Send the reply as a new Telegram message (so the conversation
  //    history is preserved in chat for the owner to scroll back to).
  if (result.replyText && !result.showAlert) {
    await sendTelegramMessage(result.replyText);
  }

  return true;
}

/**
 * Call Telegram's answerCallbackQuery to dismiss the loading spinner on
 * an inline button press. Optional `text` is shown as a toast/popup.
 *
 * Documentation: https://core.telegram.org/bots/api#answercallbackquery
 */
async function answerCallbackQuery(
  callbackQueryId: string,
  text: string,
  showAlert: boolean,
): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        callback_query_id: callbackQueryId,
        text: text.slice(0, 200), // Telegram limit
        show_alert: showAlert,
      }),
      signal: AbortSignal.timeout(5_000),
    });
  } catch (err) {
    logger.warn("telegram-bot.answer-callback-failed", { error: String(err) });
  }
}

/**
 * /ask <id> <question> — text equivalent of the 💬 Ask inline button.
 *
 * The <id> can be the full Approval ID or the last 8 characters (suffix
 * match). Resolves to the full approval, then routes to handleOwnerCallback
 * with the "ask:" prefix so the same code path is exercised.
 */
async function handleAskCommand(args: string): Promise<CommandResult> {
  const parts = args.split(/\s+/);
  const idArg = parts[0] || "";
  const question = parts.slice(1).join(" ").trim();

  if (!idArg) {
    return {
      ok: false,
      reply: "Usage: /ask <id> <question>\n\nExample: /ask abc12345 What is the expected ROI if we approve this?",
    };
  }

  const { db } = await import("./db");
  // Try exact match, then suffix match (pending only).
  let approval = await db.approval.findUnique({ where: { id: idArg } });
  if (!approval && idArg.length <= 8) {
    const pending = await db.approval.findMany({
      where: { status: "pending" },
      take: 50,
      orderBy: { createdAt: "desc" },
    });
    approval = pending.find((a) => a.id.endsWith(idArg)) ?? null;
  }
  if (!approval) {
    return { ok: false, reply: `❌ No approval matched "${idArg}". Use /approvals to list pending approvals.` };
  }

  const { handleOwnerCallback } = await import("./owner-approval/telegram-approval");
  const result = await handleOwnerCallback(`ask:${approval.id}`, question);
  return { ok: result.ok, reply: result.replyText };
}

/**
 * /suggest <id> <suggestion> — text equivalent of the ✏️ Suggest inline button.
 *
 * Same flow as /ask: resolve the approval, route through handleOwnerCallback
 * with the "suggest:" prefix.
 */
async function handleSuggestCommand(args: string): Promise<CommandResult> {
  const parts = args.split(/\s+/);
  const idArg = parts[0] || "";
  const suggestion = parts.slice(1).join(" ").trim();

  if (!idArg) {
    return {
      ok: false,
      reply: "Usage: /suggest <id> <suggestion>\n\nExample: /suggest abc12345 Use a smaller batch size and add a rollback plan.",
    };
  }

  const { db } = await import("./db");
  let approval = await db.approval.findUnique({ where: { id: idArg } });
  if (!approval && idArg.length <= 8) {
    const pending = await db.approval.findMany({
      where: { status: "pending" },
      take: 50,
      orderBy: { createdAt: "desc" },
    });
    approval = pending.find((a) => a.id.endsWith(idArg)) ?? null;
  }
  if (!approval) {
    return { ok: false, reply: `❌ No approval matched "${idArg}". Use /approvals to list pending approvals.` };
  }

  const { handleOwnerCallback } = await import("./owner-approval/telegram-approval");
  const result = await handleOwnerCallback(`suggest:${approval.id}`, suggestion);
  return { ok: result.ok, reply: result.replyText };
}
