import { describe, test, expect } from "bun:test"
import {
  generateSecret,
  generateTOTP,
  verifyTOTP,
  generateQRCodeURI,
  generateBackupCodes,
  hashBackupCodes,
  verifyBackupCode,
} from "../src/lib/two-factor"

describe("2FA TOTP + Backup Codes", () => {
  test("generateSecret returns a 32-char base32 string", () => {
    const secret = generateSecret()
    expect(secret).toBeTruthy()
    expect(secret.length).toBe(32)
    // Base32 alphabet only
    expect(secret).toMatch(/^[A-Z2-7]+$/)
  })

  test("generateTOTP produces a 6-digit code", () => {
    const secret = generateSecret()
    const code = generateTOTP(secret)
    expect(code).toMatch(/^\d{6}$/)
  })

  test("verifyTOTP accepts the current code", () => {
    const secret = generateSecret()
    const code = generateTOTP(secret)
    expect(verifyTOTP(secret, code)).toBe(true)
  })

  test("verifyTOTP rejects an invalid code", () => {
    const secret = generateSecret()
    expect(verifyTOTP(secret, "000000")).toBe(false)
  })

  test("verifyTOTP rejects malformed tokens", () => {
    const secret = generateSecret()
    expect(verifyTOTP(secret, "")).toBe(false)
    expect(verifyTOTP(secret, "abc")).toBe(false)
    expect(verifyTOTP(secret, "12345")).toBe(false) // 5 digits
    expect(verifyTOTP(secret, "1234567")).toBe(false) // 7 digits
  })

  test("generateQRCodeURI produces a valid otpauth:// URI", () => {
    const secret = generateSecret()
    const uri = generateQRCodeURI(secret, "test@example.com")
    expect(uri).toContain("otpauth://totp/")
    expect(uri).toContain(`secret=${secret}`)
    expect(uri).toContain("issuer=ARIA")
    expect(uri).toContain("digits=6")
    expect(uri).toContain("period=30")
  })

  test("generateBackupCodes returns 5 unique 8-char codes", () => {
    const codes = generateBackupCodes(5)
    expect(codes.length).toBe(5)
    for (const code of codes) {
      expect(code.length).toBe(8)
      expect(code).toMatch(/^[A-Z2-9]+$/) // no 0/O/1/I
    }
    // All unique
    expect(new Set(codes).size).toBe(5)
  })

  test("hashBackupCodes + verifyBackupCode round-trip", async () => {
    const codes = generateBackupCodes(5)
    const hashed = await hashBackupCodes(codes)

    expect(hashed.length).toBe(5)
    // Hashed codes should be different from plaintext
    expect(hashed).not.toContain(codes[0])

    // Verify the first code
    const matchIdx = await verifyBackupCode(codes[0], hashed)
    expect(matchIdx).toBe(0)

    // Verify the third code
    const matchIdx3 = await verifyBackupCode(codes[2], hashed)
    expect(matchIdx3).toBe(2)

    // Invalid code returns -1
    const invalidIdx = await verifyBackupCode("INVALID1", hashed)
    expect(invalidIdx).toBe(-1)
  })

  test("backup codes are one-time (used code should not match again after removal)", async () => {
    const codes = generateBackupCodes(3)
    const hashed = await hashBackupCodes(codes)

    // Use the first code
    const idx = await verifyBackupCode(codes[0], hashed)
    expect(idx).toBe(0)

    // Remove it (simulating real usage)
    hashed.splice(idx, 1)

    // The same code should no longer match
    const idx2 = await verifyBackupCode(codes[0], hashed)
    expect(idx2).toBe(-1)

    // But other codes still work
    const idx3 = await verifyBackupCode(codes[1], hashed)
    expect(idx3).toBe(0) // now at index 0 after removal
  })

  test("generateBackupCodes excludes ambiguous digits (0 and 1)", () => {
    const codes = generateBackupCodes(20)
    for (const code of codes) {
      // Alphabet is ABCDEFGHIJKLMNOPQRSTUVWXYZ23456789 — excludes 0 and 1 (digits)
      expect(code).toMatch(/^[A-Z2-9]+$/)
      expect(code).not.toContain("0")
      expect(code).not.toContain("1")
    }
  })

  test("hashBackupCodes produces unique hashes (no collisions)", async () => {
    const codes = generateBackupCodes(5)
    const hashed = await hashBackupCodes(codes)
    expect(new Set(hashed).size).toBe(5) // all 5 hashes are unique
  })

  test("verifyBackupCode returns -1 for an empty hash list", async () => {
    const idx = await verifyBackupCode("ANYSODE", [])
    expect(idx).toBe(-1)
  })

  test("verifyTOTP rejects a null/undefined token", () => {
    const secret = generateSecret()
    expect(verifyTOTP(secret, null as unknown as string)).toBe(false)
    expect(verifyTOTP(secret, undefined as unknown as string)).toBe(false)
  })

  test("generateQRCodeURI URL-encodes the email local-part", () => {
    const secret = generateSecret()
    const uri = generateQRCodeURI(secret, "alice.bob@example.com")
    // The `@` in the email label must be percent-encoded as %40
    expect(uri).toContain("alice.bob%40example.com")
  })
})
