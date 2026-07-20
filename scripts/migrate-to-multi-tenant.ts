#!/usr/bin/env tsx
/**
 * Migration script: Single-user → Multi-tenant (Phase 24)
 *
 * What it does:
 *   1. Creates a "Personal" default organization (slug: "default")
 *   2. Finds the first/only user (the owner) and makes them ADMIN of the default org
 *   3. If no users exist yet, creates a placeholder org ready for first signup
 *
 * Run: npx tsx scripts/migrate-to-multi-tenant.ts
 * Safe to run multiple times (idempotent).
 */

import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

async function main() {
  console.log('🔄 Starting multi-tenant migration...')

  // ── Step 1: Create default org if it doesn't exist ──────────────────────────
  let defaultOrg = await db.organization.findUnique({ where: { slug: 'default' } })

  if (!defaultOrg) {
    defaultOrg = await db.organization.create({
      data: {
        name: 'Personal',
        slug: 'default',
        description: 'Default organization (migrated from single-user mode)',
      },
    })
    console.log(`✅ Created default org: ${defaultOrg.id}`)
  } else {
    console.log(`ℹ️  Default org already exists: ${defaultOrg.id}`)
  }

  // ── Step 2: Find all users without an org membership ────────────────────────
  const users = await db.user.findMany({
    where: {
      orgMemberships: { none: {} },
    },
    orderBy: { createdAt: 'asc' },
  })

  if (users.length === 0) {
    console.log('ℹ️  All users already have org memberships — nothing to migrate')
  } else {
    console.log(`📋 Found ${users.length} user(s) without org membership`)

    for (let i = 0; i < users.length; i++) {
      const user = users[i]
      const role = i === 0 ? 'ADMIN' : 'OPERATOR' // First user is owner/admin

      await db.orgMembership.upsert({
        where: { orgId_userId: { orgId: defaultOrg.id, userId: user.id } },
        create: {
          orgId: defaultOrg.id,
          userId: user.id,
          role,
        },
        update: {}, // No-op if already exists
      })

      console.log(`  ✅ ${user.email} → ${role} in default org`)
    }
  }

  // ── Step 3: Summary ──────────────────────────────────────────────────────────
  const memberCount = await db.orgMembership.count({ where: { orgId: defaultOrg.id } })
  console.log(`\n✅ Migration complete!`)
  console.log(`   Org: "${defaultOrg.name}" (${defaultOrg.slug})`)
  console.log(`   Members: ${memberCount}`)
  console.log(`\n💡 Next steps:`)
  console.log(`   1. Run: npx prisma db push (to apply schema changes)`)
  console.log(`   2. Restart the app`)
  console.log(`   3. Invite team members via Settings → Organization → Invite`)
}

main()
  .catch((err) => {
    console.error('❌ Migration failed:', err)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
