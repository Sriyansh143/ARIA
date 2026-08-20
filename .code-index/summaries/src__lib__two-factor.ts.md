# src/lib/two-factor.ts

**Category:** general

**Purpose:** src/lib/two-factor.ts — TOTP (Time-based One-Time Password) (server-only).

**Line count:** 296

**Core logic patterns:** error-handling, cryptography

**Key functions:** hashBackupCodes, verifyBackupCode, generateSecret, generateTOTP, verifyTOTP, generateQRCodeURI, generateBackupCodes

**Dependencies:** node:crypto, ./logger, @/lib/two-factor, bcryptjs

**Last modified:** 2026-08-17T03:11:39.000Z

**Indexed at:** 2026-08-19T09:41:49.263Z
