// credential-vault.ts — AES-256-GCM encryption for platform credentials.
//
// The encryption key is read from `CREDENTIAL_ENCRYPTION_KEY` (64-char hex
// string → 32 raw bytes). If the env var is missing we fall back to a stable
// dev key and emit a one-time console warning. Never use the dev key in
// production.

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGO = 'aes-256-gcm';
const IV_BYTES = 12; // GCM standard nonce length
const KEY_BYTES = 32; // 256-bit

let keyCache: Buffer | null = null;
let devWarned = false;

// 32-byte dev fallback key. Generated once and stable across the process.
// DO NOT rely on this in production — set CREDENTIAL_ENCRYPTION_KEY instead.
const DEV_KEY = Buffer.from(
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  'hex',
);

function getKey(): Buffer {
  if (keyCache) return keyCache;
  const envKey = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (envKey && envKey.length === KEY_BYTES * 2 && /^[0-9a-fA-F]+$/.test(envKey)) {
    keyCache = Buffer.from(envKey, 'hex');
    return keyCache;
  }
  if (!devWarned) {
    devWarned = true;
    console.warn(
      '[credential-vault] CREDENTIAL_ENCRYPTION_KEY not set or invalid — using dev fallback key. Set a 64-char hex string in production.',
    );
  }
  keyCache = DEV_KEY;
  return keyCache;
}

export interface EncryptedPayload {
  encrypted: string; // base64 ciphertext
  iv: string; // base64 nonce
  tag: string; // base64 auth tag
}

export function encryptPassword(plain: string): EncryptedPayload {
  if (typeof plain !== 'string') {
    throw new Error('encryptPassword: expected string');
  }
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, getKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    encrypted: enc.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
  };
}

export function decryptPassword(encrypted: string, iv: string, tag: string): string {
  if (!encrypted || !iv || !tag) {
    throw new Error('decryptPassword: missing encrypted/iv/tag');
  }
  const decipher = createDecipheriv(ALGO, getKey(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  const dec = Buffer.concat([
    decipher.update(Buffer.from(encrypted, 'base64')),
    decipher.final(),
  ]);
  return dec.toString('utf8');
}

/** Convenience: re-encrypt a fresh plaintext and return a storable record. */
export function encryptCredentialRecord(plain: string): EncryptedPayload {
  return encryptPassword(plain);
}

/** Returns true if the env key is set (i.e. we're not using the dev fallback). */
export function isUsingProductionKey(): boolean {
  const envKey = process.env.CREDENTIAL_ENCRYPTION_KEY;
  return !!envKey && envKey.length === KEY_BYTES * 2 && /^[0-9a-fA-F]+$/.test(envKey);
}

/** Mask a plaintext password for display — show first/last char only. */
export function maskPassword(plain: string): string {
  if (!plain) return '••••••';
  if (plain.length <= 2) return '••';
  return `${plain.charAt(0)}${'•'.repeat(Math.min(8, plain.length - 2))}${plain.charAt(plain.length - 1)}`;
}
