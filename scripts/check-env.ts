/**
 * scripts/check-env.ts — Startup Environment Validator (v41)
 *
 * Verifies that the critical env vars are set before the server boots.
 * If any are missing, prints a clear warning with instructions.
 *
 * Usage:
 *   bun run check-env          # run manually
 *   (deploy.sh calls this automatically)
 *
 * Exit codes:
 *   0 = all critical vars set (or running in dev with defaults)
 *   1 = critical vars missing
 */

// ─── Critical vars (must be set in production) ─────────────────────
const CRITICAL = [
  {
    name: "DATABASE_URL",
    why: "Required — Prisma needs a database connection string.",
    example: "file:./db/custom.db  (SQLite) or postgresql://user:pass@host/db",
    devDefault: "file:./db/custom.db",
  },
  {
    name: "NEXTAUTH_SECRET",
    why: "Required — signs JWT sessions. Without it, auth doesn't work.",
    example: "Run: openssl rand -base64 32",
    devDefault: null, // no safe default
  },
  {
    name: "ARIA_OWNER_EMAIL",
    why: "Required — bootstraps the first owner account so you don't get locked out.",
    example: "owner@yourcompany.com",
    devDefault: null,
  },
]

// ─── Recommended vars (warn if missing, don't fail) ────────────────
const RECOMMENDED = [
  {
    name: "RESEND_API_KEY",
    why: "Customer delivery + refund notifications need this. Without it, notifications fall back to NotificationLog only (not emailed).",
    example: "Get a free key at https://resend.com (3,000 emails/month free)",
    fixUrl: "https://resend.com/api-keys",
  },
  {
    name: "CRYPTO_WALLET_ADDRESS",
    why: "Required to accept crypto payments. Without it, the /services checkout returns 503.",
    example: "bc1q... (BTC) or 0x... (ETH)",
    fixUrl: null,
  },
  {
    name: "OLLAMA_HOST",
    why: "The $0 local LLM. Without it, the app relies on cloud providers (which may not be configured).",
    example: "http://127.0.0.1:11434",
    fixUrl: "https://ollama.com/download",
  },
  {
    name: "ENCRYPTION_MASTER_KEY",
    why: "Required for the Credential Vault (AES-256-GCM). Without it, falls back to an insecure dev key.",
    example: "Run: openssl rand -hex 32",
    fixUrl: null,
  },
]

// ─── Check ─────────────────────────────────────────────────────────

const isProduction = process.env.NODE_ENV === "production"
const isDev = !isProduction

let hasCriticalError = false

console.log("")
console.log("═══════════════════════════════════════════════════════════════")
console.log("  ARIA Mission Control v41 — Environment Check")
console.log(`  Mode: ${isProduction ? "PRODUCTION" : "development"}`)
console.log("═══════════════════════════════════════════════════════════════")
console.log("")

// Check critical vars
console.log("── Critical Variables ──────────────────────────────────────────")
for (const v of CRITICAL) {
  const value = process.env[v.name]
  const hasValue = Boolean(value)

  if (hasValue && value) {
    const masked = value.length > 8 ? value.slice(0, 4) + "••••" + value.slice(-4) : "••••"
    console.log(`  ✓ ${v.name.padEnd(25)} = ${masked}`)
  } else if (isDev && v.devDefault) {
    console.log(`  ⚠ ${v.name.padEnd(25)} not set — using dev default: ${v.devDefault}`)
  } else {
    console.log(`  ✗ ${v.name.padEnd(25)} MISSING`)
    console.log(`      Why: ${v.why}`)
    console.log(`      Example: ${v.example}`)
    hasCriticalError = true
  }
}
console.log("")

// Check recommended vars
console.log("── Recommended Variables ───────────────────────────────────────")
for (const v of RECOMMENDED) {
  const value = process.env[v.name]
  if (value) {
    const masked = value.length > 8 ? value.slice(0, 4) + "••••" + value.slice(-4) : "••••"
    console.log(`  ✓ ${v.name.padEnd(25)} = ${masked}`)
  } else {
    console.log(`  ⚠ ${v.name.padEnd(25)} not set`)
    console.log(`      Why: ${v.why}`)
    if (v.example) console.log(`      Example: ${v.example}`)
    if (v.fixUrl) console.log(`      Get it: ${v.fixUrl}`)
  }
}
console.log("")

// ─── Result ────────────────────────────────────────────────────────
if (hasCriticalError) {
  console.log("═══════════════════════════════════════════════════════════════")
  console.log("  ✗ ENVIRONMENT CHECK FAILED")
  console.log("  Critical variables are missing. Set them in your .env file:")
  console.log("    1. Copy .env.example to .env")
  console.log("    2. Fill in the missing values")
  console.log("    3. Or set them via /dashboard/settings (hot-reload)")
  console.log("  Then re-run: bun run check-env")
  console.log("═══════════════════════════════════════════════════════════════")
  console.log("")
  process.exit(1)
} else {
  const warnings = RECOMMENDED.filter((v) => !process.env[v.name]).length
  if (warnings > 0) {
    console.log("═══════════════════════════════════════════════════════════════")
    console.log(`  ✓ ENVIRONMENT CHECK PASSED (with ${warnings} warning${warnings > 1 ? "s" : ""})`)
    console.log("  Critical vars are set. Recommended vars can be configured later.")
    console.log("═══════════════════════════════════════════════════════════════")
  } else {
    console.log("═══════════════════════════════════════════════════════════════")
    console.log("  ✓ ENVIRONMENT CHECK PASSED — all variables configured")
    console.log("═══════════════════════════════════════════════════════════════")
  }
  console.log("")
  process.exit(0)
}
