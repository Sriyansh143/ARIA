/**
 * src/lib/two-factor.ts — TOTP (Time-based One-Time Password) (server-only).
 *
 * RFC 6238 TOTP implementation built on Node's `crypto` module — no
 * external dependencies. Compatible with Google Authenticator, Authy,
 * 1Password, etc. (any standard `otpauth://` consumer).
 *
 * Design:
 *   - Secrets are 20 random bytes → base32-encoded (32 chars). This is
 *     the canonical TOTP secret length recommended by RFC 4226 §4.
 *   - HMAC-SHA1 over a 30-second time step, truncated to 6 digits.
 *   - `verifyTOTP` accepts `window` steps before/after the current
 *     time to tolerate 30s of clock drift between client + server
 *     (default window=1 → ±30s).
 *   - `generateQRCodeURI` emits an `otpauth://totp/...` URI that QR
 *     code generators (e.g. `qrcode` npm pkg) can render directly.
 *   - Every public function is wrapped in try/catch so a malformed
 *     secret never crashes the calling API route — instead the
 *     function returns a safe default (`""` / `false`).
 *
 * Task ID: HARDEN-OBSERVE-DEVOPS-SEC (Task 3).
 */
import "server-only";

import crypto from "node:crypto";
import { logger } from "./logger";

// ─── Base32 (RFC 4648) ───────────────────────────────────────────────

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/**
 * Encode a Buffer to a base32 string (RFC 4648, no padding).
 * Used to serialize TOTP secrets for storage in the Setting table.
 */
function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return out;
}

/**
 * Decode a base32 string back to a Buffer. Lowercase + whitespace are
 * tolerated; unknown chars are skipped (defensive — the stored secret
 * is always upper-case canonical, but authenticator apps occasionally
 * lowercase the user-typed value).
 */
function base32Decode(input: string): Buffer {
  const cleaned = input.replace(/\s+/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const ch of cleaned) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx === -1) continue; // skip stray chars
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

// ─── TOTP core (RFC 6238 / RFC 4226) ─────────────────────────────────

const STEP_SECONDS = 30;
const DIGITS = 6;

/**
 * Compute the TOTP code for a given secret + timestamp.
 *
 * - `secret`: base32-encoded secret (from `generateSecret()`).
 * - `timestamp`: epoch-ms (default: `Date.now()`).
 * - Returns the 6-digit code as a zero-padded string.
 *
 * Throws if the secret cannot be decoded; callers should wrap in
 * try/catch (the API routes do).
 */
function computeTOTP(secret: string, timestamp: number): string {
  const key = base32Decode(secret);
  if (key.length === 0) {
    throw new Error("totp.invalid-secret: decoded to empty buffer");
  }
  // Time counter: floor(ts / 30s). RFC 6238 uses a 64-bit counter —
  // Node's Buffer.writeBigUInt64BE handles that cleanly.
  const counter = Math.floor(timestamp / 1000 / STEP_SECONDS);
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(counter));

  const hmac = crypto.createHmac("sha1", key).update(counterBuf).digest();
  // Dynamic truncation (RFC 4226 §5.3): take the low 4 bits of the
  // last byte as the offset, then extract a 31-bit int from that
  // offset.
  const offset = hmac[hmac.length - 1] & 0x0f;
  const truncated =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  const code = truncated % 10 ** DIGITS;
  return code.toString().padStart(DIGITS, "0");
}

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Generate a fresh TOTP secret: 20 random bytes, base32-encoded.
 * Returns a 32-char upper-case string compatible with any
 * authenticator app.
 */
export function generateSecret(): string {
  try {
    const bytes = crypto.randomBytes(20);
    return base32Encode(bytes);
  } catch (err) {
    logger.error("totp.generateSecret.failed", { error: String(err) });
    // Never throw — return an empty string so the caller can detect
    // failure without a try/catch.
    return "";
  }
}

/**
 * Compute the current TOTP code for a secret.
 *
 * - `secret`: base32-encoded secret.
 * - `timestamp`: epoch-ms (default: now).
 * - Returns the 6-digit code, or `""` on decode failure.
 */
export function generateTOTP(secret: string, timestamp: number = Date.now()): string {
  try {
    return computeTOTP(secret, timestamp);
  } catch (err) {
    logger.error("totp.generateTOTP.failed", { error: String(err) });
    return "";
  }
}

/**
 * Verify a TOTP token against a secret, allowing `window` steps
 * before/after the current time step to tolerate clock drift.
 *
 * - `secret`: base32-encoded secret.
 * - `token`: the 6-digit code typed by the user.
 * - `window`: number of steps (±) to accept (default 1 → ±30s).
 * - Returns `true` if any time step in the window matches.
 *
 * Constant-time comparison is used so a timing attacker can't infer
 * how close a guess was.
 */
export function verifyTOTP(secret: string, token: string, window: number = 1): boolean {
  try {
    if (!secret || !token) return false;
    const sanitized = String(token).replace(/\s+/g, "");
    if (!/^\d{6}$/.test(sanitized)) return false;

    const now = Date.now();
    const safeWindow = Math.max(0, Math.min(window, 10));
    for (let offset = -safeWindow; offset <= safeWindow; offset++) {
      const ts = now + offset * STEP_SECONDS * 1000;
      const expected = computeTOTP(secret, ts);
      if (expected.length === 0) continue;
      // crypto.timingSafeEqual requires equal-length buffers.
      if (
        expected.length === sanitized.length &&
        crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sanitized))
      ) {
        return true;
      }
    }
    return false;
  } catch (err) {
    logger.error("totp.verifyTOTP.failed", { error: String(err) });
    return false;
  }
}

/**
 * Build an `otpauth://` URI for QR code generation.
 *
 * Format (RFC 6238 §6):
 *   otpauth://totp/<issuer>:<email>?secret=<secret>&issuer=<issuer>&algorithm=SHA1&digits=6&period=30
 *
 * The `<email>` is URL-encoded; `<issuer>` is used both in the path
 * and as the `issuer` query param so authenticator apps display it
 * consistently.
 */
export function generateQRCodeURI(
  secret: string,
  email: string,
  issuer: string = "ARIA"
): string {
  try {
    const safeIssuer = encodeURIComponent(issuer);
    const safeEmail = encodeURIComponent(email);
    const safeSecret = encodeURIComponent(secret);
    const label = `${safeIssuer}:${safeEmail}`;
    return (
      `otpauth://totp/${label}` +
      `?secret=${safeSecret}` +
      `&issuer=${safeIssuer}` +
      `&algorithm=SHA1` +
      `&digits=${DIGITS}` +
      `&period=${STEP_SECONDS}`
    );
  } catch (err) {
    logger.error("totp.generateQRCodeURI.failed", { error: String(err) });
    return "";
  }
}

// ─── Types ───────────────────────────────────────────────────────────

export interface TwoFactorSetup {
  /** Base32-encoded TOTP secret (store on User.twoFactorSecret). */
  secret: string;
  /** `otpauth://` URI for QR code generation. */
  qrUri: string;
  /** 5 one-time backup codes (plaintext — only shown ONCE at setup). */
  backupCodes: string[];
}

// ─── Backup codes (v40 enhancement) ─────────────────────────────────

/**
 * Generate 5 one-time backup codes (8-char alphanumeric).
 * The caller must hash these before storing (see hashBackupCodes).
 */
export function generateBackupCodes(count: number = 5): string[] {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ23456789"; // no confusing 0/O/1/I
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    let code = "";
    for (let j = 0; j < 8; j++) {
      code += chars[crypto.randomInt(0, chars.length)];
    }
    codes.push(code);
  }
  return codes;
}

/**
 * Hash backup codes for storage (bcrypt with low cost — these are one-time
 * and short, so rounds=10 is sufficient).
 */
export async function hashBackupCodes(codes: string[]): Promise<string[]> {
  const bcrypt = await import("bcryptjs");
  return Promise.all(codes.map((c) => bcrypt.hash(c, 10)));
}

/**
 * Verify a backup code against the stored hashed codes.
 * Returns the index of the matched code (so the caller can remove it),
 * or -1 if no match.
 */
export async function verifyBackupCode(
  plaintext: string,
  hashedCodes: string[],
): Promise<number> {
  const bcrypt = await import("bcryptjs");
  for (let i = 0; i < hashedCodes.length; i++) {
    if (await bcrypt.compare(plaintext, hashedCodes[i])) {
      return i;
    }
  }
  return -1;
}

/** Aggregate default export — handy for `import twofa from "@/lib/two-factor"`. */
const twoFactor = {
  generateSecret,
  generateTOTP,
  verifyTOTP,
  generateQRCodeURI,
  generateBackupCodes,
  hashBackupCodes,
  verifyBackupCode,
};

export default twoFactor;
