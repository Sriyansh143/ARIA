#!/usr/bin/env tsx
// =====================================================================
// rotate-keys.ts — Rotate the JARVIS_SHARED_KEY used for field encryption.
// =====================================================================
//
// Usage:
//   npm run rotate-keys -- --old-key <OLD> --new-key <NEW>
//   npm run rotate-keys -- --old-key <OLD> --new-key <NEW> --no-backup
//   tsx scripts/rotate-keys.ts --old-key <OLD> --new-key <NEW>
//
// What it does:
//   0. (FIX B1/B4) BACKUP — before touching the DB, dump every Provider row's
//      id + apiKey (still encrypted with the OLD key) to
//      db/key-rotation-backup-<timestamp>.json. This is the safety net: if
//      rotation fails partway through (DB write error, crash, wrong old-key),
//      the operator can restore the backup and retry. The backup file is
//      encrypted-at-rest because the apiKey values are still ciphertext —
//      only someone with the OLD key can decrypt them.
//   1. Reads every Provider.apiKey from the DB.
//   2. Decrypts each with <OLD> (the previous JARVIS_SHARED_KEY).
//   3. Re-encrypts with <NEW> in v2 format (keyVersion byte embedded).
//   4. Writes the new ciphertext back to the DB.
//   5. Prints a summary and exits non-zero if any row failed.
//
// Run order for a safe rotation:
//   1. STOP the JARVIS dashboard + mini-services (so no row is being
//      written while we rotate).
//   2. Set JARVIS_SHARED_KEY=<OLD> in your env (so this script can find
//      the same salt + key derivation as the live system used).
//   3. Run: npm run rotate-keys -- --old-key <OLD> --new-key <NEW>
//      → A backup file is written to db/key-rotation-backup-<ts>.json.
//        KEEP THIS FILE SAFE. If rotation fails, restore from it.
//   4. Update .env: JARVIS_SHARED_KEY=<NEW>, JARVIS_KEY_VERSION=<N+1>
//   5. Restart JARVIS. Every decryptField() call now uses <NEW> and
//      successfully reads the v2 ciphertexts left by this script.
//
// The --no-backup flag skips step 0 (for testing / dry-run). DO NOT use
// --no-backup on a production rotation — if the rotation fails partway,
// you lose the ability to recover the original ciphertexts.
//
// Exit codes:
//   0 = all Provider.apiKey fields rotated (or none needed rotation)
//   1 = missing args, fatal error, backup failure, or one+ rows failed
// =====================================================================

import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { reEncryptAll } from '../src/lib/crypto-field'

interface ParsedArgs {
  oldKey: string | undefined
  newKey: string | undefined
  noBackup: boolean
}

function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = { oldKey: undefined, newKey: undefined, noBackup: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--old-key') {
      out.oldKey = argv[++i]
    } else if (a === '--new-key') {
      out.newKey = argv[++i]
    } else if (a.startsWith('--old-key=')) {
      out.oldKey = a.slice('--old-key='.length)
    } else if (a.startsWith('--new-key=')) {
      out.newKey = a.slice('--new-key='.length)
    } else if (a === '--no-backup') {
      out.noBackup = true
    } else if (a === '-h' || a === '--help') {
      printUsage()
      process.exit(0)
    }
  }
  return out
}

function printUsage(): void {
  // eslint-disable-next-line no-console
  console.log(
    [
      'Usage: npm run rotate-keys -- --old-key <OLD> --new-key <NEW> [--no-backup]',
      '',
      'Rotates the AES-256-GCM key used to encrypt Provider.apiKey fields.',
      'After running, update your .env: JARVIS_SHARED_KEY=<NEW> and bump',
      'JARVIS_KEY_VERSION (e.g. from 1 to 2).',
      '',
      'A backup of the current (OLD-key-encrypted) apiKey values is written to',
      'db/key-rotation-backup-<timestamp>.json BEFORE rotation begins. Keep',
      'this file safe — it is your recovery path if rotation fails partway.',
      '',
      'Options:',
      '  --old-key <key>   The previous JARVIS_SHARED_KEY (used to decrypt).',
      '  --new-key <key>   The new JARVIS_SHARED_KEY (used to re-encrypt as v2).',
      '  --no-backup       Skip the pre-rotation backup (testing only — DO NOT',
      '                    use in production).',
      '  -h, --help        Show this help.',
    ].join('\n'),
  )
}

// FIX (audit 2026-07-07 / B1/B4): Pre-rotation backup. Dumps every Provider
// row's id + current (OLD-key-encrypted) apiKey to a JSON file so the
// operator can restore if rotation fails partway. The backup is encrypted
// at rest because the apiKey values are still ciphertext — only someone
// with the OLD key can decrypt them.
async function writeBackup(): Promise<string> {
  const { db } = await import('../src/lib/db')
  const providers = await db.provider.findMany({
    select: { id: true, name: true, apiKey: true },
  })
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupDir = join(process.cwd(), 'db')
  if (!existsSync(backupDir)) mkdirSync(backupDir, { recursive: true })
  const backupPath = join(backupDir, `key-rotation-backup-${timestamp}.json`)
  const payload = {
    backupCreatedAt: new Date().toISOString(),
    note: 'Pre-rotation backup of Provider.apiKey (still encrypted with the OLD key). ' +
      'Restore by writing each row\'s apiKey back to the DB if rotation fails.',
    providerCount: providers.length,
    providers: providers.map((p) => ({ id: p.id, name: p.name, apiKey: p.apiKey })),
  }
  // mode 0600 — backup contains ciphertexts that the OLD key can decrypt.
  writeFileSync(backupPath, JSON.stringify(payload, null, 2), { mode: 0o600 })
  return backupPath
}

// FIX (FINAL-2 / B3): Interactively prompt the operator with a yes/no
// question on stdin. Returns true if they answer 'y' or 'yes' (case-
// insensitive), false otherwise (including EOF / no answer).
async function promptConfirm(question: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    process.stdout.write(question + ' ')
    let data = ''
    let settled = false
    const finish = (answer: string) => {
      if (settled) return
      settled = true
      process.stdin.pause()
      resolve(answer.trim().toLowerCase() === 'y' || answer.trim().toLowerCase() === 'yes')
    }
    process.stdin.setEncoding('utf8')
    process.stdin.resume()
    process.stdin.on('data', (chunk) => {
      data += chunk
      if (data.includes('\n')) finish(data)
    })
    process.stdin.on('end', () => finish(data))
    // Safety net: if the operator walks away, don't hang forever.
    setTimeout(() => finish(data), 30_000)
  })
}

// FIX (FINAL-2 / B3): Validate key strength BEFORE starting rotation.
// scryptSync derives a 32-byte key from any passphrase, so a 1-char key
// is functionally correct but has ~6 bits of entropy — if an attacker
// steals the DB + salt file they can brute-force it in milliseconds.
// Reject keys shorter than 16 chars with a clear message. Also warn
// (and require interactive confirmation) when old == new — that's a
// no-op re-encryption that signals the operator may be confused about
// what they're doing.
function validateKeyStrength(oldKey: string, newKey: string): void {
  if (oldKey.length < 16 || newKey.length < 16) {
    // eslint-disable-next-line no-console
    console.error(
      `[rotate-keys] ERROR: Keys must be at least 16 characters for security. ` +
        `Got: old-key=${oldKey.length} chars, new-key=${newKey.length} chars.`,
    )
    // eslint-disable-next-line no-console
    console.error(
      '[rotate-keys] Generate a strong key with: openssl rand -base64 32',
    )
    process.exit(1)
  }
}

async function main(): Promise<void> {
  const { oldKey, newKey, noBackup } = parseArgs(process.argv.slice(2))

  if (!oldKey || !newKey) {
    // eslint-disable-next-line no-console
    console.error('[rotate-keys] ERROR: both --old-key and --new-key are required.')
    printUsage()
    process.exit(1)
  }

  // FIX (FINAL-2 / B3): Key-strength validation. Reject keys < 16 chars
  // outright — they have too little entropy to resist an offline brute-
  // force attack if the DB + salt file leak.
  validateKeyStrength(oldKey, newKey)

  // FIX (FINAL-2 / B3): Warn on identical keys — this is a no-op re-
  // encryption (every row decrypts + re-encrypts to the same v2 ciphertext).
  // Most likely the operator copy-pasted the same value twice by mistake.
  // Require interactive confirmation before proceeding.
  if (oldKey === newKey) {
    // eslint-disable-next-line no-console
    console.warn(
      '[rotate-keys] ⚠️ Warning: old-key and new-key are identical — ' +
        'this is a no-op re-encryption (every row decrypts + re-encrypts ' +
        'to the same v2 ciphertext).',
    )
    const confirmed = await promptConfirm('Continue? (y/N)')
    if (!confirmed) {
      // eslint-disable-next-line no-console
      console.log('[rotate-keys] Aborted by operator.')
      process.exit(1)
    }
    // eslint-disable-next-line no-console
    console.log('[rotate-keys] Proceeding with identical keys (operator-confirmed).')
  }

  // eslint-disable-next-line no-console
  console.log('[rotate-keys] starting key rotation...')
  // eslint-disable-next-line no-console
  console.log(
    `[rotate-keys] JARVIS_KEY_VERSION env=${process.env.JARVIS_KEY_VERSION ?? '(unset → default 1)'}`,
  )

  // ── STEP 0: Pre-rotation backup (FIX B1/B4) ──────────────────────────
  // We dump every Provider.apiKey (still encrypted with the OLD key) to a
  // JSON file BEFORE calling reEncryptAll. If rotation fails partway, the
  // operator restores this file and retries. --no-backup skips this for
  // testing (NEVER use --no-backup on a real rotation).
  if (!noBackup) {
    try {
      // eslint-disable-next-line no-console
      console.log('[rotate-keys] Writing pre-rotation backup of Provider.apiKey values...')
      const backupPath = await writeBackup()
      // eslint-disable-next-line no-console
      console.log(`[rotate-keys] ✅ Backup written to: ${backupPath}`)
      // eslint-disable-next-line no-console
      console.log(
        '[rotate-keys]   Keep this file safe — it is your recovery path if rotation fails.',
      )
    } catch (err: any) {
      // eslint-disable-next-line no-console
      console.error(
        '[rotate-keys] FATAL: pre-rotation backup failed:',
        err instanceof Error ? err.stack || err.message : String(err),
      )
      // eslint-disable-next-line no-console
      console.error(
        '[rotate-keys] Refusing to proceed without a backup. Fix the backup error and retry,',
      )
      // eslint-disable-next-line no-console
      console.error(
        '[rotate-keys] or pass --no-backup to skip (NOT recommended for production).',
      )
      process.exit(1)
    }
  } else {
    // eslint-disable-next-line no-console
    console.warn(
      '[rotate-keys] ⚠️ --no-backup specified — skipping pre-rotation backup.',
    )
    // eslint-disable-next-line no-console
    console.warn(
      '[rotate-keys]   If rotation fails partway, you will NOT be able to recover the original ciphertexts.',
    )
  }

  // ── STEP 1+: Re-encrypt every Provider.apiKey with the NEW key ──────
  const result = await reEncryptAll(oldKey, newKey)

  // eslint-disable-next-line no-console
  console.log('[rotate-keys] rotation complete:')
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(result, null, 2))

  if (result.errors.length > 0) {
    // eslint-disable-next-line no-console
    console.error(
      `[rotate-keys] ${result.errors.length} row(s) failed to rotate. ` +
        'Inspect the errors above; rows that failed remain encrypted with the OLD key ' +
        'and will become undecryptable once you swap JARVIS_SHARED_KEY to the new value. ' +
        'RESTORE FROM THE BACKUP FILE and retry.',
    )
    process.exit(1)
  }

  // eslint-disable-next-line no-console
  console.log(
    `[rotate-keys] success: ${result.reEncrypted} field(s) re-encrypted with new key ` +
      `(v2, keyVersion=${result.newKeyVersion}). ` +
      `${result.alreadyV2WithNewKey} already at this version, ${result.skipped} empty.`,
  )
  process.exit(0)
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(
    '[rotate-keys] fatal:',
    err instanceof Error ? err.stack || err.message : String(err),
  )
  process.exit(1)
})
