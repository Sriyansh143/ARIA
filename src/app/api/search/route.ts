import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { JARVIS } from '@/lib/config';

export const dynamic = 'force-dynamic';

// Unified global search across agents, tasks, memory, comms, skills, models,
// earning methods, rules, and payments.
// GET /api/search?q=<query>&type=<agent|task|memory|comms|skill|model|earning|rule|payment>
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q')?.trim().toLowerCase();
  const typeFilter = req.nextUrl.searchParams.get('type')?.trim().toLowerCase();
  if (!q || q.length < 1) {
    return NextResponse.json({ results: [], total: 0 });
  }

  const results: Array<{
    id: string;
    type: 'agent' | 'task' | 'memory' | 'comms' | 'skill' | 'model' | 'earning' | 'rule' | 'payment';
    title: string;
    subtitle: string;
    meta: string;
    color: string;
    href: string;
    score: number;
  }> = [];

  const matchesType = (t: string) => !typeFilter || typeFilter === 'all' || typeFilter === t;

  // Agents — match codename, name, role.
  if (matchesType('agent')) {
    const agents = await db.agent.findMany({ take: 100 });
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
  }

  // Tasks — match title, description.
  if (matchesType('task')) {
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
  }

  // Memory — match key, value, tags.
  if (matchesType('memory')) {
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
  }

  // Comms — match subject, body.
  if (matchesType('comms')) {
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
  }

  // Skills — match key, name, description.
  if (matchesType('skill')) {
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
  }

  // Models — match modelId, providerKey, tier.
  if (matchesType('model')) {
    const models = await db.model.findMany({ take: 200, select: { id: true, modelId: true, providerKey: true, tier: true, status: true, source: true } });
    for (const m of models) {
      const hay = `${m.modelId} ${m.providerKey} ${m.tier}`.toLowerCase();
      if (hay.includes(q)) {
        const score = m.modelId.toLowerCase().includes(q) ? 75 : 50;
        results.push({
          id: `model-${m.id}`,
          type: 'model',
          title: m.modelId,
          subtitle: `${m.providerKey} · ${m.tier}`,
          meta: `${m.status} · ${m.source}`,
          color: JARVIS.colors.cyan,
          href: 'models',
          score,
        });
      }
    }
  }

  // Earning Methods — match name, description, category.
  if (matchesType('earning')) {
    const earnings = await db.earningMethod.findMany({ take: 50, select: { id: true, name: true, description: true, category: true, earningPotential: true, riskLevel: true } }).catch(() => []);
    for (const e of earnings) {
      const hay = `${e.name} ${e.description} ${e.category}`.toLowerCase();
      if (hay.includes(q)) {
        const score = e.name.toLowerCase().includes(q) ? 76 : 51;
        results.push({
          id: `earning-${e.id}`,
          type: 'earning',
          title: e.name,
          subtitle: e.description.slice(0, 80),
          meta: `${e.category} · ${e.earningPotential} · ${e.riskLevel}`,
          color: JARVIS.colors.green,
          href: 'earnings',
          score,
        });
      }
    }
  }

  // Rules — match name, description, category.
  if (matchesType('rule')) {
    const rules = await db.rule.findMany({ take: 50, select: { id: true, name: true, description: true, category: true, priority: true } }).catch(() => []);
    for (const r of rules) {
      const hay = `${r.name} ${r.description} ${r.category}`.toLowerCase();
      if (hay.includes(q)) {
        const score = r.name.toLowerCase().includes(q) ? 77 : 52;
        results.push({
          id: `rule-${r.id}`,
          type: 'rule',
          title: r.name,
          subtitle: r.description.slice(0, 80),
          meta: `${r.category} · ${r.priority}`,
          color: JARVIS.colors.amber,
          href: 'rules',
          score,
        });
      }
    }
  }

  // Payments — match payer, note, method.
  if (matchesType('payment')) {
    const payments = await db.payment.findMany({ take: 50, orderBy: { createdAt: 'desc' } });
    for (const p of payments) {
      const hay = `${p.payer ?? ''} ${p.note ?? ''} ${p.method}`.toLowerCase();
      if (hay.includes(q)) {
        const score = (p.payer ?? '').toLowerCase().includes(q) ? 74 : 49;
        results.push({
          id: `payment-${p.id}`,
          type: 'payment',
          title: `₹${p.amount.toLocaleString()}`,
          subtitle: `${p.payer ?? '—'} · ${p.method}`,
          meta: `${p.status} · ${p.currency}`,
          color: JARVIS.colors.green,
          href: 'payments',
          score,
        });
      }
    }
  }

  results.sort((a, b) => b.score - a.score);
  const limited = results.slice(0, 30);
  return NextResponse.json({
    results: limited,
    total: results.length,
    byType: results.reduce<Record<string, number>>((acc, r) => {
      acc[r.type] = (acc[r.type] ?? 0) + 1;
      return acc;
    }, {}),
  });
}
