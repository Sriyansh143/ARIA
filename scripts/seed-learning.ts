// =====================================================================
// seed-learning.ts — CLI wrapper around the `seedLearning()` export.
// =====================================================================
// Seeds 15 SkillLearning records (agent × skill proficiency + earnings)
// into db.skillLearning. Idempotent — uses upsert on (agentCodename,
// skillKey) so re-runs update rather than duplicate.
//
// Run: cd /home/z/my-project && bunx tsx scripts/seed-learning.ts
//
// The actual seed data + logic lives in seed-agents.ts (the
// `seedSkillLearning` function), so we re-export it from there to keep a
// single source of truth. The in-app Demo Data panel imports `seedLearning`
// from seed-agents.ts directly (no subprocess).
// =====================================================================

import { seedLearning } from './seed-agents';

seedLearning()
  .then(() => {
    console.log('✓ seed-learning.ts complete');
    process.exit(0);
  })
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  });
