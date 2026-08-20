/**
 * tests/secure-crypto.test.ts — Unit tests for AES-256-GCM encryption.
 *
 * Tests encrypt/decrypt round-trip, sha512, and pbkdf2Hash.
 */
import { describe, test, expect } from "bun:test";

describe("Secure Crypto", () => {
  test("encrypt + decrypt round-trips a plaintext string", async () => {
    const { encrypt, decrypt } = await import("../src/lib/secure-crypto");
    const plaintext = "sk-test-api-key-12345";
    const encrypted = await encrypt(plaintext);
    expect(encrypted.ciphertext).not.toBe(plaintext);
    expect(encrypted.iv).toBeTruthy();
    expect(encrypted.authTag).toBeTruthy();
    const decrypted = await decrypt(encrypted.ciphertext, encrypted.iv, encrypted.authTag);
    expect(decrypted).toBe(plaintext);
  });

  test("encrypt produces different ciphertexts for same plaintext (random IV)", async () => {
    const { encrypt } = await import("../src/lib/secure-crypto");
    const plaintext = "same-secret";
    const e1 = await encrypt(plaintext);
    const e2 = await encrypt(plaintext);
    expect(e1.ciphertext).not.toBe(e2.ciphertext);
    expect(e1.iv).not.toBe(e2.iv);
  });

  test("decrypt fails with wrong auth tag", async () => {
    const { encrypt, decrypt } = await import("../src/lib/secure-crypto");
    const plaintext = "secret-data";
    const encrypted = await encrypt(plaintext);
    // Tamper with the auth tag
    const badTag = encrypted.authTag === "a".repeat(32) ? "b".repeat(32) : "a".repeat(32);
    await expect(decrypt(encrypted.ciphertext, encrypted.iv, badTag)).rejects.toThrow();
  });

  test("sha512 produces a 128-char hex string", async () => {
    const { sha512 } = await import("../src/lib/secure-crypto");
    const hash = sha512("test-input");
    expect(hash).toHaveLength(128);
    expect(hash).toMatch(/^[0-9a-f]+$/);
  });

  test("sha512 is deterministic (same input → same hash)", async () => {
    const { sha512 } = await import("../src/lib/secure-crypto");
    const h1 = sha512("consistent");
    const h2 = sha512("consistent");
    expect(h1).toBe(h2);
  });

  test("sha512 produces different hashes for different inputs", async () => {
    const { sha512 } = await import("../src/lib/secure-crypto");
    expect(sha512("input-a")).not.toBe(sha512("input-b"));
  });

  test("pbkdf2Hash produces a hex string", async () => {
    const { pbkdf2Hash } = await import("../src/lib/secure-crypto");
    const hash = pbkdf2Hash("password123", "salt-value");
    expect(hash).toMatch(/^[0-9a-f]+$/);
    expect(hash.length).toBeGreaterThan(0);
  });

  test("pbkdf2Hash is deterministic with same salt", async () => {
    const { pbkdf2Hash } = await import("../src/lib/secure-crypto");
    const h1 = pbkdf2Hash("password", "fixed-salt");
    const h2 = pbkdf2Hash("password", "fixed-salt");
    expect(h1).toBe(h2);
  });
});
