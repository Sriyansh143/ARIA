// =====================================================================
// customer-support.ts — Lightweight self-hosted customer support chat.
// =====================================================================
// Stores SupportConversation + SupportMessage as MemoryItem rows
// (scope='support-conversation' + scope='support-message'). No external
// service required — reuses the existing Next.js server + Prisma layer.
//
// Env vars:
//   TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID  (for owner notifications)
// =====================================================================

import { db } from '@/lib/db';
import { quickChat } from '@/lib/llm';
import crypto from 'crypto';

export interface SupportConversation {
  id: string;
  customerName: string | null;
  customerEmail: string | null;
  status: 'open' | 'pending' | 'resolved';
  lastMessage: string | null;
  lastMessageAt: string;
  unreadCount: number;
  createdAt: string;
}

export interface SupportMessage {
  id: string;
  conversationId: string;
  role: 'customer' | 'agent';
  content: string;
  createdAt: string;
}

// ─── Conversation helpers ────────────────────────────────────────────
async function createConversation(opts: {
  customerName?: string;
  customerEmail?: string;
  firstMessage: string;
}): Promise<SupportConversation> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const conv: SupportConversation = {
    id,
    customerName: opts.customerName || null,
    customerEmail: opts.customerEmail || null,
    status: 'open',
    lastMessage: opts.firstMessage.slice(0, 200),
    lastMessageAt: now,
    unreadCount: 1,
    createdAt: now,
  };
  await db.memoryItem.create({
    data: {
      key: `support-conv-${id}`,
      scope: 'support-conversation',
      value: JSON.stringify(conv),
      tags: JSON.stringify(['support', 'open']),
    },
  });
  return conv;
}

async function findConversation(id: string): Promise<SupportConversation | null> {
  const row = await db.memoryItem.findUnique({
    where: { key_scope: { key: `support-conv-${id}`, scope: 'support-conversation' } },
  });
  if (!row) return null;
  try {
    return JSON.parse(row.value) as SupportConversation;
  } catch {
    return null;
  }
}

async function updateConversation(id: string, patch: Partial<SupportConversation>): Promise<void> {
  const current = await findConversation(id);
  if (!current) return;
  const merged: SupportConversation = { ...current, ...patch };
  await db.memoryItem.update({
    where: { key_scope: { key: `support-conv-${id}`, scope: 'support-conversation' } },
    data: {
      value: JSON.stringify(merged),
      tags: JSON.stringify(['support', merged.status]),
    },
  });
}

// ─── Message helpers ─────────────────────────────────────────────────
async function createMessage(opts: {
  conversationId: string;
  role: 'customer' | 'agent';
  content: string;
}): Promise<SupportMessage> {
  const id = crypto.randomUUID();
  const msg: SupportMessage = {
    id,
    conversationId: opts.conversationId,
    role: opts.role,
    content: opts.content,
    createdAt: new Date().toISOString(),
  };
  await db.memoryItem.create({
    data: {
      key: `support-msg-${id}`,
      scope: 'support-message',
      value: JSON.stringify(msg),
      tags: JSON.stringify(['support', opts.role, opts.conversationId]),
    },
  });
  return msg;
}

async function listMessagesFor(conversationId: string): Promise<SupportMessage[]> {
  const rows = await db.memoryItem.findMany({
    where: { scope: 'support-message', tags: { contains: conversationId } },
    orderBy: { createdAt: 'asc' },
    take: 500,
  });
  const out: SupportMessage[] = [];
  for (const row of rows) {
    try {
      out.push(JSON.parse(row.value) as SupportMessage);
    } catch {}
  }
  // Sort again in case createdAt strings don't match row order.
  out.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  return out;
}

// ─── Customer: send a message ────────────────────────────────────────
export async function customerSendMessage(opts: {
  conversationId?: string;
  customerName?: string;
  customerEmail?: string;
  content: string;
}): Promise<{ ok: boolean; conversationId?: string; error?: string }> {
  try {
    let convId = opts.conversationId;
    if (!convId) {
      const conv = await createConversation({
        customerName: opts.customerName,
        customerEmail: opts.customerEmail,
        firstMessage: opts.content,
      });
      convId = conv.id;
    } else {
      const current = await findConversation(convId);
      if (!current) {
        return { ok: false, error: 'Conversation not found' };
      }
      await updateConversation(convId, {
        lastMessage: opts.content.slice(0, 200),
        lastMessageAt: new Date().toISOString(),
        unreadCount: current.unreadCount + 1,
      });
    }

    await createMessage({
      conversationId: convId,
      role: 'customer',
      content: opts.content,
    });

    // Telegram notification to owner
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (botToken && chatId) {
      try {
        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: `💬 *New support message*\n\nFrom: ${opts.customerName || 'Anonymous'}${opts.customerEmail ? ` (${opts.customerEmail})` : ''}\n\n${opts.content.slice(0, 500)}`,
            parse_mode: 'Markdown',
          }),
          signal: AbortSignal.timeout(5_000),
        });
      } catch {}
    }

    return { ok: true, conversationId: convId };
  } catch (err: any) {
    console.error('customer-support: failed to send message', { err: err?.message });
    return { ok: false, error: err?.message || 'Failed to send message' };
  }
}

// ─── Agent (owner): send a reply to a customer ───────────────────────
export async function agentSendReply(
  conversationId: string,
  content: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const current = await findConversation(conversationId);
    if (!current) return { ok: false, error: 'Conversation not found' };

    await createMessage({ conversationId, role: 'agent', content });

    await updateConversation(conversationId, {
      lastMessage: content.slice(0, 200),
      lastMessageAt: new Date().toISOString(),
      status: 'pending', // waiting for customer to reply
      unreadCount: 0,
    });
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Failed to send reply' };
  }
}

// ─── List all conversations (for the dashboard Support tab) ──────────
export async function listConversations(): Promise<SupportConversation[]> {
  const rows = await db.memoryItem.findMany({
    where: { scope: 'support-conversation' },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  const out: SupportConversation[] = [];
  for (const row of rows) {
    try {
      out.push(JSON.parse(row.value) as SupportConversation);
    } catch {}
  }
  // Re-sort by lastMessageAt desc (more accurate than row.createdAt).
  out.sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime());
  return out;
}

// ─── Get messages in a conversation ──────────────────────────────────
export async function getMessages(conversationId: string): Promise<SupportMessage[]> {
  return await listMessagesFor(conversationId);
}

// ─── Generate an AI-suggested reply ──────────────────────────────────
export async function suggestReply(
  conversationId: string,
): Promise<{ ok: boolean; suggestion?: string; error?: string }> {
  try {
    const messages = await getMessages(conversationId);
    if (messages.length === 0) {
      return { ok: false, error: 'No messages to suggest a reply for' };
    }

    const recent = messages.slice(-6);
    const context = recent
      .map((m) => `${m.role === 'customer' ? 'Customer' : 'Agent'}: ${m.content}`)
      .join('\n');

    const suggestion = await quickChat(
      `You are a helpful customer support agent. Based on the conversation below, draft a concise, friendly reply to the customer's most recent message. Sign off as "JARVIS Support Team".\n\nConversation:\n${context}\n\nYour reply:`,
      'You are a helpful customer support assistant. Reply concisely.',
    );

    if (!suggestion) return { ok: false, error: 'Empty suggestion' };
    return { ok: true, suggestion };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Failed to generate suggestion' };
  }
}

// ─── Mark conversation as resolved ───────────────────────────────────
export async function resolveConversation(conversationId: string): Promise<{ ok: boolean }> {
  try {
    await updateConversation(conversationId, { status: 'resolved' });
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

// ─── Stats (useful for the dashboard) ────────────────────────────────
export async function getSupportStats(): Promise<{
  total: number;
  open: number;
  pending: number;
  resolved: number;
  unreadTotal: number;
}> {
  const rows = await db.memoryItem.findMany({ where: { scope: 'support-conversation' } });
  let total = 0;
  let open = 0;
  let pending = 0;
  let resolved = 0;
  let unreadTotal = 0;
  for (const row of rows) {
    try {
      const c = JSON.parse(row.value) as SupportConversation;
      total++;
      if (c.status === 'open') open++;
      else if (c.status === 'pending') pending++;
      else if (c.status === 'resolved') resolved++;
      unreadTotal += c.unreadCount || 0;
    } catch {}
  }
  return { total, open, pending, resolved, unreadTotal };
}
