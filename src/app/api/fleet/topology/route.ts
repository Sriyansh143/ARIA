import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { JARVIS } from '@/lib/config';

export const dynamic = 'force-dynamic';

// Returns graph data: agent nodes + comms edges (from recent messages) + task edges.
export async function GET() {
  const [agents, messages, tasks] = await Promise.all([
    db.agent.findMany({ orderBy: { codename: 'asc' } }),
    db.agentMessage.findMany({ orderBy: { createdAt: 'desc' }, take: 30 }),
    db.task.findMany({ where: { assigneeId: { not: null } }, include: { assignee: { select: { codename: true } } }, take: 30 }),
  ]);

  const STATUS_COLORS: Record<string, string> = {
    idle: '#7DD3FC',
    thinking: '#C4B5FD',
    working: '#34D399',
    error: '#F87171',
    offline: '#64748B',
  };

  type Node = { id: string; label: string; type: string; color: string; size: number; meta: Record<string, unknown> };
  type Edge = { source: string; target: string; color: string; width: number; label: string };

  const nodes: Node[] = agents.map((a) => ({
    id: a.codename,
    label: a.codename,
    type: a.status,
    color: STATUS_COLORS[a.status] ?? '#94A3B8',
    size: 10 + Math.min(a.load / 8, 8),
    meta: { role: a.role, status: a.status, load: a.load, successRate: a.successRate, taskCount: a.taskCount },
  }));

  const edges: Edge[] = [];
  const edgeMap = new Map<string, number>(); // "A→B" → count

  // Comms edges (aggregate direction + frequency).
  for (const m of messages) {
    if (m.toAgent === 'BROADCAST') {
      // Broadcast: edge from sender to all other agents (use a virtual "BROADCAST" weight).
      for (const a of agents) {
        if (a.codename !== m.fromAgent) {
          const key = `${m.fromAgent}→${a.codename}`;
          edgeMap.set(key, (edgeMap.get(key) ?? 0) + 1);
        }
      }
    } else {
      const key = `${m.fromAgent}→${m.toAgent}`;
      edgeMap.set(key, (edgeMap.get(key) ?? 0) + 1);
    }
  }

  for (const [key, count] of edgeMap) {
    const [src, tgt] = key.split('→');
    edges.push({
      source: src,
      target: tgt,
      color: count > 2 ? JARVIS.colors.violet : count > 1 ? JARVIS.colors.cyan : JARVIS.colors.border,
      width: Math.min(count, 4),
      label: `${count} message${count > 1 ? 's' : ''}`,
    });
  }

  // Task assignment edges (agent → task node). Represent as agent self-loop weight via size already.
  // We'll add task count to the meta; no separate task nodes to keep the graph focused on agents.

  // Find the most-connected agent (hub).
  const degree = new Map<string, number>();
  for (const e of edges) {
    degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
  }
  let hub = '';
  let hubDeg = 0;
  for (const [a, d] of degree) { if (d > hubDeg) { hub = a; hubDeg = d; } }

  return NextResponse.json({
    nodes,
    edges,
    stats: {
      agents: agents.length,
      messages: messages.length,
      edges: edges.length,
      hub,
      hubDegree: hubDeg,
      working: agents.filter((a) => a.status === 'working').length,
      avgLoad: Math.round((agents.reduce((s, a) => s + a.load, 0) / (agents.length || 1)) * 10) / 10,
    },
  });
}
