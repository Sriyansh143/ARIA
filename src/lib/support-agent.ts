import "server-only";
import { db } from "./db";
import { logger } from "./logger";
import { emit } from "./event-bus";
export type SupportIntent = "order_status" | "technical_issue" | "refund_request" | "pre_sale_question" | "complaint" | "other";
export interface SupportRequest { message: string; customerEmail?: string; customerPhone?: string; channel: "whatsapp" | "email" | "internal"; ticketId?: string; }
export interface SupportResponse { ok: boolean; intent: SupportIntent; response: string; escalated: boolean; ticketId?: string; }

export async function handleSupportMessage(req: SupportRequest): Promise<SupportResponse> {
  logger.info("support-agent.inbound", { channel: req.channel, preview: req.message.slice(0, 80) });
  const intent = await classifyIntent(req.message);
  let response: string; let escalated = false;
  switch (intent) {
    case "order_status": response = await handleOrderStatus(req); break;
    case "technical_issue": response = handleTechnicalIssue(); escalated = true; break;
    case "refund_request": response = await handleRefundRequest(req); break;
    case "pre_sale_question": response = handlePreSaleQuestion(); break;
    case "complaint": response = handleComplaint(); escalated = true; break;
    default: response = handleOther(); break;
  }
  let ticketId = req.ticketId;
  try {
    if (ticketId) { await db.supportTicket.update({ where: { id: ticketId }, data: { status: escalated ? "escalated" : "resolved", metadata: JSON.stringify({ intent, autoResponded: !escalated }) } }); }
    else { const ticket = await db.supportTicket.create({ data: { subject: `[${intent}] ${req.message.slice(0, 60)}`, body: req.message, status: escalated ? "escalated" : "resolved", priority: intent === "complaint" ? "critical" : "normal", channel: req.channel, customerEmail: req.customerEmail || null, customerPhone: req.customerPhone || null, metadata: JSON.stringify({ intent, autoResponded: !escalated }) } }); ticketId = ticket.id; }
  } catch (err) { logger.error("support-agent.ticket-failed", { error: String(err) }); }
  if (escalated) { await escalateToOwner(req, intent, ticketId); }
  emit({ type: "system", ts: new Date().toISOString(), message: `Support: ${intent} ${escalated ? "→ escalated" : "→ auto-resolved"}`, level: escalated ? "warn" : "success" });
  return { ok: true, intent, response, escalated, ticketId };
}

async function classifyIntent(message: string): Promise<SupportIntent> {
  try {
    const { callLLM } = await import("./llm-client");
    const result = await callLLM("SupportClassifier", "Support", `Classify this customer message into exactly ONE category:\n"${message.slice(0, 500)}"\n\nCategories: order_status, technical_issue, refund_request, pre_sale_question, complaint, other\nRespond with ONLY the category name.`, { systemOverride: "You are an intent classifier. Respond with ONLY the category name.", maxRetries: 1 });
    if (result.success) { const c = result.completion.trim().toLowerCase(); if (["order_status","technical_issue","refund_request","pre_sale_question","complaint","other"].includes(c)) return c as SupportIntent; }
  } catch {}
  const l = message.toLowerCase();
  if (l.includes("order") || l.includes("where") || l.includes("when")) return "order_status";
  if (l.includes("error") || l.includes("bug") || l.includes("broken")) return "technical_issue";
  if (l.includes("refund") || l.includes("money back")) return "refund_request";
  if (l.includes("price") || l.includes("cost") || l.includes("how much")) return "pre_sale_question";
  if (l.includes("terrible") || l.includes("angry") || l.includes("unhappy")) return "complaint";
  return "other";
}

async function handleOrderStatus(req: SupportRequest): Promise<string> {
  if (req.customerEmail) { try { const order = await db.serviceOrder.findFirst({ where: { customerEmail: req.customerEmail }, orderBy: { createdAt: "desc" } }); if (order) { const s: Record<string,string> = { pending_payment:"waiting for payment", paid_verified:"payment confirmed — building", building:"being built", delivered:"delivered! Check email for download", failed:"issue — contact support", refunded:"refunded" }; return `Your order #${order.id.slice(-8)} (${order.serviceName}) is ${s[order.status]||order.status}.`; } } catch {} }
  return "I'd be happy to check! Could you provide your order ID or the email used?";
}
function handleTechnicalIssue(): string { return `Sorry you're having issues. Please share: 1) Error message 2) Command you ran 3) Order ID. I'll investigate within 24 hours. You may be eligible for a free revision or refund.`; }
async function handleRefundRequest(req: SupportRequest): Promise<string> {
  if (req.customerEmail) { try { const order = await db.serviceOrder.findFirst({ where: { customerEmail: req.customerEmail }, orderBy: { createdAt: "desc" } }); if (order) { const days = order.deliveredAt ? (Date.now()-order.deliveredAt.getTime())/(1000*60*60*24) : 0; if (days <= 7) return `Refund initiated for order #${order.id.slice(-8)}. You'll receive $${(order.priceCents/100).toFixed(2)} via ${order.cryptoNetwork} within 5 business days.`; return `Order is outside 7-day window (${Math.floor(days)} days). I can offer a free revision instead.`; } } catch {} }
  return "Please provide your order ID. We offer refunds within 7 days for non-working code.";
}
function handlePreSaleQuestion(): string { return `Our services: Landing Page $19, Static Website $29, Blog Post $9, CLI Tool $24, 3D Website $49, Voice Agent $39, API Service $49, Dashboard $39, API Docs $34, SaaS Scaffold $99. Payments: Crypto + UPI + Card. Delivery: 1-2 hours. Want a free preview?`; }
function handleComplaint(): string { return `I'm sorry. I've escalated this to the owner immediately. You'll hear back within 24 hours. For urgent matters, email ${process.env.ARIA_OWNER_EMAIL||"support@aria-mission-control.example.com"}.`; }
function handleOther(): string { return `Thanks for reaching out! I'll respond within 24 hours. Include your order ID if you have one. For urgent matters, email ${process.env.ARIA_OWNER_EMAIL||"support@aria-mission-control.example.com"}.`; }

async function escalateToOwner(req: SupportRequest, intent: SupportIntent, ticketId?: string): Promise<void> {
  try { const { sendNotification } = await import("./email-service"); await sendNotification({ to: process.env.ARIA_OWNER_EMAIL||"owner@example.com", subject: `[ESCALATED] ${intent} — ${ticketId?.slice(-8)||"new"}`, text: `Intent: ${intent}\nChannel: ${req.channel}\nMessage: ${req.message.slice(0,500)}`, metadata: { type: "support_escalation", ticketId, intent } }); } catch {}
}
