import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { JARVIS } from '@/lib/config';

export const dynamic = 'force-dynamic';

// Unified global search across agents, tasks, memory, comms, skills.
// GET /api/search?q=<query>
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q')?.trim().toLowerCase();
  if (!q || q.length < 1) {
    return NextResponse.json({ results: [], total: 0 });
  }

  const results: Array<{
    id: string;
    type: 'agent' | 'task' | 'memory' | 'comms' | 'skill';
    title: string;
    subtitle: string;
    meta: string;
    color: string;
    href: string;
    score: number;
  }> = [];

  // Agents — match codename, name, role.
  const agents = await db.agent.findMany({ take: 50 });
  for (const a of agents) {
    const hay = `${a.codename} ${a.name} ${a.role}`.toLowerCase();
    if (hay.includes(q)) {
      const score = a.codename.toLowerCase() === q ? 100 : a.codename.toLowerCase().startsWith(q) ? 90 : hay.includes(q) ? 70 : 0;
      if (score > 0) {
        results.push({
          id: `agent-${a.id}`,
          type: 'agent',
          title: a.codename,
          subtitle: a.role,
          meta: `${a.status} · ${Math.round(a.load)}% load`,
          color: JARVIS.colors.cyan,
          href: 'fleet',
          score,
        });
      }
    }
  }

  // Tasks — match title, description.
  const tasks = await db.task.findMany({ take: 100, include: { assignee: { select: { codename: true } } } });
  for (const t of tasks) {
    const hay = `${t.title} ${t.description ?? ''}`.toLowerCase();
    if (hay.includes(q)) {
      const score = t.title.toLowerCase().includes(q) ? 85 : 60;
      results.push({
        id: `task-${t.id}`,
        type: 'task',
        title: t.title,
        subtitle: t.assignee?.codename ?? 'unassigned',
        meta: `${t.status} · ${t.priority}`,
        color: JARVIS.colors.amber,
        href: 'tasks',
        score,
      });
    }
  }

  // Memory — match key, value, tags.
  const memory = await db.memoryItem.findMany({ take: 100 });
  for (const m of memory) {
    const hay = `${m.key} ${m.value} ${m.tags}`.toLowerCase();
    if (hay.includes(q)) {
      const score = m.key.toLowerCase().includes(q) ? 80 : 55;
      results.push({
        id: `memory-${m.id}`,
        type: 'memory',
        title: m.key,
        subtitle: m.value.slice(0, 80),
        meta: `${m.scope}${m.pinned ? ' · pinned' : ''}`,
        color: JARVIS.colors.violet,
        href: 'memory',
        score,
      });
    }
  }

  // Comms — match subject, body.
  const comms = await db.agentMessage.findMany({ take: 100, orderBy: { createdAt: 'desc' } });
  for (const c of comms) {
    const hay = `${c.subject} ${c.body}`.toLowerCase();
    if (hay.includes(q)) {
      const score = c.subject.toLowerCase().includes(q) ? 82 : 57;
      results.push({
        id: `comms-${c.id}`,
        type: 'comms',
        title: c.subject,
        subtitle: c.body.slice(0, 80),
        meta: `${c.fromAgent} → ${c.toAgent} · ${c.priority}`,
        color: JARVIS.colors.violet,
        href: 'comms',
        score,
      });
    }
  }

  // Skills — match key, name, description.
  const skills = await db.skill.findMany({ take: 50 });
  for (const s of skills) {
    const hay = `${s.key} ${s.name} ${s.description}`.toLowerCase();
    if (hay.includes(q)) {
      const score = s.name.toLowerCase().includes(q) ? 78 : 52;
      results.push({
        id: `skill-${s.id}`,
        type: 'skill',
        title: s.name,
        subtitle: s.description.slice(0, 80),
        meta: `${s.category} · ${s.runs} runs${s.enabled ? '' : ' · off'}`,
        color: JARVIS.colors.green,
        href: 'skills',
        score,
      });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return NextResponse.json({ results: results.slice(0, 30), total: results.length });
}
