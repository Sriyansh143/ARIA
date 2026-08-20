# v60 Patch 1 — Environment Parser Fix

**Date:** 2026-08-17
**Build:** v60.0.0-final-clean + Patch 1
**Severity:** Critical (blocks first-run on Windows)

## Problem

On Windows, the `setup.ps1` script ran `bun run db:bootstrap` (which worked), then `bun run build` (which worked), then started the production server:

```bash
NODE_ENV=production bun .next/standalone/server.js
```

The production server (in `.next/standalone/`) loaded its own `.env` file using the env-loader's `parseEnvFile()` function. The parser had a bug:

**Old parser logic:**
```typescript
if (
  (value.startsWith('"') && value.endsWith('"')) ||
  (value.startsWith("'") && value.endsWith("'"))
) {
  value = value.slice(1, -1);
}
```

For a line like:
```
DATABASE_URL="file:./db/custom.db"      # SQLite dev | postgresql://user:pass@host/db prod
```

After `=`, the value was: `"file:./db/custom.db"      # SQLite dev | postgresql://user:pass@host/db prod`

This value:
- ✅ Starts with `"`
- ❌ Does NOT end with `"` (ends with `prod`)

So the quote-stripping condition failed, and `DATABASE_URL` became:
```
"file:./db/custom.db"      # SQLite dev | postgresql://user:pass@host/db prod
```

(including the leading `"` and the trailing comment). Prisma then rejected this with:
```
Error validating datasource `db`: the URL must start with the protocol `file:`.
```

## Root Cause

The `.env.example` file uses inline comments after quoted values:
```
DATABASE_URL="file:./db/custom.db"      # SQLite dev | postgresql://user:pass@host/db prod
NEXTAUTH_URL="http://localhost:3000"     # public URL for callbacks
```

This is valid in `dotenv` (the standard npm package) but the ARIA env-loader's parser was naive — it only stripped quotes if the value ENDED with a quote, which is broken for any value followed by a comment.

## Fix

### 1. Updated `src/lib/env-loader.ts` → `parseEnvFile()`

New parser logic handles all 4 cases correctly:
- `KEY="value"  # comment` → value (strips quotes + comment)
- `KEY='value'  # comment` → value (strips quotes + comment)
- `KEY=value  # comment` → value (strips comment)
- `KEY="value with #"` → value (preserves `#` inside quotes)

### 2. Updated `src/lib/auto-bootstrap.ts` → `parseEnvFile()` (duplicate parser)

Same fix applied to the auto-bootstrap's parser (which runs first, before env-loader).

### 3. Cleaned `.env.example`

Moved all inline comments to their own line above the key (cleaner + matches dotenv best practices):
```env
# SQLite dev | postgresql://user:pass@host/db prod
DATABASE_URL="file:./db/custom.db"
```

### 4. Silenced Turbopack build warnings

- Added `serverExternalPackages: ["@nut-tree-fork/nut-js", "@sentry/node", "screenshot-desktop", "sharp", "systeminformation"]` to `next.config.ts`
- Changed dynamic imports of optional deps from `import("name")` to `import(/* webpackIgnore: true */ variableName)` to prevent Turbopack from trying to resolve them at build time
- Added `turbopack.root: __dirname` to silence the workspace-root warning
- Added `/*turbopackIgnore: true*/` comments to `fs.existsSync` / `path.join` calls in `db-schema-ensure.ts` and `self-heal.ts`

Result: build went from 5 warnings → 0 warnings.

## Verification

```
✓ Typecheck: 0 errors
✓ Tests: 107/107 pass
✓ Chaos tests: 8/8 pass
✓ Build: succeeds with 0 warnings
✓ Dev server: boots, applies schema, seeds fleet, starts engine
✓ Production server: starts, connects to DB, serves /api/health
```

## How to apply this patch

This patch is included in the v60-final-clean + Patch 1 zip. If you already deployed v60-final-clean, you can either:

1. **Re-deploy** with the new zip (recommended), OR
2. **Manually patch** by replacing these files:
   - `src/lib/env-loader.ts`
   - `src/lib/auto-bootstrap.ts`
   - `src/lib/computer-use.ts`
   - `src/lib/error-tracking.ts`
   - `src/lib/db-schema-ensure.ts`
   - `src/lib/self-heal.ts`
   - `next.config.ts`
   - `.env.example`

   Then run:
   ```bash
   bun run build
   bun .next/standalone/server.js
   ```
