// =====================================================================
// chatwoot-integration.ts — Full Chatwoot integration for JARVIS.
// =====================================================================
// Chatwoot (https://github.com/chatwoot/chatwoot) is an open-source
// customer support platform. This module integrates JARVIS with a
// self-hosted Chatwoot instance so the dashboard can:
//   - Show all Chatwoot conversations in the dashboard Support tab
//   - Reply to customer messages directly from JARVIS
//   - Use JARVIS's LLM to draft suggested replies
//   - Auto-assign conversations to JARVIS agents
//
// SETUP:
//   1. Install Chatwoot: https://www.chatwoot.com/docs/self-hosted
//   2. Create an agent bot token in Chatwoot → Settings → Agents → Bots
//   3. Set CHATWOOT_BASE_URL + CHATWOOT_API_TOKEN + CHATWOOT_ACCOUNT_ID in .env
//
// If Chatwoot isn't configured, this module is a no-op and the built-in
// customer-support.ts module is used instead.
//
// Env vars:
//   CHATWOOT_BASE_URL       e.g. https://chat.example.com
//   CHATWOOT_API_TOKEN      agent bot token
//   CHATWOOT_ACCOUNT_ID     numeric account id
//   CHATWOOT_AUTO_REPLY     set to '1' to enable LLM auto-reply
//   TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID   (for owner notifications)
// =====================================================================

export interface ChatwootConversation {
  id: number;
  status: 'open' | 'resolved' | 'pending';
  contact: {
    id: number;
    name: string;
    email: string | null;
    avatar: string | null;
  };
  lastMessage: string | null;
  lastMessageAt: string;
  unreadCount: number;
  assignee: { id: number; name: string } | null;
  messages: ChatwootMessage[];
}

export interface ChatwootMessage {
  id: number;
  content: string;
  sender: 'contact' | 'agent' | 'bot';
  createdAt: string;
}

// ─── Check if Chatwoot is configured ─────────────────────────────────
export function isChatwootConfigured(): boolean {
  return !!(process.env.CHATWOOT_BASE_URL && process.env.CHATWOOT_API_TOKEN);
}

function getAccountId(accountId?: number): number | null {
  const id = accountId || Number(process.env.CHATWOOT_ACCOUNT_ID);
  return Number.isFinite(id) && id > 0 ? id : null;
}

// ─── List all Chatwoot conversations ─────────────────────────────────
export async function listChatwootConversations(accountId?: number): Promise<{
  ok: boolean;
  conversations?: ChatwootConversation[];
  error?: string;
}> {
  if (!isChatwootConfigured()) {
    return { ok: false, error: 'Chatwoot not configured. Set CHATWOOT_BASE_URL and CHATWOOT_API_TOKEN.' };
  }
  const acctId = getAccountId(accountId);
  if (!acctId) {
    return { ok: false, error: 'CHATWOOT_ACCOUNT_ID required to list conversations' };
  }
  try {
    const r = await fetch(
      `${process.env.CHATWOOT_BASE_URL}/api/v1/accounts/${acctId}/conversations`,
      {
        headers: {
          api_access_token: process.env.CHATWOOT_API_TOKEN!,
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      return { ok: false, error: `Chatwoot API ${r.status}: ${txt.slice(0, 200)}` };
    }
    const data = await r.json();
    const conversations: ChatwootConversation[] = (data.payload || []).map((c: any) => ({
      id: c.id,
      status: c.status,
      contact: {
        id: c.meta?.sender?.id,
        name: c.meta?.sender?.name || 'Anonymous',
        email: c.meta?.sender?.email || null,
        avatar: c.meta?.sender?.avatar_url || null,
      },
      lastMessage: c.messages?.[0]?.content || null,
      lastMessageAt: c.last_activity_at,
      unreadCount: c.unread_count || 0,
      assignee: c.meta?.assignee ? { id: c.meta.assignee.id, name: c.meta.assignee.name } : null,
      messages: [],
    }));
    return { ok: true, conversations };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Failed to list Chatwoot conversations' };
  }
}

// ─── Get messages for a Chatwoot conversation ────────────────────────
export async function getChatwootMessages(
  conversationId: number,
  accountId?: number,
): Promise<{
  ok: boolean;
  messages?: ChatwootMessage[];
  error?: string;
}> {
  if (!isChatwootConfigured()) {
    return { ok: false, error: 'Chatwoot not configured' };
  }
  const acctId = getAccountId(accountId);
  if (!acctId) return { ok: false, error: 'CHATWOOT_ACCOUNT_ID required' };
  try {
    const r = await fetch(
      `${process.env.CHATWOOT_BASE_URL}/api/v1/accounts/${acctId}/conversations/${conversationId}/messages`,
      {
        headers: { api_access_token: process.env.CHATWOOT_API_TOKEN! },
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!r.ok) {
      return { ok: false, error: `Chatwoot API ${r.status}` };
    }
    const data = await r.json();
    const messages: ChatwootMessage[] = (data.payload || []).map((m: any) => ({
      id: m.id,
      content: m.content,
      sender:
        m.sender_type === 'contact' ? 'contact' : m.sender_type === 'agent' ? 'agent' : 'bot',
      createdAt: m.created_at,
    }));
    return { ok: true, messages };
  } catch (err: any) {
    return { ok: false, error: err?.message };
  }
}

// ─── Reply to a Chatwoot conversation ────────────────────────────────
export async function replyToChatwootConversation(
  conversationId: number,
  content: string,
  accountId?: number,
): Promise<{ ok: boolean; error?: string }> {
  if (!isChatwootConfigured()) {
    return { ok: false, error: 'Chatwoot not configured' };
  }
  const acctId = getAccountId(accountId);
  if (!acctId) return { ok: false, error: 'CHATWOOT_ACCOUNT_ID required' };
  try {
    const r = await fetch(
      `${process.env.CHATWOOT_BASE_URL}/api/v1/accounts/${acctId}/conversations/${conversationId}/messages`,
      {
        method: 'POST',
        headers: {
          api_access_token: process.env.CHATWOOT_API_TOKEN!,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          content,
          message_type: 'outgoing',
          private: false,
        }),
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!r.ok) {
      return { ok: false, error: `Chatwoot API ${r.status}` };
    }
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message };
  }
}

// ─── Resolve a Chatwoot conversation ─────────────────────────────────
export async function resolveChatwootConversation(
  conversationId: number,
  accountId?: number,
): Promise<{ ok: boolean; error?: string }> {
  if (!isChatwootConfigured()) {
    return { ok: false, error: 'Chatwoot not configured' };
  }
  const acctId = getAccountId(accountId);
  if (!acctId) return { ok: false, error: 'CHATWOOT_ACCOUNT_ID required' };
  try {
    const r = await fetch(
      `${process.env.CHATWOOT_BASE_URL}/api/v1/accounts/${acctId}/conversations/${conversationId}/toggle_status`,
      {
        method: 'POST',
        headers: {
          api_access_token: process.env.CHATWOOT_API_TOKEN!,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status: 'resolved' }),
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!r.ok) {
      return { ok: false, error: `Chatwoot API ${r.status}` };
    }
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message };
  }
}

// ─── Chatwoot webhook handler ────────────────────────────────────────
// Called by Chatwoot when a new message arrives. Forwards to JARVIS's
// Telegram owner + auto-responds via LLM if CHATWOOT_AUTO_REPLY=1.
export async function handleChatwootWebhook(event: any): Promise<{ ok: boolean }> {
  try {
    const eventType = event?.event;
    if (eventType !== 'message_created') return { ok: true };

    const msg = event?.data;
    if (!msg) return { ok: true };

    if (msg.message_type !== 'incoming') return { ok: true };

    const contactName = msg.sender?.name || 'Anonymous';
    const content = msg.content || '';

    // Notify owner via Telegram
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (botToken && chatId) {
      try {
        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: `💬 *New Chatwoot message*\n\nFrom: ${contactName}\n\n${content.slice(0, 500)}`,
            parse_mode: 'Markdown',
          }),
          signal: AbortSignal.timeout(5_000),
        });
      } catch {}
    }

    // Auto-reply if enabled
    if (process.env.CHATWOOT_AUTO_REPLY === '1' && msg.conversation?.id) {
      try {
        // Use JARVIS's own LLM directly (no /api/router dependency).
        const { quickChat } = await import('@/lib/llm');
        const reply = await quickChat(
          `A customer named ${contactName} sent this message via support chat: "${content}". Write a brief, friendly, helpful reply. Sign as "JARVIS Support".`,
          'You are a helpful customer support assistant. Reply concisely.',
        );
        if (reply) {
          await replyToChatwootConversation(msg.conversation.id, reply);
        }
      } catch (err: any) {
        console.warn('chatwoot: auto-reply failed', { err: err?.message });
      }
    }

    return { ok: true };
  } catch (err: any) {
    console.error('chatwoot: webhook handler failed', { err: err?.message });
    return { ok: false };
  }
}
