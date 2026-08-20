# src/lib/upi-payments.ts

**Category:** integration

**Purpose:** src/lib/upi-payments.ts — UPI/QR Payment Integration (v44)

**Line count:** 485

**Core logic patterns:** network-fetch, database-access, timeout-handling, error-handling, event-emission, cryptography, env-config

**Key functions:** getUpiSettings, saveUpiSettings, createUpiOrder, claimUpiPayment, approveUpiOrder, rejectUpiOrder, getPendingUpiVerifications

**Dependencies:** ./db, ./logger, ./event-bus, ./services/catalog, ./email-service, ./services/crypto-checkout

**Last modified:** 2026-08-17T04:54:53.000Z

**Indexed at:** 2026-08-19T09:41:49.262Z
