// Seed the JARVIS database with the agent roster, skill catalog, cron jobs,
// a provider, starter memory, and notifications. Idempotent.
import { db } from '../src/lib/db';
import { AGENT_ROSTER, SKILL_CATALOG, CRON_ROSTER, JARVIS } from '../src/lib/config';

async function main() {
  console.log(`Seeding JARVIS Mission Control v${JARVIS.version}…`);

  // Agents
  for (const a of AGENT_ROSTER) {
    await db.agent.upsert({
      where: { codename: a.codename },
      update: {
        role: a.role,
        skills: JSON.stringify(a.skills),
        model: a.model,
        load: a.load,
        successRate: a.successRate,
      },
      create: {
        name: a.name,
        codename: a.codename,
        role: a.role,
        status: a.status,
        skills: JSON.stringify(a.skills),
        model: a.model,
        load: a.load,
        successRate: a.successRate,
      },
    });
  }
  const agentCount = await db.agent.count();
  console.log(`  agents: ${agentCount}`);

  // Seed a few logs per agent
  const agents = await db.agent.findMany();
  const logLevels = ['info', 'success', 'warn', 'debug'] as const;
  const logMsgs: Record<string, string[]> = {
    ORION: ['Dispatched 3 sub-tasks to ATLAS', 'Plan graph rebuilt', 'Dispatch queue drained'],
    VEGA: ['Web search: 12 results for "nextjs 16"', 'Summarized article in 412ms', 'Reading https://example.com'],
    ATLAS: ['Refactored agent-loop.ts (-38 LOC)', 'Code review: 2 issues found', 'Generated API route stub'],
    NOVA: ['Forecast model warmed up', 'Chart rendered: revenue 30d', 'Dataset cleaned: 1.2k rows'],
    ECHO: ['Drafted outreach email #42', 'CRM sync queued', 'Reply tone: professional'],
    SAGE: ['Memory consolidated: 38→12 items', 'Index rebuilt', 'Retrieved 4 episodic memories'],
    FORGE: ['Build #1284 passed', 'Deployed to staging', 'Rollback snapshot saved'],
    PULSE: ['Heartbeat: all agents nominal', 'CPU spike on ATLAS detected', 'Self-heal: restarted worker'],
  };
  for (const agent of agents) {
    const msgs = logMsgs[agent.codename] ?? ['Idle'];
    for (let i = 0; i < msgs.length; i++) {
      await db.agentLog.create({
        data: {
          agentId: agent.id,
          level: logLevels[i % logLevels.length],
          message: msgs[i],
        },
      });
    }
    await db.agent.update({ where: { id: agent.id }, data: { logCount: msgs.length } });
  }

  // Skills
  for (const s of SKILL_CATALOG) {
    await db.skill.upsert({
      where: { key: s.key },
      update: { name: s.name, description: s.description, category: s.category, icon: s.icon },
      create: {
        key: s.key,
        name: s.name,
        description: s.description,
        category: s.category,
        icon: s.icon,
        enabled: s.enabled,
      },
    });
  }
  const skillCount = await db.skill.count();
  console.log(`  skills: ${skillCount}`);

  // Cron jobs
  for (const c of CRON_ROSTER) {
    await db.cronJob.upsert({
      where: { key: c.key },
      update: { name: c.name, schedule: c.schedule, description: c.description },
      create: {
        key: c.key,
        name: c.name,
        schedule: c.schedule,
        description: c.description,
        enabled: c.enabled,
      },
    });
  }
  const cronCount = await db.cronJob.count();
  console.log(`  cron jobs: ${cronCount}`);

  // Provider
  await db.provider.upsert({
    where: { key: 'zai' },
    update: {},
    create: { key: 'zai', name: 'Z.ai', model: 'glm-4.6', enabled: true, latency: 620, tokens: 184320 },
  });

  // Starter memory
  const memSeeds = [
    { scope: 'semantic', key: 'project-jarvis', value: 'JARVIS Mission Control v9 — autonomous agent orchestration dashboard. 8-agent fleet, 20 skills, 6 cron jobs.', tags: ['project', 'jarvis'] },
    { scope: 'episodic', key: 'boot-2026', value: 'System cold-booted successfully. All 8 agents initialized nominal. GLM-4.6 provider online.', tags: ['boot', 'system'] },
    { scope: 'working', key: 'current-focus', value: 'Improve dashboard UX, expand skill catalog, stabilize telemetry polling.', tags: ['focus', 'roadmap'] },
    { scope: 'conversation', key: 'user-pref', value: 'Operator prefers concise bullet-point answers and dark UI.', tags: ['user', 'preference'] },
  ];
  for (const m of memSeeds) {
    await db.memoryItem.upsert({
      where: { key_scope: { key: m.key, scope: m.scope } },
      update: { value: m.value, tags: JSON.stringify(m.tags) },
      create: { scope: m.scope, key: m.key, value: m.value, tags: JSON.stringify(m.tags), pinned: m.scope === 'semantic' },
    });
  }

  // Notifications
  const notifSeeds = [
    { type: 'success', title: 'Fleet Online', message: 'All 8 agents initialized and reporting nominal.' },
    { type: 'info', title: 'GLM-4.6 Connected', message: 'Z.ai provider online. Avg latency 620ms.' },
    { type: 'warn', title: 'ATLAS Load High', message: 'Code engineer at 78% load. Consider rebalancing.' },
  ];
  for (const n of notifSeeds) {
    const exists = await db.notification.findFirst({ where: { title: n.title } });
    if (!exists) await db.notification.create({ data: n });
  }

  // Sample telemetry points (last 24 entries, 5 min apart)
  for (let i = 23; i >= 0; i--) {
    await db.telemetry.create({
      data: {
        cpu: 20 + Math.random() * 50 + (i % 7 === 0 ? 15 : 0),
        mem: 45 + Math.random() * 30,
        disk: 38 + Math.random() * 8,
        net: Math.random() * 40,
        latency: 300 + Math.floor(Math.random() * 600),
        tokens: Math.floor(Math.random() * 2000),
        createdAt: new Date(Date.now() - i * 60_000 * 5),
      },
    });
  }

  // A couple of starter tasks
  const orion = await db.agent.findFirst({ where: { codename: 'ORION' } });
  const atlas = await db.agent.findFirst({ where: { codename: 'ATLAS' } });
  if (orion && atlas) {
    await db.task.create({ data: { title: 'Decompose Q3 roadmap into agent tasks', status: 'in_progress', priority: 'high', assigneeId: orion.id, progress: 40, tags: JSON.stringify(['planning']) } });
    await db.task.create({ data: { title: 'Refactor telemetry polling to 5s interval', status: 'pending', priority: 'medium', assigneeId: atlas.id, tags: JSON.stringify(['code']) } });
    await db.task.create({ data: { title: 'Build memory consolidation cron', status: 'completed', priority: 'low', assigneeId: orion.id, progress: 100, tags: JSON.stringify(['memory']) } });
  }

  // A couple of payments
  await db.payment.create({ data: { method: 'upi', amount: 4999, status: 'confirmed', payer: 'acme-corp', note: 'Enterprise tier — monthly' } });
  await db.payment.create({ data: { method: 'card', amount: 1499, status: 'pending', payer: 'startup-io', note: 'Pro tier — annual' } });
  await db.payment.create({ data: { method: 'qr', amount: 299, status: 'confirmed', payer: 'walk-in', note: 'Starter — monthly' } });

  // Artifacts
  await db.artifact.create({ data: { name: 'agent-loop.ts', type: 'code', size: 36985 } });
  await db.artifact.create({ data: { name: 'fleet-report-q3.pdf', type: 'report', size: 248320 } });
  await db.artifact.create({ data: { name: 'revenue-30d.csv', type: 'dataset', size: 8120 } });

  console.log('Seed complete.');
}

main()
  .then(() => process.exit(0))
  .catch(async (e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  });
