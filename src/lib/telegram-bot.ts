/**
 * telegram-bot.ts — Telegram bot integration.
 * Ported from jarvis zip's telegram-broadcaster.ts.
 *
 * Uses TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID from .env.
 * Sends messages, photos, documents to the owner.
 * Also handles incoming webhook commands (approval buttons).
 */

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const API_BASE = `https://api.telegram.org/bot${BOT_TOKEN}`;

export function isTelegramConfigured(): boolean {
  return !!(BOT_TOKEN && CHAT_ID);
}

export async function sendToOwner(message: string): Promise<boolean> {
  if (!isTelegramConfigured()) return false;
  try {
    const r = await fetch(`${API_BASE}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        text: message.slice(0, 4096),
        parse_mode: 'Markdown',
      }),
      signal: AbortSignal.timeout(10000),
    });
    return r.ok;
  } catch {
    return false;
  }
}

export async function sendToOwnerWithButtons(
  message: string,
  buttons: Array<{ text: string; callback_data: string }>,
): Promise<boolean> {
  if (!isTelegramConfigured()) return false;
  try {
    const r = await fetch(`${API_BASE}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        text: message.slice(0, 4096),
        parse_mode: 'Markdown',
        reply_markup: JSON.stringify({
          inline_keyboard: [buttons],
        }),
      }),
      signal: AbortSignal.timeout(10000),
    });
    return r.ok;
  } catch {
    return false;
  }
}

export async function sendApprovalRequest(
  title: string,
  description: string,
  approvalId: string,
): Promise<boolean> {
  const message = `🔔 *Approval Required*

*${title}*

${description}

Tap a button below to approve or reject.`;
  return sendToOwnerWithButtons(message, [
    { text: '✅ Approve', callback_data: `approve:${approvalId}` },
    { text: '❌ Reject', callback_data: `reject:${approvalId}` },
  ]);
}

export async function sendPhotoToOwner(photoBuffer: Buffer, caption?: string): Promise<boolean> {
  if (!isTelegramConfigured()) return false;
  try {
    const fd = new FormData();
    fd.append('chat_id', CHAT_ID!);
    fd.append('photo', new Blob([new Uint8Array(photoBuffer)]), 'image.jpg');
    if (caption) fd.append('caption', caption.slice(0, 1024));
    const r = await fetch(`${API_BASE}/sendPhoto`, {
      method: 'POST',
      body: fd,
      signal: AbortSignal.timeout(15000),
    });
    return r.ok;
  } catch {
    return false;
  }
}

export async function sendDocumentToOwner(
  fileBuffer: Buffer,
  filename: string,
  caption?: string,
): Promise<boolean> {
  if (!isTelegramConfigured()) return false;
  try {
    const fd = new FormData();
    fd.append('chat_id', CHAT_ID!);
    fd.append('document', new Blob([new Uint8Array(fileBuffer)]), filename);
    if (caption) fd.append('caption', caption.slice(0, 1024));
    const r = await fetch(`${API_BASE}/sendDocument`, {
      method: 'POST',
      body: fd,
      signal: AbortSignal.timeout(30000),
    });
    return r.ok;
  } catch {
    return false;
  }
}

/**
 * Handle incoming Telegram webhook (commands + approval callbacks).
 */
export async function handleTelegramUpdate(update: {
  message?: { text?: string; from?: { first_name?: string } };
  callback_query?: { data?: string; message?: { message_id?: number } };
}): Promise<{ ok: boolean; response?: string }> {
  // Handle callback (approval button)
  if (update.callback_query?.data) {
    const data = update.callback_query.data;
    const [action, id] = data.split(':');
    if (action === 'approve' || action === 'reject') {
      // Resolve the approval via the approvals API
      try {
        await fetch('http://localhost:3000/api/approvals', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, decision: action }),
        });
        return { ok: true, response: `Approval ${action}d` };
      } catch {
        return { ok: false, response: 'Failed to resolve approval' };
      }
    }
  }

  // Handle text message (command from owner)
  if (update.message?.text) {
    const text = update.message.text;

    // Handle special commands
    if (text === '/pause' || text === '/stop') {
      try {
        await fetch('http://localhost:3000/api/system/autonomy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'pause' }),
        });
        await sendToOwner('🛑 *Autonomy PAUSED*\n\nAll cron jobs are now paused. The dashboard remains operational. Send /resume to restart.');
        return { ok: true, response: 'Autonomy paused' };
      } catch {
        return { ok: false, response: 'Failed to pause' };
      }
    }

    if (text === '/resume' || text === '/start') {
      try {
        await fetch('http://localhost:3000/api/system/autonomy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'resume' }),
        });
        await sendToOwner('✅ *Autonomy RESUMED*\n\nAll cron jobs are now active again.');
        return { ok: true, response: 'Autonomy resumed' };
      } catch {
        return { ok: false, response: 'Failed to resume' };
      }
    }

    if (text === '/status') {
      try {
        const r = await fetch('http://localhost:3000/api/system/autonomy');
        const data = await r.json();
        const status = data.paused ? 'PAUSED' : 'ACTIVE';
        await sendToOwner(`📊 *System Status*\n\nAutonomy: ${status}\nTime: ${new Date().toISOString()}`);
        return { ok: true, response: `Status: ${status}` };
      } catch {
        return { ok: false, response: 'Failed to get status' };
      }
    }

    // Forward to the Orion command API
    try {
      const r = await fetch('http://localhost:3000/api/orion/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, sessionId: 'telegram' }),
      });
      const json = await r.json();
      // Send the response back to the owner
      if (json.response) {
        await sendToOwner(json.response);
      }
      return { ok: true, response: json.response };
    } catch {
      return { ok: false, response: 'Command failed' };
    }
  }

  return { ok: true };
}
