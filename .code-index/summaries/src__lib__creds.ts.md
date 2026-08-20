# src/lib/creds.ts

**Category:** general

**Purpose:** ARIA Mission Control — Credential management (env + JSON file fallback).

**Line count:** 220

**Core logic patterns:** error-handling, cryptography, stripe-integration, telegram-integration, ollama-llm, env-config

**Key functions:** credsFilePath, maskSecret, getCredential, setCredential, deleteCredential, listCredentials

**Dependencies:** node:fs, node:os, node:path

**Last modified:** 2026-08-17T03:11:39.000Z

**Indexed at:** 2026-08-19T09:41:49.321Z
