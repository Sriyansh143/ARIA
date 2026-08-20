/**
 * tests/e2e/helpers.ts — Shared E2E test utilities.
 *
 * - TOTP generation (reads secret from DB, computes valid code)
 * - Auth helpers (register, login, logout)
 * - DB cleanup between tests
 */

import { execSync } from "child_process"

const BASE = "http://localhost:3000"

// ─── TOTP helpers ──────────────────────────────────────────────────

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
const STEP = 30

function base32Decode(input: string): Buffer {
  const cleaned = input.replace(/\s+/g, "").toUpperCase()
  let bits = 0, value = 0
  const bytes: number[] = []
  for (const ch of cleaned) {
    const idx = BASE32.indexOf(ch)
    if (idx === -1) continue
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return Buffer.from(bytes)
}

/**
 * Compute a valid TOTP code for the given secret.
 * Mirrors src/lib/two-factor.ts computeTOTP().
 */
export function computeTOTP(secret: string, timestamp: number = Date.now()): string {
  const key = base32Decode(secret)
  const counter = Math.floor(timestamp / 1000 / STEP)
  const buf = Buffer.alloc(8)
  buf.writeBigUInt64BE(BigInt(counter))
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const crypto = require("crypto")
  const hmac = crypto.createHmac("sha1", key).update(buf).digest()
  const offset = hmac[hmac.length - 1] & 0x0f
  const truncated =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff)
  const code = truncated % 1000000
  return String(code).padStart(6, "0")
}

/**
 * Read the 2FA secret for a user directly from the test DB.
 * This is how we "mock" the TOTP — we read the real secret + compute a valid code.
 */
export function get2FASecretFromDB(email: string): string | null {
  try {
    const result = execSync(
      `bun -e "const {PrismaClient}=require('@prisma/client');const db=new PrismaClient();(async()=>{const u=await db.user.findUnique({where:{email:'${email}'}});process.stdout.write(u?.twoFactorSecret||'');await db.\\$disconnect();})()"`,
      { cwd: process.cwd(), encoding: "utf-8", timeout: 10_000 }
    )
    return result || null
  } catch {
    return null
  }
}

// ─── Auth helpers ──────────────────────────────────────────────────

export async function registerUser(
  email: string,
  password: string,
  name?: string
): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`${BASE}/api/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, name }),
  })
  const data = await res.json()
  return { ok: res.ok, error: data.error }
}

/**
 * Login via the NextAuth credentials API.
 * Returns the session cookies.
 */
export async function login(
  request: import("@playwright/test").APIRequestContext,
  email: string,
  password: string,
  totp?: string
): Promise<import("@playwright/test").APIResponse> {
  // Get the CSRF token first
  const csrfRes = await request.get(`${BASE}/api/auth/csrf`)
  const csrf = (await csrfRes.json()).csrfToken

  // Call the callback endpoint
  return request.post(`${BASE}/api/auth/callback/credentials`, {
    form: {
      email,
      password,
      totp: totp || "",
      csrfToken: csrf,
      callbackUrl: "/dashboard",
      json: "true",
    },
  })
}

/**
 * Get a valid TOTP for a user (reads secret from DB + computes current code).
 * Returns empty string if 2FA is not enabled for the user.
 */
export function getValidTOTP(email: string): string {
  const secret = get2FASecretFromDB(email)
  if (!secret) return ""
  return computeTOTP(secret)
}

// ─── DB cleanup ────────────────────────────────────────────────────

/**
 * Clean up test users between test runs.
 * Uses a direct Prisma call via bun -e.
 */
export async function cleanupTestUser(email: string): Promise<void> {
  try {
    execSync(
      `bun -e "const {PrismaClient}=require('@prisma/client');const db=new PrismaClient();(async()=>{await db.user.deleteMany({where:{email:'${email}'}});await db.\\$disconnect();})()"`,
      { cwd: process.cwd(), encoding: "utf-8", timeout: 10_000, stdio: "pipe" }
    )
  } catch {
    // ignore — user may not exist
  }
}

/**
 * Check if the test DB is reachable.
 */
export async function ensureDBReady(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/api/health`)
    const data = await res.json()
    return data.status === "ok"
  } catch {
    return false
  }
}
