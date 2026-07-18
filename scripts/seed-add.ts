// Add seed data for the new features: agent comms messages + historical payments
// (varied over the last 14 days) so the revenue trend chart has data.
import { db } from '../src/lib/db';
import { AGENT_ROSTER } from '../src/lib/config';

async function main() {
  console.log('Seeding comms + payment history…');

  // --- Agent comms messages ---
  const codenames = AGENT_ROSTER.map((a) => a.codename);
  const commsSeeds: Array<{ fromAgent: string; toAgent: string; subject: string; body: string; priority: string; thread: string; agoMin: number }> = [
    { fromAgent: 'ORION', toAgent: 'ATLAS', subject: 'Refactor agent-loop.ts', body: 'ATLAS, please refactor agent-loop.ts — it is 800 LOC and hard to follow. Target −30% LOC.', priority: 'high', thread: 'engineering', agoMin: 180 },
    { fromAgent: 'ATLAS', toAgent: 'ORION', subject: 'RE: Refactor agent-loop.ts', body: 'On it. Estimated 2h. Will checkpoint before the dispatch rewrite.', priority: 'normal', thread: 'engineering', agoMin: 160 },
    { fromAgent: 'VEGA', toAgent: 'SAGE', subject: 'Memory: new research findings', body: 'Persisted 4 new episodic memories from the Q3 research pass. Please index them.', priority: 'normal', thread: 'research', agoMin: 120 },
    { fromAgent: 'SAGE', toAgent: 'VEGA', subject: 'RE: Memory: new research findings', body: 'Indexed and deduplicated. 2 merged with existing semantic nodes.', priority: 'normal', thread: 'research', agoMin: 110 },
    { fromAgent: 'ORION', toAgent: 'BROADCAST', subject: 'Fleet standup @ 09:00', body: 'All agents: sync at 09:00 IST. Bring your top blocker.', priority: 'urgent', thread: 'standup', agoMin: 90 },
    { fromAgent: 'PULSE', toAgent: 'ORION', subject: 'CPU spike on ATLAS', body: 'ATLAS hit 82% load for 3 min during the refactor. Self-heal throttled background jobs. Nominal now.', priority: 'high', thread: 'ops', agoMin: 60 },
    { fromAgent: 'NOVA', toAgent: 'ORION', subject: 'Revenue forecast ready', body: 'Q3 revenue forecast model trained. RMSE 4.2%. Dashboard chart incoming.', priority: 'normal', thread: 'analytics', agoMin: 45 },
    { fromAgent: 'ECHO', toAgent: 'ORION', subject: 'Outreach batch #42 sent', body: '12 personalized outreach emails sent. Awaiting replies.', priority: 'normal', thread: 'sales', agoMin: 30 },
    { fromAgent: 'FORGE', toAgent: 'ORION', subject: 'Build #1284 green', body: 'CI passed. Deploying to staging. Rollback snapshot saved.', priority: 'normal', thread: 'ops', agoMin: 20 },
    { fromAgent: 'ORION', toAgent: 'NOVA', subject: 'Ship the forecast chart', body: 'Go ahead and publish the revenue forecast to the dashboard. Flag it as experimental.', priority: 'high', thread: 'analytics', agoMin: 10 },
  ];
  let commsAdded = 0;
  for (const c of commsSeeds) {
    if (!codenames.includes(c.fromAgent)) continue;
    const exists = await db.agentMessage.findFirst({ where: { fromAgent: c.fromAgent, subject: c.subject } });
    if (exists) continue;
    await db.agentMessage.create({
      data: {
        fromAgent: c.fromAgent,
        toAgent: c.toAgent,
        subject: c.subject,
        body: c.body,
        priority: c.priority,
        thread: c.thread,
        read: c.agoMin < 30 ? false : true,
        createdAt: new Date(Date.now() - c.agoMin * 60 * 1000),
      },
    });
    commsAdded++;
  }
  console.log(`  comms messages added: ${commsAdded}`);

  // --- Historical payments (last 14 days, varied methods/amounts) ---
  const methods = ['upi', 'card', 'netbanking', 'qr', 'wallet'];
  const payers = ['acme-corp', 'startup-io', 'walk-in', 'globex', 'initech', 'umbrella', 'stark-industries', 'wayne-enterprises'];
  const notes = ['Enterprise tier — monthly', 'Pro tier — annual', 'Starter — monthly', 'Add-on: priority support', 'Add-on: extra agents', 'Referral bonus', 'Upgrade fee', 'Setup fee'];
  let payAdded = 0;
  // Check if we already have multi-day payment history; if so, skip.
  const existing = await db.payment.findMany({ select: { createdAt: true }, take: 50 });
  const existingDays = new Set(existing.map((p) => p.createdAt.toISOString().slice(0, 10)));
  if (existingDays.size >= 5) {
    console.log(`  payments already span ${existingDays.size} days — skipping history seed`);
  } else {
    for (let d = 13; d >= 0; d--) {
      // 0-3 payments per day, weighted toward 1-2.
      const n = Math.floor(Math.random() * 3) + (d % 3 === 0 ? 1 : 0);
      for (let i = 0; i < n; i++) {
        const method = methods[Math.floor(Math.random() * methods.length)];
        const amount = [299, 999, 1499, 2999, 4999, 9999][Math.floor(Math.random() * 6)];
        const status = Math.random() > 0.15 ? 'confirmed' : 'pending';
        await db.payment.create({
          data: {
            method,
            amount,
            status,
            payer: payers[Math.floor(Math.random() * payers.length)],
            note: notes[Math.floor(Math.random() * notes.length)],
            createdAt: new Date(Date.now() - d * 24 * 60 * 60 * 1000 - Math.random() * 6 * 60 * 60 * 1000),
          },
        });
        payAdded++;
      }
    }
    console.log(`  historical payments added: ${payAdded}`);
  }

  console.log('Seed-add complete.');
}

/**
 * Public entry point — callable from the in-app Demo Data panel
 * (`/api/admin/data` POST `script: 'comms-payments'`). Seeds 10 agent
 * comms messages + 14 days of historical payments. Idempotent — existing
 * comms (matched by fromAgent+subject) are skipped; payments are seeded
 * only if the existing set spans fewer than 5 days.
 */
export async function seedCommsAndPayments() {
  await main();
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(async () => {
      await db.$disconnect();
    });
}
