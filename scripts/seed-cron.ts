// Seed all cron jobs from CRON_ROSTER into the database.
// Idempotent — uses upsert by key.
// Run: cd /home/z/my-project && bunx tsx scripts/seed-cron.ts

import { db } from '../src/lib/db';
import { CRON_ROSTER } from '../src/lib/config';

/**
 * Extra cron jobs that ship with newer task additions but may not yet be
 * present in `CRON_ROSTER` (config.ts). Each row here is upserted after
 * the main roster sweep so the dispatcher can find it.
 *
 * Task ID 10 (PARALLEL-E): `agent-monitors` — every 10 min sweep.
 * Task ID 12 (PARALLEL-D): `model-sync` — every 6h model provider sync.
 */
export const EXTRA_CRON_ROSTER: Array<{
  key: string;
  name: string;
  schedule: string;
  description: string;
  enabled: boolean;
}> = [
  {
    key: 'agent-monitors',
    name: 'Agent Monitors Sweep',
    schedule: '*/10 * * * *',
    description: 'Run all monitor agents + persist findings.',
    enabled: true,
  },
  {
    key: 'model-sync',
    name: 'Model Provider Sync',
    schedule: '0 */6 * * *',
    description: 'Sync models from all configured providers + local Ollama; purge broken.',
    enabled: true,
  },
  {
    key: 'ceo-sweep',
    name: 'CEO Tab Sweep',
    schedule: '*/30 * * * *', // every 30 min
    description: 'CEO agent monitors all tabs, generates tasks for empty/stale ones, finds opportunities.',
    enabled: true,
  },
  {
    key: 'idle-agent-check',
    name: 'Idle Agent Check',
    schedule: '*/5 * * * *', // every 5 min
    description: 'Check for idle agents and assign them pending tasks. Rule 23: no idle agents.',
    enabled: true,
  },
  {
    key: 'tool-scan',
    name: 'Tool Inventory Scan',
    schedule: '0 */6 * * *', // every 6 hours
    description: 'Scan host for installed tools/software, update inventory in memory. Rule 30.',
    enabled: true,
  },
  {
    key: 'approval-escalation-check',
    name: 'Approval Escalation Check',
    schedule: '*/5 * * * *', // every 5 minutes
    description:
      'Sweep pending ApprovalRequests whose nextEscalateAt has elapsed. ' +
      'Advances through 3 escalation levels (Telegram → Telegram+Email → +Voice call). ' +
      'Auto-expires rows past their hard timeout.',
    enabled: true,
  },
];

async function main() {
  console.log(`Seeding ${CRON_ROSTER.length} cron jobs...`);
  let created = 0;
  let updated = 0;

  for (const seed of CRON_ROSTER) {
    const existing = await db.cronJob.findUnique({ where: { key: seed.key } });
    if (existing) {
      await db.cronJob.update({
        where: { key: seed.key },
        data: {
          name: seed.name,
          schedule: seed.schedule,
          description: seed.description,
        },
      });
      updated++;
    } else {
      await db.cronJob.create({
        data: {
          key: seed.key,
          name: seed.name,
          schedule: seed.schedule,
          description: seed.description,
          enabled: seed.enabled,
        },
      });
      created++;
      console.log(`  + ${seed.key} (${seed.schedule})`);
    }
  }

  // Ensure extra cron jobs (added by later task IDs) are present in the DB.
  for (const seed of EXTRA_CRON_ROSTER) {
    const existing = await db.cronJob.findUnique({ where: { key: seed.key } });
    if (existing) {
      await db.cronJob.update({
        where: { key: seed.key },
        data: {
          name: seed.name,
          schedule: seed.schedule,
          description: seed.description,
        },
      });
      updated++;
    } else {
      await db.cronJob.create({
        data: {
          key: seed.key,
          name: seed.name,
          schedule: seed.schedule,
          description: seed.description,
          enabled: seed.enabled,
        },
      });
      created++;
      console.log(`  + ${seed.key} (${seed.schedule}) [extra]`);
    }
  }

  const total = await db.cronJob.count();
  console.log(`\nDone: ${created} created, ${updated} updated. Total in DB: ${total}`);
}

/**
 * Public entry point — callable from the in-app Demo Data panel
 * (`/api/admin/data` POST `script: 'cron'`). Idempotent — safe to re-run.
 */
export async function seedCronJobs() {
  await main();
}

if (require.main === module) {
  main()
    .catch((err) => {
      console.error('Seed failed:', err);
      process.exit(1);
    })
    .finally(async () => {
      await db.$disconnect();
    });
}

// Add multi-agent-discuss cron job
const discussSeed = {
  key: 'multi-agent-discuss',
  name: 'Multi-Agent Discussion',
  schedule: '0 */4 * * *', // every 4 hours
  description: 'C-Suite agents discuss tab health, propose actions, reach consensus, create tasks.',
  enabled: true,
};

async function addDiscussCron() {
  const existing = await db.cronJob.findUnique({ where: { key: discussSeed.key } });
  if (existing) {
    await db.cronJob.update({ where: { key: discussSeed.key }, data: discussSeed });
    console.log(`  ~ ${discussSeed.key} (${discussSeed.schedule}) [updated]`);
  } else {
    await db.cronJob.create({ data: discussSeed });
    console.log(`  + ${discussSeed.key} (${discussSeed.schedule}) [new]`);
  }
}

addDiscussCron().then(() => console.log('Done.')).catch(console.error);
