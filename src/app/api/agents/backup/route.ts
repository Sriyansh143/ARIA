import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/agents/backup
 * Exports all agent configurations as a JSON file (download).
 * Includes: name, codename, role, skills, model, status — NOT logs/tasks
 * (those are operational data, not configuration).
 */
export async function GET() {
  const agents = await db.agent.findMany({
    orderBy: { codename: 'asc' },
    select: {
      name: true,
      codename: true,
      role: true,
      skills: true,
      model: true,
      status: true,
      successRate: true,
      load: true,
    },
  });

  const payload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    agentCount: agents.length,
    agents: agents.map((a) => ({
      name: a.name,
      codename: a.codename,
      role: a.role,
      skills: a.skills, // JSON string of array
      model: a.model,
      status: a.status,
      successRate: a.successRate,
      load: a.load,
    })),
  };

  const filename = `jarvis-agents-backup-${new Date().toISOString().slice(0, 10)}.json`;
  return new NextResponse(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}

/**
 * POST /api/agents/backup
 * Imports agent configurations from a JSON backup.
 * Body: { agents: [{ name, codename, role, skills, model, status }] }
 * Mode: 'upsert' (default) — update existing by codename, create new if not found.
 * Mode: 'create' — only create new agents (skip existing codenames).
 * Returns: { imported, created, updated, skipped, errors }
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const mode = body.mode === 'create' ? 'create' : 'upsert';
  const incoming: Array<{
    name?: string; codename?: string; role?: string; skills?: string;
    model?: string; status?: string; successRate?: number; load?: number;
  }> = Array.isArray(body.agents) ? body.agents : [];

  if (incoming.length === 0) {
    return NextResponse.json({ error: 'No agents provided. Expected { agents: [...] }' }, { status: 400 });
  }

  let created = 0;
  let updated = 0;
  let skipped = 0;
  const errors: Array<{ codename: string; error: string }> = [];

  for (const item of incoming) {
    try {
      if (!item.name || !item.codename) {
        skipped++;
        continue;
      }
      const codename = String(item.codename).toUpperCase();
      const data = {
        name: item.name,
        codename,
        role: item.role ?? 'Generalist',
        skills: item.skills ?? '[]',
        model: item.model ?? 'glm-4.6',
        status: item.status ?? 'idle',
        successRate: typeof item.successRate === 'number' ? item.successRate : 100.0,
        load: typeof item.load === 'number' ? item.load : 0.0,
      };

      const existing = await db.agent.findFirst({ where: { codename } });
      if (existing) {
        if (mode === 'create') {
          skipped++;
          continue;
        }
        await db.agent.update({ where: { id: existing.id }, data });
        updated++;
      } else {
        await db.agent.create({ data });
        created++;
      }
    } catch (e) {
      errors.push({
        codename: item.codename ?? '(unknown)',
        error: e instanceof Error ? e.message : 'Unknown error',
      });
    }
  }

  return NextResponse.json({
    ok: true,
    mode,
    imported: created + updated,
    created,
    updated,
    skipped,
    errors,
  });
}
