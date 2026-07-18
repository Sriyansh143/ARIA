// =====================================================================
// freeswitch-bridge.ts — FreeSWITCH ESL (Event Socket Library) integration.
// =====================================================================
// Speaks ESL directly over a raw TCP socket (port 8021 default) using
// Node's `net` module — no npm dependency required.
//
// Required env vars:
//   FREESWITCH_ESL_HOST, FREESWITCH_ESL_PASSWORD  (to enable)
//   FREESWITCH_ESL_PORT       (default 8021)
//   FREESWITCH_SIP_GATEWAY    (default 'local-pstn')
//   FREESWITCH_FROM_NUMBER     (caller id)
//   VOICE_PROVIDER             (auto | freeswitch | twilio)
//
// Public API:
//   makeCall, hangupCall, playAudio, sendDtmf, getStatus
// =====================================================================

import net from 'net';

const ESL_DEFAULT_HOST = '127.0.0.1';
const ESL_DEFAULT_PORT = 8021;
const ESL_DEFAULT_PASSWORD = 'ClueCon';

export function isFreeSWITCHConfigured(): boolean {
  return !!(process.env.FREESWITCH_ESL_HOST && process.env.FREESWITCH_ESL_PASSWORD);
}

export type VoiceProvider = 'freeswitch' | 'twilio' | 'auto';

export function getVoiceProvider(): VoiceProvider {
  const v = (process.env.VOICE_PROVIDER || 'auto').toLowerCase().trim();
  if (v === 'freeswitch' || v === 'twilio' || v === 'auto') return v;
  return 'auto';
}

interface EslResponse {
  ok: boolean;
  reply?: string;
  body?: string;
  error?: string;
}

// ─── Low-level ESL send + receive ────────────────────────────────────
async function sendEslApi(
  command: string,
  opts: { timeoutMs?: number } = {},
): Promise<EslResponse> {
  const host = process.env.FREESWITCH_ESL_HOST || ESL_DEFAULT_HOST;
  const port = Number(process.env.FREESWITCH_ESL_PORT || ESL_DEFAULT_PORT);
  const password = process.env.FREESWITCH_ESL_PASSWORD || ESL_DEFAULT_PASSWORD;
  const timeoutMs = opts.timeoutMs ?? 20_000;

  return new Promise<EslResponse>((resolve) => {
    const socket = new net.Socket();
    let buffer = '';
    let phase: 'auth_wait' | 'auth_sent' | 'cmd_sent' = 'auth_wait';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { socket.destroy(); } catch {}
      resolve({ ok: false, error: 'ESL timeout — FreeSWITCH did not respond in time' });
    }, timeoutMs);

    const finish = (res: EslResponse) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { socket.destroy(); } catch {}
      resolve(res);
    };

    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');

      if (phase === 'auth_wait') {
        if (buffer.includes('Content-Type: auth/request')) {
          try {
            socket.write(`auth ${password}\n\n`);
          } catch (err: any) {
            finish({ ok: false, error: `ESL auth write failed: ${err?.message}` });
            return;
          }
          phase = 'auth_sent';
          buffer = '';
        }
        return;
      }

      if (phase === 'auth_sent') {
        if (buffer.includes('Content-Type: command/reply')) {
          if (buffer.includes('+OK')) {
            try {
              socket.write(`${command}\n\n`);
            } catch (err: any) {
              finish({ ok: false, error: `ESL command write failed: ${err?.message}` });
              return;
            }
            phase = 'cmd_sent';
            buffer = '';
          } else if (buffer.includes('-ERR')) {
            const m = buffer.match(/Reply-Text:\s*(-ERR[^\r\n]*)/i);
            finish({ ok: false, error: `ESL auth failed: ${m ? m[1] : buffer.slice(0, 200)}` });
            return;
          }
        }
        return;
      }

      if (phase === 'cmd_sent') {
        let headerEnd = buffer.indexOf('\r\n\r\n');
        let sepLen = 4;
        if (headerEnd < 0) {
          headerEnd = buffer.indexOf('\n\n');
          sepLen = 2;
        }
        if (headerEnd < 0) return;

        const header = buffer.slice(0, headerEnd);
        const body = buffer.slice(headerEnd + sepLen);

        const ctMatch = header.match(/Content-Type:\s*([^\r\n]+)/i);
        const contentType = ctMatch ? ctMatch[1].trim().toLowerCase() : '';
        const clMatch = header.match(/Content-Length:\s*(\d+)/i);
        const expectedLen = clMatch ? parseInt(clMatch[1], 10) : 0;

        if (contentType === 'api/response') {
          if (expectedLen === 0) {
            finish({ ok: true, reply: '', body: '' });
            return;
          }
          if (body.length < expectedLen) return;
          const payload = body.slice(0, expectedLen);
          const trimmed = payload.trim();
          if (/^-ERR\b/.test(trimmed)) {
            finish({ ok: false, error: trimmed, body: payload });
          } else if (/^\+OK\b/.test(trimmed)) {
            finish({ ok: true, reply: trimmed.replace(/^\+OK\s*/, ''), body: payload });
          } else {
            finish({ ok: true, reply: trimmed, body: payload });
          }
          return;
        }

        if (contentType === 'command/reply') {
          const replyMatch = header.match(/Reply-Text:\s*([^\r\n]+)/i);
          const replyText = replyMatch ? replyMatch[1].trim() : body.trim();
          if (/^\+OK\b/.test(replyText)) {
            finish({ ok: true, reply: replyText.replace(/^\+OK\s*/, ''), body });
          } else if (/^-ERR\b/.test(replyText)) {
            finish({ ok: false, error: replyText, body });
          } else {
            finish({ ok: true, reply: replyText, body });
          }
          return;
        }

        finish({ ok: true, reply: body.trim(), body });
      }
    });

    socket.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ECONNREFUSED') {
        finish({ ok: false, error: `ESL connection refused — FreeSWITCH not running on ${host}:${port}? (${err.message})` });
      } else if (err.code === 'ECONNRESET') {
        finish({ ok: false, error: `ESL connection reset — FreeSWITCH may have rejected the auth (wrong password?).` });
      } else {
        finish({ ok: false, error: `ESL socket error: ${err.message}` });
      }
    });

    socket.on('close', () => {
      if (!settled) finish({ ok: false, error: 'ESL connection closed unexpectedly' });
    });

    try {
      socket.connect(port, host, () => {
        console.debug('freeswitch: ESL socket connected', { host, port });
      });
    } catch (err: any) {
      finish({ ok: false, error: `ESL connect failed: ${err?.message}` });
    }
  });
}

// ─── Sanitize phone numbers ──────────────────────────────────────────
function sanitizePhoneNumber(input: string): string {
  if (!input) return '';
  let s = String(input).trim();
  const hasPlus = s.startsWith('+');
  s = s.replace(/[^0-9]/g, '');
  if (!s) return '';
  return hasPlus ? '+' + s : s;
}

function sanitizeUuid(uuid: string): string {
  const clean = String(uuid || '').replace(/[^a-fA-F0-9\-]/g, '');
  if (!clean || clean.length < 8) return '';
  return clean;
}

// ─── makeCall — originate an outbound call via the configured SIP gateway ─
export async function makeCall(opts: {
  to: string;
  from?: string;
  gateway?: string;
}): Promise<{ ok: boolean; callUuid?: string; error?: string }> {
  if (!isFreeSWITCHConfigured()) {
    return {
      ok: false,
      error: 'FreeSWITCH not configured. Set FREESWITCH_ESL_HOST + FREESWITCH_ESL_PASSWORD.',
    };
  }
  const to = sanitizePhoneNumber(opts.to);
  if (!to) {
    return { ok: false, error: 'Invalid destination number (must be E.164: +[country code][number])' };
  }
  const gateway = (opts.gateway || process.env.FREESWITCH_SIP_GATEWAY || 'local-pstn').replace(/[^A-Za-z0-9_\-]/g, '');
  if (!gateway) {
    return { ok: false, error: 'No SIP gateway configured (FREESWITCH_SIP_GATEWAY)' };
  }
  const fromRaw = opts.from || process.env.FREESWITCH_FROM_NUMBER || '';
  const from = sanitizePhoneNumber(fromRaw);
  const varBlock = from ? `{origination_caller_id_number=${from}}` : '';
  const dialString = `sofia/gateway/${gateway}/${to}`;
  const fullOriginate = `${varBlock}${dialString} &park()`;
  const cmd = `api originate ${fullOriginate}`;
  console.info('freeswitch: originating call', { to, from, gateway });
  const result = await sendEslApi(cmd, { timeoutMs: 45_000 });
  if (!result.ok) {
    return { ok: false, error: result.error || 'FreeSWITCH originate failed' };
  }
  const callUuid = (result.reply || '').trim().split(/\s+/)[0];
  if (!callUuid || callUuid.length < 8) {
    return {
      ok: false,
      error: `FreeSWITCH originate returned no usable UUID (reply: "${(result.reply || '').slice(0, 200)}")`,
    };
  }
  console.info('freeswitch: call originated', { to, callUuid });
  return { ok: true, callUuid };
}

// ─── hangupCall — terminate a channel by UUID ─────────────────────────
export async function hangupCall(uuid: string): Promise<{ ok: boolean; error?: string }> {
  if (!isFreeSWITCHConfigured()) return { ok: false, error: 'FreeSWITCH not configured' };
  const cleanUuid = sanitizeUuid(uuid);
  if (!cleanUuid) return { ok: false, error: 'invalid uuid format' };
  const result = await sendEslApi(`api uuid_kill ${cleanUuid}`, { timeoutMs: 10_000 });
  if (!result.ok) {
    const err = (result.error || '').toLowerCase();
    if (err.includes('no such channel') || err.includes('not found')) {
      return { ok: true };
    }
    return { ok: false, error: result.error || 'FreeSWITCH hangup failed' };
  }
  return { ok: true };
}

// ─── playAudio — broadcast an audio file to a channel ─────────────────
export async function playAudio(
  uuid: string,
  audioPath: string,
  opts?: { leg?: 'aleg' | 'bleg' | 'both' },
): Promise<{ ok: boolean; error?: string }> {
  if (!isFreeSWITCHConfigured()) return { ok: false, error: 'FreeSWITCH not configured' };
  const cleanUuid = sanitizeUuid(uuid);
  if (!cleanUuid) return { ok: false, error: 'invalid uuid format' };
  // Sanitize the file path — only allow alnum, dash, underscore, slash, dot.
  const cleanPath = String(audioPath || '').replace(/[^A-Za-z0-9_\-\/.]/g, '');
  if (!cleanPath) return { ok: false, error: 'invalid audio path' };
  const leg = opts?.leg || 'both';
  const cmd = `api uuid_broadcast ${cleanUuid} play::${cleanPath} ${leg}`;
  const result = await sendEslApi(cmd, { timeoutMs: 10_000 });
  if (!result.ok) return { ok: false, error: result.error || 'FreeSWITCH playAudio failed' };
  return { ok: true };
}

// ─── sendDtmf — send DTMF digits to a channel ─────────────────────────
export async function sendDtmf(
  uuid: string,
  digits: string,
  opts?: { durationMs?: number },
): Promise<{ ok: boolean; error?: string }> {
  if (!isFreeSWITCHConfigured()) return { ok: false, error: 'FreeSWITCH not configured' };
  const cleanUuid = sanitizeUuid(uuid);
  if (!cleanUuid) return { ok: false, error: 'invalid uuid format' };
  // DTMF digits: 0-9, *, #, A-D only.
  const cleanDigits = String(digits || '').replace(/[^0-9*#A-Da-d]/g, '').toUpperCase();
  if (!cleanDigits) return { ok: false, error: 'invalid DTMF digits' };
  const duration = opts?.durationMs ?? 500;
  const cmd = `api uuid_send_dtmf ${cleanUuid} ${cleanDigits}@${duration}`;
  const result = await sendEslApi(cmd, { timeoutMs: 10_000 });
  if (!result.ok) return { ok: false, error: result.error || 'FreeSWITCH sendDtmf failed' };
  return { ok: true };
}

// ─── getStatus — return raw channel dump for diagnostics ──────────────
export async function getStatus(uuid: string): Promise<{ ok: boolean; status?: string; error?: string }> {
  if (!isFreeSWITCHConfigured()) return { ok: false, error: 'FreeSWITCH not configured' };
  const cleanUuid = sanitizeUuid(uuid);
  if (!cleanUuid) return { ok: false, error: 'uuid required' };
  const result = await sendEslApi(`api uuid_dump ${cleanUuid}`, { timeoutMs: 10_000 });
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, status: (result.body || '').slice(0, 500) };
}

// ─── Back-compat aliases ──────────────────────────────────────────────
export const makeOutboundCallViaFreeSWITCH = makeCall;
export const hangupCallViaFreeSWITCH = hangupCall;
export const getChannelStatusViaFreeSWITCH = getStatus;
