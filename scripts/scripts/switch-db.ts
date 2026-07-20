#!/usr/bin/env tsx
import { readFileSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
const __dirname = dirname(fileURLToPath(import.meta.url))
const schemaPath = join(__dirname, '..', 'prisma', 'schema.prisma')
const target = process.argv[2]
if (target !== 'sqlite' && target !== 'postgres') { console.error('Usage: bun run scripts/switch-db.ts <sqlite|postgres>'); process.exit(1) }
let schema = readFileSync(schemaPath, 'utf8')
const before = schema
schema = schema.replace(/datasource db \{\s*\n\s*provider = "(sqlite|postgres)"/, `datasource db {\n  provider = "${target}"`)
if (schema === before) { console.error('Could not find datasource provider line.'); process.exit(1) }
writeFileSync(schemaPath, schema)
console.log(`✓ Switched Prisma provider to "${target}"`)
console.log(`  Next: bun run db:generate && bun run db:push`)
