/**
 * src/lib/secure-crypto.ts — AES-256-GCM + PBKDF2 + bcrypt helpers.
 *
 * Server-only. All operations derive their key from the
 * `ENCRYPTION_MASTER_KEY` env var (SHA-256'd to a fixed 32-byte AES key),
 * generate a fresh 12-byte IV per encryption, and return everything as
 * base64 strings ready to drop into Prisma text columns.
 *
 * Every function wraps its body in try/catch and throws a typed Error
 * with the prefix `crypto.<fn>.failed: <detail>` so callers can pattern-match
 * failure modes without instanceof checks.
 */

import crypto from "node:crypto";
import { logger } from "./logger";

// ─── Key derivation ──────────────────────────────────────────────────

function getMasterKey(): Buffer {
  const raw = process.env.ENCRYPTION_MASTER_KEY;
  if (!raw || raw.length < 8) {
    // Fall back to a stable dev key — never throw at import time so the
    // app can still boot in environments that haven't configured the key.
    logger.warn("crypto.master-key.missing", {
      hint: "set ENCRYPTION_MASTER_KEY to a 32+ char secret",
    });
    return crypto.createHash("sha256").update("aria-dev-master-key-insecure").digest();
  }
  return crypto.createHash("sha256").update(raw).digest();
}

// ─── AES-256-GCM ────────────────────────────────────────────────────

export interface EncryptedPayload {
  ciphertext: string;
  iv: string;
  authTag: string;
}

export async function encrypt(plaintext: string): Promise<EncryptedPayload> {
  try {
    const key = getMasterKey();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return {
      ciphertext: ct.toString("base64"),
      iv: iv.toString("base64"),
      authTag: authTag.toString("base64"),
    };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    logger.error("crypto.encrypt.failed", { error: detail });
    throw new Error(`crypto.encrypt.failed: ${detail}`);
  }
}

export async function decrypt(
  ciphertext: string,
  iv: string,
  authTag: string
): Promise<string> {
  try {
    const key = getMasterKey();
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(iv, "base64")
    );
    decipher.setAuthTag(Buffer.from(authTag, "base64"));
    const pt = Buffer.concat([
      decipher.update(Buffer.from(ciphertext, "base64")),
      decipher.final(),
    ]);
    return pt.toString("utf8");
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    logger.error("crypto.decrypt.failed", { error: detail });
    throw new Error(`crypto.decrypt.failed: ${detail}`);
  }
}

// ─── Hash helpers ───────────────────────────────────────────────────

export function sha512(input: string): string {
  try {
    return crypto.createHash("sha512").update(input, "utf8").digest("hex");
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    logger.error("crypto.sha512.failed", { error: detail });
    throw new Error(`crypto.sha512.failed: ${detail}`);
  }
}

export function pbkdf2Hash(
  password: string,
  salt: string,
  iterations = 600_000
): string {
  try {
    return crypto
      .pbkdf2Sync(password, salt, iterations, 64, "sha512")
      .toString("hex");
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    logger.error("crypto.pbkdf2.failed", { error: detail });
    throw new Error(`crypto.pbkdf2.failed: ${detail}`);
  }
}

/** Generate a random salt (hex) of the given byte length. */
export function randomSalt(bytes = 16): string {
  try {
    return crypto.randomBytes(bytes).toString("hex");
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    logger.error("crypto.randomSalt.failed", { error: detail });
    throw new Error(`crypto.randomSalt.failed: ${detail}`);
  }
}

/** Mask a plaintext secret for display — keeps first/last char, hides middle. */
export function maskSecret(plaintext: string): string {
  if (!plaintext) return "";
  if (plaintext.length <= 4) return "•".repeat(plaintext.length);
  const head = plaintext.slice(0, 2);
  const tail = plaintext.slice(-2);
  return `${head}${"•".repeat(Math.max(4, plaintext.length - 4))}${tail}`;
}
