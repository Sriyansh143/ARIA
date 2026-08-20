/**
 * src/lib/db-schema-ensure.ts — v58 Auto-apply Prisma schema on first run.
 *
 * Extracted from db.ts into its own module so that:
 *   1. db.ts stays free of `fs`/`child_process` imports — these would
 *      break Turbopack when db.ts is bundled into client components
 *      (via the connector-marketplace import chain).
 *   2. This module is server-only + only imported from instrumentation-node.ts.
 *
 * When the SQLite DB file doesn't exist (fresh clone), the first DB
 * query would fail with "no such table: X". This function runs
 * `prisma db push` synchronously before the server starts accepting
 * requests, so the schema is always applied.
 *
 * For PostgreSQL, this is a no-op — the operator must run migrations
 * manually (or use a managed Postgres service with auto-migration).
 *
 * Safe to call multiple times — checks if the schema is already applied.
 */

import "server-only";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { getDatabaseProvider } from "./db";

let schemaCheckDone = false;

export async function ensureSchemaApplied(): Promise<void> {
  if (schemaCheckDone) return;
  schemaCheckDone = true;

  if (getDatabaseProvider() !== "sqlite") return; // Postgres: operator manages migrations

  const url = process.env.DATABASE_URL ?? "";
  const match = url.match(/^file:(.+)$/);
  if (!match) return;

  const dbPath = match[1].replace(/^\.\//, "");
  const absolutePath = path.isAbsolute(dbPath) ? dbPath : path.join(/*turbopackIgnore: true*/ process.cwd(), dbPath);

  // If DB file exists + has tables, schema is already applied
  if (fs.existsSync(/*turbopackIgnore: true*/ absolutePath) && fs.statSync(absolutePath).size > 1024) {
    return;
  }

  // DB file missing or empty — run prisma db push
  console.log(`[db] SQLite database file missing at ${absolutePath}, applying schema via prisma db push...`);
  try {
    execSync("npx prisma db push --skip-generate --accept-data-loss", {
      stdio: "pipe",
      cwd: process.cwd(),
      env: process.env,
      timeout: 60_000,
    });
    console.log("[db] Schema applied successfully");
  } catch (err) {
    console.error("[db] Failed to auto-apply schema:", err);
    console.error("[db] Run manually: bun run db:bootstrap");
    // Don't throw — let the first DB query fail with a clear error
  }
}
