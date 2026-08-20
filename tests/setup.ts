/**
 * tests/setup.ts — Global test setup (preloaded by bunfig.toml).
 *
 * Mocks the `server-only` marker package so server-only lib modules
 * (which `import "server-only"` to prevent accidental Client Component
 * imports) can be unit-tested by bun without throwing.
 *
 * In production, Next.js resolves `server-only` to a module that throws
 * at import time when loaded from a Client Component. In tests we want
 * the opposite: the import should be a no-op so we can exercise the
 * pure logic (TOTP math, span tracking, cache, etc.).
 */
import { mock } from "bun:test";

mock.module("server-only", () => ({}));

export {};
