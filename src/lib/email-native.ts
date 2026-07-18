// =====================================================================
// email-native.ts — Native SMTP send + IMAP inbox reader (zero-dep).
// =====================================================================
// Uses Node's built-in `tls` + `net` modules to talk SMTP/IMAP directly —
// no `nodemailer` dependency. Outgoing emails are queued as a MemoryItem
// (scope='email-outbox') AND a Notification so the dashboard can surface
// them.
//
// Required env vars:
//   SMTP_HOST, SMTP_PORT (default 465), SMTP_USER, SMTP_PASS
//   IMAP_HOST, IMAP_PORT (default 993), IMAP_USER (or SMTP_USER),
//   IMAP_PASS (or SMTP_PASS)
// =====================================================================

import tls from 'tls';
import net from 'net';
import crypto from 'crypto';
import { db } from '@/lib/db';

export interface SendEmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
  queuedAt: string;
}

export interface InboxEmail {
  from: string;
  subject: string;
  date: string;
  body: string;
}

export interface ReadInboxResult {
  success: boolean;
  emails?: InboxEmail[];
  error?: string;
}

// ─── Send a raw email via SMTP over TLS ───────────────────────────────
export async function sendRawEmail(
  to: string,
  subject: string,
  body: string,
): Promise<SendEmailResult> {
  const queuedAt = new Date().toISOString();
  const host = process.env.SMTP_HOST || 'smtp.gmail.com';
  const port = parseInt(process.env.SMTP_PORT || '465', 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!user || !pass) {
    const err = 'SMTP_USER and SMTP_PASS not set';
    await queueOutgoingEmail({ to, subject, body, success: false, error: err, queuedAt });
    return { success: false, error: err, queuedAt };
  }

  const result = await new Promise<SendEmailResult>((resolve) => {
    const socket = tls.connect(port, host, { host, rejectUnauthorized: false });
    let step = 0;
    const cmds = [
      `EHLO localhost\r\n`,
      `AUTH LOGIN\r\n`,
      `${Buffer.from(user).toString('base64')}\r\n`,
      `${Buffer.from(pass).toString('base64')}\r\n`,
      `MAIL FROM:<${user}>\r\n`,
      `RCPT TO:<${to}>\r\n`,
      `DATA\r\n`,
      `From: ${user}\r\nTo: ${to}\r\nSubject: ${subject}\r\n\r\n${body}\r\n.\r\n`,
      `QUIT\r\n`,
    ];

    socket.on('secureConnect', () => {
      // connection established — wait for server greeting
    });

    socket.on('data', (data) => {
      const code = parseInt(data.toString().trim().split(' ')[0], 10);
      if (code >= 200 && code < 400 && step < cmds.length) {
        socket.write(cmds[step++]);
      } else if (code >= 400) {
        resolve({ success: false, error: `SMTP ${code}`, queuedAt });
        socket.destroy();
      } else if (step >= cmds.length) {
        const messageId = crypto.randomUUID();
        resolve({ success: true, messageId, queuedAt });
        socket.destroy();
      }
    });

    socket.on('error', (e) => resolve({ success: false, error: e.message, queuedAt }));
    socket.setTimeout(10_000);
    socket.on('timeout', () => {
      resolve({ success: false, error: 'SMTP timeout', queuedAt });
      socket.destroy();
    });
  });

  await queueOutgoingEmail({
    to,
    subject,
    body,
    success: result.success,
    error: result.error,
    messageId: result.messageId,
    queuedAt,
  });

  return result;
}

// ─── Queue an outgoing email record (MemoryItem + Notification) ──────
async function queueOutgoingEmail(opts: {
  to: string;
  subject: string;
  body: string;
  success: boolean;
  error?: string;
  messageId?: string;
  queuedAt: string;
}): Promise<void> {
  try {
    const key = `email-out-${crypto.randomUUID()}`;
    const value = JSON.stringify({
      to: opts.to,
      subject: opts.subject,
      body: opts.body.slice(0, 4000),
      success: opts.success,
      error: opts.error ?? null,
      messageId: opts.messageId ?? null,
      queuedAt: opts.queuedAt,
    });
    await db.memoryItem.create({
      data: {
        key,
        scope: 'email-outbox',
        value,
        tags: JSON.stringify(['email', opts.success ? 'sent' : 'failed']),
      },
    });
    await db.notification.create({
      data: {
        type: opts.success ? 'success' : 'error',
        title: opts.success ? `Email sent → ${opts.to}` : `Email failed → ${opts.to}`,
        message: opts.success
          ? `Subject: ${opts.subject}`
          : `Subject: ${opts.subject} — ${opts.error ?? 'unknown error'}`,
        read: false,
      },
    });
  } catch (err) {
    console.error('email-native: failed to queue outgoing email record', err);
  }
}

// ─── Read emails from an IMAP inbox over TLS ─────────────────────────
export async function readInbox(opts?: {
  maxResults?: number;
  search?: string;
}): Promise<ReadInboxResult> {
  const host = process.env.IMAP_HOST || 'imap.gmail.com';
  const port = parseInt(process.env.IMAP_PORT || '993', 10);
  const user = process.env.IMAP_USER || process.env.SMTP_USER;
  const pass = process.env.IMAP_PASS || process.env.SMTP_PASS;

  if (!user || !pass) {
    return {
      success: false,
      error: 'IMAP_USER and IMAP_PASS (or SMTP_USER/SMTP_PASS) not set',
    };
  }

  const max = opts?.maxResults ?? 10;

  return new Promise<ReadInboxResult>((resolve) => {
    const socket = tls.connect(port, host, { host, rejectUnauthorized: false });
    let step = 0;
    let buffer = '';
    const emails: InboxEmail[] = [];
    let currentEmail: Partial<InboxEmail> | null = null;

    const commands = [
      `a1 LOGIN ${user} ${pass}\r\n`,
      `a2 SELECT INBOX\r\n`,
      `a3 SEARCH ALL\r\n`,
      `a4 FETCH 1:${max} (BODY[HEADER.FIELDS (FROM SUBJECT DATE)] BODY[TEXT])\r\n`,
      `a5 LOGOUT\r\n`,
    ];

    socket.on('secureConnect', () => {
      // wait for server greeting
    });

    socket.on('data', (data) => {
      buffer += data.toString();

      if (buffer.includes('\r\n') && step < commands.length) {
        if (step === 2) {
          const match = buffer.match(/\* SEARCH (.+)/);
          if (match) {
            const uids = match[1].trim().split(' ').slice(0, max);
            if (uids.length > 0) {
              const uidList = uids.join(',');
              commands[3] = `a4 FETCH ${uidList} (BODY[HEADER.FIELDS (FROM SUBJECT DATE)] BODY[TEXT])\r\n`;
            }
          }
        }

        if (step === 3) {
          const lines = buffer.split('\r\n');
          let inEmail = false;
          for (const line of lines) {
            if (line.includes('BODY[HEADER.FIELDS')) continue;
            if (line.includes('BODY[TEXT]')) continue;
            if (line.startsWith(' From:')) {
              if (currentEmail) emails.push(currentEmail as InboxEmail);
              currentEmail = {
                from: line.replace(' From: ', '').trim(),
                subject: '',
                date: '',
                body: '',
              };
              inEmail = true;
              continue;
            }
            if (line.startsWith(' Subject:')) {
              if (currentEmail) currentEmail.subject = line.replace(' Subject: ', '').trim();
              continue;
            }
            if (line.startsWith(' Date:')) {
              if (currentEmail) currentEmail.date = line.replace(' Date: ', '').trim();
              continue;
            }
            if (inEmail && currentEmail && line.trim() && !line.startsWith('a') && !line.includes('*')) {
              currentEmail.body += line + '\n';
            }
          }
          if (currentEmail) emails.push(currentEmail as InboxEmail);
        }

        buffer = '';
        socket.write(commands[step++]);
      }

      if (step >= commands.length) {
        resolve({
          success: true,
          emails: emails.slice(0, max).map((e) => ({ ...e, body: e.body.slice(0, 2000) })),
        });
        socket.destroy();
      }
    });

    socket.on('error', (err) => {
      resolve({ success: false, error: err.message });
    });

    socket.setTimeout(15_000);
    socket.on('timeout', () => {
      resolve({ success: false, error: 'IMAP timeout' });
      socket.destroy();
    });
  });
}

// Unused import guard — `net` is kept for future plain-TCP IMAP variants.
void net;
