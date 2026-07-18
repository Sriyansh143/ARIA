// =====================================================================
// /api/admin/data — Demo Data Management API
// =====================================================================
// GET    — returns per-table row counts + the catalog of available seed
//          actions (so the UI can render the panel without hard-coding
//          anything).
// POST   — runs a seed script INLINE (dynamic require, NOT a subprocess).
//          Body: { script: 'all' | 'agents' | 'cron' | 'providers-models'
//                       | 'rules' | 'earning-methods' | 'comms-payments'
//                       | 'learning' }
// DELETE — clears demo data from a scope of tables.
//          Body: { scope: 'all' | 'transactions' | 'logs' | 'comms'
//                      | 'telemetry' | 'notifications' | 'spawned' }
// =====================================================================

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getBlackBoxStats } from '@/lib/blackbox';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// ─── Types ───────────────────────────────────────────────────────────
type Counts = Record<string, number>;

interface SeedScriptMeta {
  key: string;
  label: string;
  description: string;
  tableCount: number;
}

// ─── Catalog of seedable scripts ─────────────────────────────────────
const SEED_SCRIPTS: SeedScriptMeta[] = [
  {
    key: 'all',
    label: 'Seed Everything',
    description: 'Runs every seed script in sequence: agents + cron + providers/models + rules + earning methods + comms/payments + learning.',
    tableCount: 14,
  },
  {
    key: 'agents',
    label: 'Seed Agents',
    description: 'Upserts the 64-agent roster + 16 departments + 25 workforce agents from AGENT_ROSTER.',
    tableCount: 3,
  },
  {
    key: 'cron',
    label: 'Seed Cron Jobs',
    description: 'Upserts all 27 cron jobs from CRON_ROSTER (schedules, names, descriptions).',
    tableCount: 1,
  },
  {
    key: 'providers-models',
    label: 'Seed Providers + Models',
    description: 'Upserts 23 AI providers + 453 models from the catalog (PROVIDER_SEEDS + MODEL_CATALOG).',
    tableCount: 2,
  },
  {
    key: 'rules',
    label: 'Seed Rules',
    description: 'Upserts 33 operator rules across 5 categories (financial, operational, safety, legal, intelligence).',
    tableCount: 1,
  },
  {
    key: 'earning-methods',
    label: 'Seed Earning Methods',
    description: 'Seeds 15 earning methods across 9 categories (freelance, content, saas, consulting, automation, data, creative, support, affiliate).',
    tableCount: 1,
  },
  {
    key: 'comms-payments',
    label: 'Seed Comms + Payment History',
    description: 'Seeds 10 agent-to-agent comms messages + 14 days of varied historical payment records.',
    tableCount: 2,
  },
  {
    key: 'learning',
    label: 'Seed Learning Items',
    description: 'Upserts 15 SkillLearning records (agent × skill proficiency + earnings) for the Learn & Earn tab.',
    tableCount: 1,
  },
];

// ─── Per-table row counts ────────────────────────────────────────────
async function getTableCounts(): Promise<Counts> {
  // Count all demo-able tables in parallel. Each entry is `[apiName, prismaCount]`.
  // `goals` and `blackboxLogs` need special handling — goals are stored as
  // MemoryItem(scope='goal'); blackboxLogs live in-memory in @/lib/blackbox.
  const [
    agents, skills, cronJobs, providers, models, rules, earningMethods,
    payments, comms, memoryItems, notifications, telemetry, tasks, artifacts,
    spawnedAgents, workforceAgents, credentials, learningItems, plugins,
    scheduledAutonomy, autonomyTemplates, pipelines, agentLogs,
    goals,
  ] = await Promise.all([
    db.agent.count(),
    db.skill.count(),
    db.cronJob.count(),
    db.provider.count(),
    db.model.count(),
    db.rule.count(),
    db.earningMethod.count(),
    db.payment.count(),
    db.agentMessage.count(),
    db.memoryItem.count(),
    db.notification.count(),
    db.telemetry.count(),
    db.task.count(),
    db.artifact.count(),
    db.spawnedAgent.count(),
    db.workforceAgent.count(),
    db.platformCredential.count(),
    db.skillLearning.count(),
    db.plugin.count(),
    db.scheduledAutonomy.count(),
    db.autonomyTemplate.count(),
    db.pipeline.count(),
    db.agentLog.count(),
    db.memoryItem.count({ where: { scope: 'goal' } }),
  ]);

  // Blackbox is in-memory only — read its buffer size from the blackbox lib.
  let blackboxLogs = 0;
  try {
    blackboxLogs = getBlackBoxStats().bufferSize;
  } catch {
    blackboxLogs = 0;
  }

  return {
    agents,
    skills,
    cronJobs,
    providers,
    models,
    rules,
    earningMethods,
    payments,
    comms,
    memoryItems,
    notifications,
    telemetry,
    tasks,
    artifacts,
    spawnedAgents,
    workforceAgents,
    credentials,
    learningItems,
    goals,
    plugins,
    blackboxLogs,
    scheduledAutonomy,
    autonomyTemplates,
    pipelines,
    agentLogs,
  };
}

// ─── GET: status + counts + seed script catalog ─────────────────────
export async function GET() {
  try {
    const [counts] = await Promise.all([getTableCounts()]);
    return NextResponse.json({
      counts,
      seedScripts: SEED_SCRIPTS,
      ts: Date.now(),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'failed to read table counts', counts: {}, seedScripts: SEED_SCRIPTS },
      { status: 200 }, // 200 so the UI still renders; the panel shows the error
    );
  }
}

// ─── POST: run a seed script inline ──────────────────────────────────
type SeedScriptKey =
  | 'all' | 'agents' | 'cron' | 'providers-models'
  | 'rules' | 'earning-methods' | 'comms-payments' | 'learning';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const script = String(body.script ?? '') as SeedScriptKey;
  const validKeys: SeedScriptKey[] = [
    'all', 'agents', 'cron', 'providers-models',
    'rules', 'earning-methods', 'comms-payments', 'learning',
  ];
  if (!validKeys.includes(script)) {
    return NextResponse.json(
      { ok: false, error: `invalid script key: "${script}". Valid: ${validKeys.join(', ')}` },
      { status: 400 },
    );
  }

  const t0 = Date.now();
  try {
    // Dynamic-import each seed module via literal `await import('...')`
    // calls so Turbopack can statically resolve + transpile each module.
    // Variable-path imports are not supported by Turbopack's server-side
    // bundler, so we spell each branch out.
    //
    // Path resolution (from src/app/api/admin/data/route.ts):
    //   ../        → src/app/api/admin/
    //   ../../     → src/app/api/
    //   ../../../  → src/app/
    //   ../../../../  → src/
    //   ../../../../../  → project root
    type SeedFn = () => Promise<void>;
    let runSeed: SeedFn;

    switch (script) {
      case 'agents': {
        const m = await import('../../../../../scripts/seed-agents');
        runSeed = m.seedAgentsRoster;
        break;
      }
      case 'cron': {
        const m = await import('../../../../../scripts/seed-cron');
        runSeed = m.seedCronJobs;
        break;
      }
      case 'providers-models': {
        const m = await import('../../../../../scripts/seed-providers-models');
        runSeed = m.seedProvidersModels;
        break;
      }
      case 'rules': {
        const m = await import('../../../../../scripts/seed-rules');
        runSeed = m.seedRules;
        break;
      }
      case 'earning-methods': {
        const m = await import('../../../../../scripts/seed-earning-methods');
        runSeed = m.seedEarningMethods;
        break;
      }
      case 'comms-payments': {
        const m = await import('../../../../../scripts/seed-add');
        runSeed = m.seedCommsAndPayments;
        break;
      }
      case 'learning': {
        // seed-learning.ts is a CLI wrapper; the actual `seedLearning`
        // export lives on seed-agents.ts (single source of truth).
        const m = await import('../../../../../scripts/seed-agents');
        runSeed = m.seedLearning;
        break;
      }
      case 'all': {
        // Run every seed script in sequence — providers-models is by far
        // the heaviest (453 rows) so we let it finish before continuing.
        const agentsMod = await import('../../../../../scripts/seed-agents');
        await agentsMod.seedAgentsRoster();
        const cronMod = await import('../../../../../scripts/seed-cron');
        await cronMod.seedCronJobs();
        const provMod = await import('../../../../../scripts/seed-providers-models');
        await provMod.seedProvidersModels();
        const rulesMod = await import('../../../../../scripts/seed-rules');
        await rulesMod.seedRules();
        const earnMod = await import('../../../../../scripts/seed-earning-methods');
        await earnMod.seedEarningMethods();
        const commsMod = await import('../../../../../scripts/seed-add');
        await commsMod.seedCommsAndPayments();
        const learnMod = await import('../../../../../scripts/seed-agents');
        await learnMod.seedLearning();
        // Skip the per-script `runSeed` invocation below — we already ran.
        runSeed = async () => undefined;
        break;
      }
      default: {
        return NextResponse.json(
          { ok: false, error: `unhandled script: ${script}` },
          { status: 400 },
        );
      }
    }

    await runSeed();

    const counts = await getTableCounts();
    const elapsed = Date.now() - t0;
    const meta = SEED_SCRIPTS.find((s) => s.key === script);
    return NextResponse.json({
      ok: true,
      message: `${meta?.label ?? script} complete (${elapsed} ms)`,
      counts,
      elapsed,
    });
  } catch (e) {
    const elapsed = Date.now() - t0;
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[/api/admin/data POST] seed failed:', msg);
    return NextResponse.json(
      { ok: false, error: msg, elapsed },
      { status: 500 },
    );
  }
}

// ─── DELETE: clear demo data by scope ────────────────────────────────
type DeleteScope =
  | 'all' | 'transactions' | 'logs' | 'comms'
  | 'telemetry' | 'notifications' | 'spawned';

export async function DELETE(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const scope = String(body.scope ?? '') as DeleteScope;
  const validScopes: DeleteScope[] = [
    'all', 'transactions', 'logs', 'comms',
    'telemetry', 'notifications', 'spawned',
  ];
  if (!validScopes.includes(scope)) {
    return NextResponse.json(
      { ok: false, error: `invalid scope: "${scope}". Valid: ${validScopes.join(', ')}` },
      { status: 400 },
    );
  }

  const deleted: Counts = {};
  const t0 = Date.now();
  try {
    // For `all`, we delete from every non-essential table but PRESERVE the
    // reference data the operator wouldn't want to re-build from scratch:
    //   providers, models, rules, earningMethods, departments, agents,
    //   workforceAgents, plugins, skills, scheduledAutonomy, autonomyTemplates,
    //   pipelines, credentials, memoryItems, skillLearning, artifacts, tasks,
    //   taskLinks. Those are either reference catalogs or operator-owned data.
    // The "all" wipe targets: payments, comms, telemetry, notifications,
    // spawnedAgents, agentLogs (older than 1h), blackbox (in-memory only —
    // can't be cleared from here; a server restart resets it).
    if (scope === 'all' || scope === 'transactions') {
      const r = await db.payment.deleteMany({});
      deleted.payments = r.count;
    }
    if (scope === 'all' || scope === 'comms') {
      const r = await db.agentMessage.deleteMany({});
      deleted.comms = r.count;
    }
    if (scope === 'all' || scope === 'telemetry') {
      const r = await db.telemetry.deleteMany({});
      deleted.telemetry = r.count;
    }
    if (scope === 'all' || scope === 'notifications') {
      const r = await db.notification.deleteMany({});
      deleted.notifications = r.count;
    }
    if (scope === 'all' || scope === 'spawned') {
      const r = await db.spawnedAgent.deleteMany({});
      deleted.spawnedAgents = r.count;
    }
    if (scope === 'all' || scope === 'logs') {
      // "logs" scope preserves the last hour of logs so we don't blind the
      // operator to in-flight issues. The Blackbox tab's in-memory buffer is
      // not cleared by this — it would require a server restart.
      const cutoff = new Date(Date.now() - 60 * 60 * 1000);
      const r = await db.agentLog.deleteMany({ where: { createdAt: { lt: cutoff } } });
      deleted.agentLogs = r.count;
    }

    const counts = await getTableCounts();
    const total = Object.values(deleted).reduce((a, b) => a + b, 0);
    const elapsed = Date.now() - t0;
    const scopeLabel: Record<DeleteScope, string> = {
      all: 'ALL demo data (reference data preserved)',
      transactions: 'Transactions (Payment rows)',
      logs: 'Agent logs older than 1h',
      comms: 'Agent comms (AgentMessage rows)',
      telemetry: 'Telemetry (Telemetry rows)',
      notifications: 'Notifications (Notification rows)',
      spawned: 'Spawned agents (SpawnedAgent rows)',
    };
    return NextResponse.json({
      ok: true,
      deleted,
      total,
      message: `Cleared ${scopeLabel[scope]} — ${total} row(s) removed (${elapsed} ms)`,
      counts,
      elapsed,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[/api/admin/data DELETE] clear failed:', msg);
    return NextResponse.json(
      { ok: false, error: msg, deleted },
      { status: 500 },
    );
  }
}
