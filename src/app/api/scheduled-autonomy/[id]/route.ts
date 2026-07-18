import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import ZAI from 'z-ai-web-dev-sdk';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

let _zai: Awaited<ReturnType<typeof ZAI.create>> | null = null;
async function getClient() {
  if (!_zai) _zai = await ZAI.create();
  return _zai;
}

// PATCH — toggle enabled / update interval.
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const data: Record<string, unknown> = {};
  if (typeof body.enabled === 'boolean') data.enabled = body.enabled;
  if (typeof body.intervalMin === 'number') data.intervalMin = body.intervalMin;
  const schedule = await db.scheduledAutonomy.update({ where: { id }, data });
  return NextResponse.json({ schedule });
}

// DELETE — remove a scheduled autonomy loop.
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  await db.scheduledAutonomy.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}

// POST — trigger the scheduled autonomy loop NOW (run it immediately).
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const schedule = await db.scheduledAutonomy.findUnique({ where: { id } });
  if (!schedule) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (!schedule.enabled) return NextResponse.json({ error: 'schedule is disabled' }, { status: 400 });

  const agent = await db.agent.findFirst({ where: { codename: schedule.agentCodename } });
  if (!agent) return NextResponse.json({ error: 'agent not found' }, { status: 404 });

  // Run a compact autonomy loop (search → summarize → 1 task).
  let lastResult = 'started';
  try {
    const zai = await getClient();
    await db.agent.update({ where: { id: agent.id }, data: { status: 'working', lastActive: new Date() } });

    // Step 1: web search.
    const results = await zai.functions.invoke('web_search', { query: schedule.topic, num: 5 });
    const searchResults = Array.isArray(results) ? results : [];

    // Step 2: read top result (best-effort).
    let articleText = '';
    if (searchResults.length > 0 && searchResults[0].url) {
      try {
        const pr = await zai.functions.invoke('page_reader', { url: searchResults[0].url });
        const html = (pr as { data?: { html?: string } })?.data?.html ?? '';
        articleText = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 5000);
      } catch { /* skip reader failures */ }
    }

    // Step 3: GLM-4.6 proposes 1 actionable task.
    const context = articleText || searchResults.map((r: { name?: string; snippet?: string }) => `${r.name}\n${r.snippet}`).join('\n\n');
    const completion = await zai.chat.completions.create({
      messages: [
        { role: 'assistant', content: `You are ${agent.codename}, a ${agent.role}. Based on the research, propose exactly 1 concrete, actionable task as JSON: {title, priority (low|medium|high), assignee (one of: ORION, VEGA, ATLAS, NOVA, ECHO, SAGE, FORGE, PULSE)}. Title max 80 chars. No preamble, just the JSON object.` },
        { role: 'user', content: `Topic: ${schedule.topic}\n\nResearch:\n${context.slice(0, 4000)}` },
      ],
      thinking: { type: 'disabled' },
    });
    const raw = completion.choices[0]?.message?.content ?? '{}';
    const match = raw.match(/\{[\s\S]*\}/);
    const proposed = match ? JSON.parse(match[0]) : null;

    let taskTitle = '(no task)';
    if (proposed && proposed.title) {
      const validCodenames = new Set((await db.agent.findMany({ select: { codename: true } })).map((a) => a.codename));
      const assignee = validCodenames.has(String(proposed.assignee).toUpperCase())
        ? await db.agent.findFirst({ where: { codename: String(proposed.assignee).toUpperCase() } })
        : null;
      const t = await db.task.create({
        data: {
          title: String(proposed.title).slice(0, 200),
          status: 'pending',
          priority: ['low', 'medium', 'high', 'critical'].includes(proposed.priority) ? proposed.priority : 'medium',
          assigneeId: assignee?.id ?? null,
          tags: JSON.stringify(['scheduled-autonomy', agent.codename.toLowerCase()]),
        },
      });
      taskTitle = t.title;
      if (assignee) {
        await db.agentLog.create({ data: { agentId: assignee.id, level: 'info', message: `Scheduled autonomy assigned: ${t.title}` } });
      }
    }

    // Step 4: store memory + notification.
    await db.memoryItem.create({
      data: {
        scope: 'episodic',
        key: `sched-${agent.codename.toLowerCase()}-${Date.now()}`,
        value: `Scheduled autonomy on "${schedule.topic}": ${searchResults.length} results, task: ${taskTitle}`,
        tags: JSON.stringify(['scheduled-autonomy', agent.codename.toLowerCase()]),
      },
    }).catch(() => { /* ignore */ });

    await db.notification.create({
      data: { type: 'success', title: 'Scheduled Autonomy Run', message: `${agent.codename} researched "${schedule.topic}" → task: ${taskTitle.slice(0, 50)}.`, read: false },
    });

    await db.agentLog.create({ data: { agentId: agent.id, level: 'success', message: `Scheduled autonomy complete: "${schedule.topic}" → ${taskTitle.slice(0, 60)}` } });
    await db.agent.update({ where: { id: agent.id }, data: { status: 'idle', lastActive: new Date() } });

    lastResult = `success: ${searchResults.length} results, task: ${taskTitle.slice(0, 60)}`;
  } catch (e) {
    await db.agent.update({ where: { id: agent.id }, data: { status: 'error', lastActive: new Date() } });
    lastResult = `error: ${e instanceof Error ? e.message.slice(0, 80) : 'unknown'}`;
    await db.agentLog.create({ data: { agentId: agent.id, level: 'error', message: `Scheduled autonomy failed: ${lastResult}` } });
  }

  const updated = await db.scheduledAutonomy.update({
    where: { id },
    data: { lastRun: new Date(), runCount: { increment: 1 }, lastResult },
  });

  return NextResponse.json({ schedule: updated, lastResult });
}
