// agent-spawner.ts — Spawn-on-High-Load sub-agent factory with 30-day retention
// and respawn-from-log. Spawned agents are recorded both as SpawnedAgent rows
// (active lifecycle) and as Agent rows (so they show up in the main fleet).
// When a spawned agent is retired or expires, the active row is moved to
// SpawnedAgentLog (preserved for respawn history). Respawn pulls the latest
// log entry by codename and reactivates it.

import { db } from '@/lib/db';
import { randomUUID } from 'crypto';

const SPAWN_RETENTION_DAYS = 30;

export interface SpawnInput {
  parentCodename: string;
  role?: string;
  skills?: string[];
  reason?: string;
  model?: string;
  respawnFromLogId?: string;
}

export interface SpawnedAgentRow {
  id: string;
  agentId: string;
  codename: string;
  name: string;
  parentId: string;
  parentAgentId?: string | null;
  role: string;
  skills: string[];
  model: string;
  status: string;
  taskCount: number;
  earnings: number;
  spawnedReason?: string | null;
  lastUsed: string;
  expiresAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SpawnedLogRow {
  id: string;
  logId: string;
  codename: string;
  name: string;
  parentId: string;
  role: string;
  skills: string[];
  model: string;
  totalEarnings: number;
  totalTasks: number;
  spawnCount: number;
  firstSpawnedAt: string;
  lastActiveAt: string;
}

interface RawSpawned {
  id: string;
  agentId: string;
  codename: string;
  name: string;
  parentId: string;
  parentAgentId: string | null;
  role: string;
  skills: string;
  model: string;
  status: string;
  taskCount: number;
  earnings: number;
  spawnedReason: string | null;
  lastUsed: Date;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface RawLog {
  id: string;
  logId: string;
  codename: string;
  name: string;
  parentId: string;
  role: string;
  skills: string;
  model: string;
  totalEarnings: number;
  totalTasks: number;
  spawnCount: number;
  firstSpawnedAt: Date;
  lastActiveAt: Date;
}

function safeParse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function serializeRow(r: RawSpawned): SpawnedAgentRow {
  return {
    id: r.id,
    agentId: r.agentId,
    codename: r.codename,
    name: r.name,
    parentId: r.parentId,
    parentAgentId: r.parentAgentId,
    role: r.role,
    skills: safeParse<string[]>(r.skills, []),
    model: r.model,
    status: r.status,
    taskCount: r.taskCount,
    earnings: r.earnings,
    spawnedReason: r.spawnedReason,
    lastUsed: r.lastUsed.toISOString(),
    expiresAt: r.expiresAt ? r.expiresAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

function serializeLog(r: RawLog): SpawnedLogRow {
  return {
    id: r.id,
    logId: r.logId,
    codename: r.codename,
    name: r.name,
    parentId: r.parentId,
    role: r.role,
    skills: safeParse<string[]>(r.skills, []),
    model: r.model,
    totalEarnings: r.totalEarnings,
    totalTasks: r.totalTasks,
    spawnCount: r.spawnCount,
    firstSpawnedAt: r.firstSpawnedAt.toISOString(),
    lastActiveAt: r.lastActiveAt.toISOString(),
  };
}

function makeCodename(parent: string, role: string, n: number): string {
  const prefix = (parent || 'AGENT').toUpperCase().slice(0, 4);
  const rolePart = (role || 'SUB').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4) || 'SUB';
  return `${prefix}-${rolePart}-${String(n).padStart(3, '0')}`;
}

function makeName(role: string, n: number): string {
  const pretty = (role || 'Sub Agent')
    .split(/[-_\s]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
  return `${pretty} #${n}`;
}

/**
 * Spawn a sub-agent under the given parent. If `respawnFromLogId` is supplied,
 * pull that log row and reactivate the agent (bumping spawnCount). Otherwise
 * create a brand-new spawned agent + a real Agent row so the fleet sees it.
 */
export async function spawnSubAgent(input: SpawnInput): Promise<SpawnedAgentRow> {
  // Respawn-from-log path: pull existing log entry by logId first so we can
  // resolve the parent from the log if `parentCodename` wasn't supplied.
  let logForRespawn: Awaited<ReturnType<typeof db.spawnedAgentLog.findUnique>> = null;
  if (input.respawnFromLogId) {
    logForRespawn = await db.spawnedAgentLog.findUnique({ where: { logId: input.respawnFromLogId } });
    if (!logForRespawn) {
      throw new Error(`Respawn log "${input.respawnFromLogId}" not found`);
    }
  }

  const parentCodename = input.parentCodename || (logForRespawn?.parentId ?? '');
  const parent = parentCodename
    ? await db.agent.findFirst({ where: { codename: parentCodename } })
    : null;
  if (!parent) {
    throw new Error(`Parent agent "${parentCodename}" not found`);
  }

  const role = input.role?.trim() || 'Sub Agent';
  const skills = Array.isArray(input.skills) ? input.skills.filter(Boolean) : [];
  const model = input.model || parent.model || 'glm-4.6';
  const reason = input.spawnedReason || input.reason || null;
  const expiresAt = new Date(Date.now() + SPAWN_RETENTION_DAYS * 24 * 60 * 60 * 1000);

  // Respawn-from-log path: pull existing log entry by logId and reactivate.
  if (input.respawnFromLogId && logForRespawn) {
    const log = logForRespawn;

    // If an active spawned row already exists for this codename, just touch it.
    const existingActive = await db.spawnedAgent.findUnique({ where: { codename: log.codename } });
    if (existingActive) {
      const updated = await db.spawnedAgent.update({
        where: { id: existingActive.id },
        data: {
          status: 'active',
          lastUsed: new Date(),
          expiresAt,
          spawnedReason: reason ?? existingActive.spawnedReason,
        },
      });
      await db.spawnedAgentLog.update({
        where: { id: log.id },
        data: { spawnCount: log.spawnCount + 1, lastActiveAt: new Date() },
      });
      return serializeRow(updated);
    }

    // Otherwise re-create the active row from the log entry.
    const agentId = randomUUID();
    const created = await db.spawnedAgent.create({
      data: {
        agentId,
        codename: log.codename,
        name: log.name,
        parentId: log.parentId,
        parentAgentId: parent.id,
        role: log.role,
        skills: log.skills,
        model: log.model,
        status: 'active',
        taskCount: 0,
        earnings: 0,
        spawnedReason: reason,
        lastUsed: new Date(),
        expiresAt,
      },
    });

    // Also recreate the Agent row so the fleet sees this respawned sub-agent.
    await db.agent.upsert({
      where: { codename: log.codename },
      update: {
        status: 'idle',
        load: 0,
        lastActive: new Date(),
        role: log.role,
        skills: log.skills,
        model: log.model,
      },
      create: {
        name: log.name,
        codename: log.codename,
        role: log.role,
        status: 'idle',
        skills: log.skills,
        model: log.model,
        load: 0,
        successRate: 100,
      },
    });

    await db.spawnedAgentLog.update({
      where: { id: log.id },
      data: { spawnCount: log.spawnCount + 1, lastActiveAt: new Date() },
    });

    return serializeRow(created);
  }

  // Fresh-spawn path: mint a unique codename.
  let attempts = 0;
  let codename = '';
  let name = '';
  while (attempts < 50) {
    attempts++;
    const n = Math.floor(Math.random() * 9000) + 100;
    codename = makeCodename(input.parentCodename, role, n);
    name = makeName(role, n);
    const clash = await db.spawnedAgent.findUnique({ where: { codename } });
    if (!clash) break;
  }

  const agentId = randomUUID();

  // Create the SpawnedAgent row first (this is the canonical record).
  const spawned = await db.spawnedAgent.create({
    data: {
      agentId,
      codename,
      name,
      parentId: input.parentCodename,
      parentAgentId: parent.id,
      role,
      skills: JSON.stringify(skills),
      model,
      status: 'active',
      taskCount: 0,
      earnings: 0,
      spawnedReason: reason,
      lastUsed: new Date(),
      expiresAt,
    },
  });

  // Also create a real Agent row so the main fleet sees this sub-agent.
  try {
    await db.agent.create({
      data: {
        name,
        codename,
        role,
        status: 'idle',
        skills: JSON.stringify(skills),
        model,
        load: 0,
        successRate: 100,
      },
    });
  } catch {
    // If codename collides with an existing Agent row, ignore — the SpawnedAgent
    // row is still the source of truth.
  }

  // Create or update the respawn log entry.
  const existingLog = await db.spawnedAgentLog.findFirst({ where: { codename } });
  if (existingLog) {
    await db.spawnedAgentLog.update({
      where: { id: existingLog.id },
      data: { spawnCount: existingLog.spawnCount + 1, lastActiveAt: new Date() },
    });
  } else {
    await db.spawnedAgentLog.create({
      data: {
        logId: randomUUID(),
        codename,
        name,
        parentId: input.parentCodename,
        role,
        skills: JSON.stringify(skills),
        model,
        totalEarnings: 0,
        totalTasks: 0,
        spawnCount: 1,
        firstSpawnedAt: new Date(),
        lastActiveAt: new Date(),
      },
    });
  }

  return serializeRow(spawned);
}

/**
 * Touch (heartbeat) a spawned agent — bumps lastUsed + resets status to active.
 */
export async function touchSpawnedAgent(codename: string): Promise<SpawnedAgentRow | null> {
  const row = await db.spawnedAgent.findUnique({ where: { codename } });
  if (!row) return null;
  const updated = await db.spawnedAgent.update({
    where: { id: row.id },
    data: { lastUsed: new Date(), status: 'active' },
  });
  await db.spawnedAgentLog.updateMany({
    where: { codename },
    data: { lastActiveAt: new Date() },
  });
  return serializeRow(updated);
}

/**
 * Record earnings against a spawned agent (also rolls up to its log entry).
 */
export async function recordSpawnedEarnings(codename: string, amount: number): Promise<SpawnedAgentRow | null> {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error(`Invalid amount: ${amount}`);
  }
  const row = await db.spawnedAgent.findUnique({ where: { codename } });
  if (!row) return null;
  const updated = await db.spawnedAgent.update({
    where: { id: row.id },
    data: {
      earnings: row.earnings + amount,
      taskCount: row.taskCount + 1,
      lastUsed: new Date(),
    },
  });
  // Roll up to log entry (totals across all spawns of this codename).
  const log = await db.spawnedAgentLog.findFirst({ where: { codename } });
  if (log) {
    await db.spawnedAgentLog.update({
      where: { id: log.id },
      data: {
        totalEarnings: log.totalEarnings + amount,
        totalTasks: log.totalTasks + 1,
        lastActiveAt: new Date(),
      },
    });
  }
  return serializeRow(updated);
}

/**
 * Retire a spawned agent (status='retired'). Active row stays so it can be
 * respawned later. The log entry is preserved regardless.
 */
export async function retireSpawnedAgent(codename: string): Promise<SpawnedAgentRow | null> {
  const row = await db.spawnedAgent.findUnique({ where: { codename } });
  if (!row) return null;
  const updated = await db.spawnedAgent.update({
    where: { id: row.id },
    data: { status: 'retired', lastUsed: new Date() },
  });
  return serializeRow(updated);
}

/**
 * Auto-cleanup: delete spawned agents whose expiresAt has passed (or whose
 * lastUsed is older than SPAWN_RETENTION_DAYS). Logs are ALWAYS preserved.
 */
export async function cleanupExpiredSpawnedAgents(): Promise<{ deleted: number; preservedLogs: number }> {
  const cutoff = new Date(Date.now() - SPAWN_RETENTION_DAYS * 24 * 60 * 60 * 1000);

  // Find expired rows — either by explicit expiresAt or by lastUsed staleness.
  const expired = await db.spawnedAgent.findMany({
    where: {
      OR: [
        { expiresAt: { lt: new Date() } },
        { lastUsed: { lt: cutoff } },
      ],
    },
  });

  // Before deleting, ensure each one has a log entry (it should already, but
  // belt-and-suspenders so we never lose history).
  for (const row of expired) {
    const existing = await db.spawnedAgentLog.findFirst({ where: { codename: row.codename } });
    if (!existing) {
      await db.spawnedAgentLog.create({
        data: {
          logId: randomUUID(),
          codename: row.codename,
          name: row.name,
          parentId: row.parentId,
          role: row.role,
          skills: row.skills,
          model: row.model,
          totalEarnings: row.earnings,
          totalTasks: row.taskCount,
          spawnCount: 1,
          firstSpawnedAt: row.createdAt,
          lastActiveAt: row.lastUsed,
        },
      });
    } else {
      await db.spawnedAgentLog.update({
        where: { id: existing.id },
        data: {
          totalEarnings: Math.max(existing.totalEarnings, row.earnings),
          totalTasks: Math.max(existing.totalTasks, row.taskCount),
          lastActiveAt: row.lastUsed,
        },
      });
    }
  }

  // Delete the expired active rows.
  if (expired.length > 0) {
    await db.spawnedAgent.deleteMany({
      where: { id: { in: expired.map((r) => r.id) } },
    });
  }

  const preservedLogs = await db.spawnedAgentLog.count();
  return { deleted: expired.length, preservedLogs };
}

export interface SpawnedFilter {
  status?: string;
  parentCodename?: string;
}

export async function listSpawnedAgents(filter?: SpawnedFilter): Promise<SpawnedAgentRow[]> {
  const where: Record<string, unknown> = {};
  if (filter?.status) where.status = filter.status;
  if (filter?.parentCodename) where.parentId = filter.parentCodename;
  const rows = await db.spawnedAgent.findMany({
    where,
    orderBy: { lastUsed: 'desc' },
  });
  return rows.map(serializeRow);
}

export async function listRespawnableLogs(): Promise<SpawnedLogRow[]> {
  const rows = await db.spawnedAgentLog.findMany({
    orderBy: { lastActiveAt: 'desc' },
  });
  return rows.map(serializeLog);
}

export async function getSpawnedAgent(id: string): Promise<SpawnedAgentRow | null> {
  const row = await db.spawnedAgent.findUnique({ where: { id } });
  return row ? serializeRow(row) : null;
}

export async function deleteSpawnedAgent(id: string): Promise<{ ok: true }> {
  await db.spawnedAgent.delete({ where: { id } }).catch(() => null);
  return { ok: true };
}

export const SPAWN_RETENTION = SPAWN_RETENTION_DAYS;
