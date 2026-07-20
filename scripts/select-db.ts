// scripts/select-db.ts — Auto-switch Prisma datasource between SQLite and PostgreSQL
// based on DATABASE_URL. Run before `prisma generate` / `prisma db push`.
//
// If DATABASE_URL starts with "postgres://" or "postgresql://":
//   → sets provider = "postgresql" in schema.prisma
// Otherwise:
//   → sets provider = "sqlite" (default, no setup needed)
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

const schemaPath = join(process.cwd(), 'prisma', 'schema.prisma')
const dbUrl = process.env.DATABASE_URL || ''
const isPostgres = dbUrl.startsWith('postgres://') || dbUrl.startsWith('postgresql://')
const provider = isPostgres ? 'postgresql' : 'sqlite'

let schema = readFileSync(schemaPath, 'utf8')
schema = schema.replace(
  /datasource db \{\s*provider = "(sqlite|postgresql)"\s*url\s*=\s*env\("DATABASE_URL"\)\s*\}/,
  `datasource db {\n  provider = "${provider}"\n  url      = env("DATABASE_URL")\n}`
)
writeFileSync(schemaPath, schema)
console.log(`[select-db] DATABASE_URL=${dbUrl.slice(0, 30)}... → provider=${provider}`)
