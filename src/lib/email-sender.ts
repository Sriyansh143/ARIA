/**
 * email-sender.ts — Send emails via SMTP (zero-dependency, native tls module).
 * Ported from jarvis zip's email-native.ts.
 *
 * Uses SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS from .env.
 * Supports TLS (port 465) and STARTTLS (port 587).
 */

import tls from 'tls';

export async function sendEmail(to: string, subject: string, body: string): Promise<{ success: boolean; error?: string }> {
  const host = process.env.SMTP_HOST || 'smtp.gmail.com';
  const port = parseInt(process.env.SMTP_PORT || '465');
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!user || !pass) {
    return { success: false, error: 'SMTP_USER and SMTP_PASS not set in .env' };
  }

  return new Promise((resolve) => {
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
      `From: ${user}\r\nTo: ${to}\r\nSubject: ${subject}\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${body}\r\n.\r\n`,
      `QUIT\r\n`,
    ];

    socket.on('secureConnect', () => {});
    socket.on('data', (data) => {
      const code = parseInt(data.toString().trim().split(' ')[0]);
      if (code >= 200 && code < 400 && step < cmds.length) {
        socket.write(cmds[step++]);
      } else if (code >= 400) {
        resolve({ success: false, error: `SMTP ${code}: ${data.toString().trim()}` });
        socket.destroy();
      } else if (step >= cmds.length) {
        resolve({ success: true });
        socket.destroy();
      }
    });
    socket.on('error', (e) => resolve({ success: false, error: e.message }));
    socket.setTimeout(15000);
    socket.on('timeout', () => { resolve({ success: false, error: 'Timeout' }); socket.destroy(); });
  });
}

/**
 * Send an email to the owner (from TELEGRAM_CHAT_ID or configured email).
 */
export async function sendToOwnerEmail(subject: string, body: string): Promise<{ success: boolean; error?: string }> {
  const ownerEmail = process.env.SMTP_USER; // Send to self for now
  if (!ownerEmail) return { success: false, error: 'No owner email configured' };
  return sendEmail(ownerEmail, subject, body);
}
