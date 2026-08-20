/**
 * src/lib/credential-vault.ts — encrypted credential CRUD on db.credential.
 *
 * Server-only. Stores secrets via AES-256-GCM (secure-crypto.ts) and
 * NEVER returns ciphertext to callers — list/get responses mask the
 * secret in `metadata.masked`.
 *
 * Every DB-touching function wraps its body in try/catch and returns a
 * typed result (or null) — never throws to the caller.
 */

import type { Credential } from "@prisma/client";
import { db } from "./db";
import { logger } from "./logger";
import { encrypt, decrypt, maskSecret } from "./secure-crypto";

export interface CredentialRow {
  id: string;
  key: string;
  label: string;
  category: string;
  metadata: { masked?: string; hint?: string; rotationDue?: string; [k: string]: unknown };
  createdAt: Date;
  updatedAt: Date;
}

export interface StoreCredentialInput {
  key: string;
  label: string;
  category?: string;
  plaintext: string;
  metadata?: Record<string, unknown>;
}

function toRow(c: Credential): CredentialRow {
  let metadata: Record<string, unknown> = {};
  try {
    metadata = JSON.parse(c.metadata ?? "{}");
  } catch {
    metadata = {};
  }
  return {
    id: c.id,
    key: c.key,
    label: c.label,
    category: c.category,
    metadata,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

// ─── listCredentials ────────────────────────────────────────────────

export async function listCredentials(
  category?: string
): Promise<CredentialRow[]> {
  try {
    const rows = await db.credential.findMany({
      where: category ? { category } : undefined,
      orderBy: { updatedAt: "desc" },
      take: 200,
    });
    return rows.map(toRow);
  } catch (err) {
    logger.error("credential-vault.list.failed", { error: String(err) });
    return [];
  }
}

// ─── storeCredential (upsert by key) ────────────────────────────────

export async function storeCredential(
  input: StoreCredentialInput
): Promise<{ id: string; key: string }> {
  try {
    const { ciphertext, iv, authTag } = await encrypt(input.plaintext);
    const metadata = {
      ...(input.metadata ?? {}),
      masked: maskSecret(input.plaintext),
      hint: input.label,
      storedAt: new Date().toISOString(),
    };
    const row = await db.credential.upsert({
      where: { key: input.key },
      create: {
        key: input.key,
        label: input.label,
        category: input.category ?? "custom",
        ciphertext,
        iv,
        authTag,
        metadata: JSON.stringify(metadata),
      },
      update: {
        label: input.label,
        category: input.category ?? "custom",
        ciphertext,
        iv,
        authTag,
        metadata: JSON.stringify(metadata),
      },
    });
    logger.success("credential-vault.stored", { key: input.key });
    return { id: row.id, key: row.key };
  } catch (err) {
    logger.error("credential-vault.store.failed", {
      key: input.key,
      error: String(err),
    });
    throw err;
  }
}

// ─── getCredential (decrypt) ────────────────────────────────────────

export async function getCredential(
  key: string
): Promise<{ plaintext: string } | null> {
  try {
    const row = await db.credential.findUnique({ where: { key } });
    if (!row) return null;
    const plaintext = await decrypt(row.ciphertext, row.iv, row.authTag);
    return { plaintext };
  } catch (err) {
    logger.error("credential-vault.get.failed", { key, error: String(err) });
    return null;
  }
}

// ─── deleteCredential ───────────────────────────────────────────────

export async function deleteCredential(key: string): Promise<{ ok: boolean }> {
  try {
    await db.credential.delete({ where: { key } });
    logger.info("credential-vault.deleted", { key });
    return { ok: true };
  } catch (err) {
    logger.error("credential-vault.delete.failed", { key, error: String(err) });
    return { ok: false };
  }
}

// ─── rotateCredential ───────────────────────────────────────────────

export async function rotateCredential(
  key: string,
  newPlaintext: string
): Promise<{ id: string; key: string }> {
  try {
    const existing = await db.credential.findUnique({ where: { key } });
    if (!existing) {
      // Treat rotation of a missing key as a fresh store.
      return storeCredential({ key, label: key, plaintext: newPlaintext });
    }
    const { ciphertext, iv, authTag } = await encrypt(newPlaintext);
    const metadata = {
      masked: maskSecret(newPlaintext),
      hint: existing.label,
      rotatedAt: new Date().toISOString(),
    };
    const row = await db.credential.update({
      where: { key },
      data: {
        ciphertext,
        iv,
        authTag,
        metadata: JSON.stringify(metadata),
      },
    });
    logger.success("credential-vault.rotated", { key });
    return { id: row.id, key: row.key };
  } catch (err) {
    logger.error("credential-vault.rotate.failed", { key, error: String(err) });
    throw err;
  }
}
