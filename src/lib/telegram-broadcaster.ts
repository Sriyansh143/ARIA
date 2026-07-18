// =====================================================================
// telegram-broadcaster.ts — Owner notifications via Telegram Bot API.
// =====================================================================
// Sends regular Telegram updates to the owner covering:
//   1. Daily morning briefing (8 AM): overnight activity, today's plan
//   2. Hourly progress updates (only when there's activity to report)
//   3. Improvement notifications (when research finds something actionable)
//   4. Plan updates (when the system changes its own roadmap)
//   5. Weekly summary (Sunday 6 PM)
//
// Direct Telegram Bot API calls (no local bot service required). Falls
// back to Notification rows when TELEGRAM_BOT_TOKEN/CHAT_ID aren't set
// so the dashboard still shows what would have been broadcast.
//
// Env vars:
//   TELEGRAM_BOT_TOKEN   bot token from @BotFather
//   TELEGRAM_CHAT_ID     owner chat id
//   HIGGSFIELD_API_KEY   (optional) for AI image generation
//   DASHBOARD_BASE       (optional, default http://127.0.0.1:3000)
// =====================================================================

import { db } from '@/lib/db';

// ─── Send a message to owner via Telegram ────────────────────────────
export async function sendToOwner(message: string): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    // Fallback: record as a notification so the dashboard surfaces it.
    try {
      await db.notification.create({
        data: {
          type: 'info',
          title: 'Telegram broadcast (token not set)',
          message: message.slice(0, 500),
          read: false,
        },
      });
    } catch {}
    return false;
  }
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: message.slice(0, 4000) }),
      signal: AbortSignal.timeout(10_000),
    });
    return r.ok;
  } catch (err) {
    console.warn('broadcaster: failed to send Telegram', { err: (err as Error).message });
    return false;
  }
}

// ─── Send a photo to owner ───────────────────────────────────────────
export async function sendPhotoToOwner(photoBuffer: Buffer, caption?: string): Promise<boolean> {
  const t = process.env.TELEGRAM_BOT_TOKEN;
  const c = process.env.TELEGRAM_CHAT_ID;
  if (!t || !c) return false;
  try {
    const fd = new FormData();
    fd.append('chat_id', c);
    fd.append('photo', new Blob([new Uint8Array(photoBuffer)]), 'image.jpg');
    if (caption) fd.append('caption', caption.slice(0, 1024));
    const r = await fetch(`https://api.telegram.org/bot${t}/sendPhoto`, {
      method: 'POST',
      body: fd,
      signal: AbortSignal.timeout(15_000),
    });
    return r.ok;
  } catch {
    return false;
  }
}

// ─── Send an audio file to owner ─────────────────────────────────────
export async function sendAudioToOwner(audioBuffer: Buffer, title?: string): Promise<boolean> {
  const t = process.env.TELEGRAM_BOT_TOKEN;
  const c = process.env.TELEGRAM_CHAT_ID;
  if (!t || !c) return false;
  try {
    const fd = new FormData();
    fd.append('chat_id', c);
    fd.append('audio', new Blob([new Uint8Array(audioBuffer)]), 'audio.mp3');
    if (title) fd.append('title', title);
    const r = await fetch(`https://api.telegram.org/bot${t}/sendAudio`, {
      method: 'POST',
      body: fd,
      signal: AbortSignal.timeout(30_000),
    });
    return r.ok;
  } catch {
    return false;
  }
}

// ─── Send a document to owner ────────────────────────────────────────
export async function sendDocumentToOwner(
  fileBuffer: Buffer,
  filename: string,
  caption?: string,
): Promise<boolean> {
  const t = process.env.TELEGRAM_BOT_TOKEN;
  const c = process.env.TELEGRAM_CHAT_ID;
  if (!t || !c) return false;
  try {
    const fd = new FormData();
    fd.append('chat_id', c);
    fd.append('document', new Blob([new Uint8Array(fileBuffer)]), filename);
    if (caption) fd.append('caption', caption.slice(0, 1024));
    const r = await fetch(`https://api.telegram.org/bot${t}/sendDocument`, {
      method: 'POST',
      body: fd,
      signal: AbortSignal.timeout(30_000),
    });
    return r.ok;
  } catch {
    return false;
  }
}

// ─── Send a dashboard screenshot to owner ────────────────────────────
export async function sendScreenshotToOwner(caption?: string): Promise<boolean> {
  try {
    const r = await fetch(
      `${process.env.DASHBOARD_BASE || 'http://127.0.0.1:3000'}/api/screen-viewer/screenshot`,
      { signal: AbortSignal.timeout(10_000) },
    );
    if (!r.ok) return false;
    const b = await r.blob();
    return await sendPhotoToOwner(Buffer.from(await b.arrayBuffer()), caption || 'Dashboard');
  } catch {
    return false;
  }
}

// ─── Generate + send an AI image ─────────────────────────────────────
export async function generateAndSendImage(prompt: string): Promise<boolean> {
  try {
    const k = process.env.HIGGSFIELD_API_KEY;
    if (!k) {
      await sendToOwner('HIGGSFIELD_API_KEY not set');
      return false;
    }
    const r = await fetch('https://api.higgsfield.com/v1/generate', {
      method: 'POST',
      headers: { Authorization: `Bearer ${k}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, model: 'flux-dev', size: '1024x1024' }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!r.ok) return false;
    const d = await r.json();
    if (d.image_url) {
      const ir = await fetch(d.image_url, { signal: AbortSignal.timeout(15_000) });
      if (ir.ok) {
        const ab = await ir.blob().then((b) => b.arrayBuffer());
        return await sendPhotoToOwner(Buffer.from(ab), `Generated: ${prompt.slice(0, 100)}`);
      }
    }
    return false;
  } catch {
    return false;
  }
}

// ─── Local stats helpers (replaces prisma.autonomousAction/task/revenue/etc.) ──
async function getOvernightStats(): Promise<{
  overnightActions: number;
  overnightTasks: number;
  revenueReceived: number;
  researchSummaries: string[];
  activeAgents: number;
}> {
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const [actions, tasks, agents, memoryItems] = await Promise.all([
    db.memoryItem.count({ where: { scope: 'autonomous-action', createdAt: { gte: yesterday } } }),
    db.task.count({ where: { updatedAt: { gte: yesterday }, status: 'completed' } }),
    db.agent.count({ where: { status: { in: ['working', 'idle'] } } }),
    db.memoryItem.findMany({
      where: { scope: 'research-log', createdAt: { gte: yesterday } },
      orderBy: { createdAt: 'desc' },
      take: 3,
    }),
  ]);

  const researchSummaries: string[] = [];
  for (const row of memoryItems) {
    try {
      const r = JSON.parse(row.value);
      researchSummaries.push(`   • ${r.topic || r.title || row.key}`);
    } catch {}
  }

  // Revenue: sum of MemoryItem(scope='revenue', value.amount) where status='received'
  let revenueReceived = 0;
  try {
    const revRows = await db.memoryItem.findMany({
      where: { scope: 'revenue', tags: { contains: 'received' } },
    });
    for (const row of revRows) {
      try {
        const r = JSON.parse(row.value);
        const ts = r.paymentDate || r.createdAt || row.createdAt;
        if (ts && new Date(ts) >= yesterday) {
          revenueReceived += Number(r.amount) || 0;
        }
      } catch {}
    }
  } catch {}

  return {
    overnightActions: actions,
    overnightTasks: tasks,
    revenueReceived,
    researchSummaries,
    activeAgents: agents,
  };
}

async function getHourlyStats(): Promise<{
  hourActions: number;
  completedTasks: number;
  pendingTasks: number;
  pendingPayments: number;
  overduePayments: number;
}> {
  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

  const [hourActions, completedTasks, pendingTasks] = await Promise.all([
    db.memoryItem.count({ where: { scope: 'autonomous-action', createdAt: { gte: oneHourAgo } } }),
    db.task.count({ where: { updatedAt: { gte: oneHourAgo }, status: 'completed' } }),
    db.task.count({ where: { status: 'pending' } }),
  ]);

  let pendingPayments = 0;
  let overduePayments = 0;
  try {
    const revRows = await db.memoryItem.findMany({ where: { scope: 'revenue' } });
    for (const row of revRows) {
      try {
        const r = JSON.parse(row.value);
        if (r.status === 'pending') pendingPayments++;
        else if (r.status === 'overdue') overduePayments++;
      } catch {}
    }
  } catch {}

  return {
    hourActions,
    completedTasks,
    pendingTasks,
    pendingPayments,
    overduePayments,
  };
}

// ─── Daily morning briefing ──────────────────────────────────────────
export async function sendDailyBriefing(): Promise<void> {
  const now = new Date();

  try {
    const stats = await getOvernightStats();

    const message = `☀️ JARVIS Daily Briefing — ${now.toISOString().split('T')[0]}

OVERNIGHT ACTIVITY:
   • ${stats.overnightActions} autonomous actions taken
   • ${stats.overnightTasks} tasks completed
   • ${stats.activeAgents} agents currently active

REVENUE:
   • Received yesterday: $${stats.revenueReceived.toFixed(2)}

RESEARCH FINDINGS:
${stats.researchSummaries.length > 0 ? stats.researchSummaries.join('\n') : '   • No new research'}

TODAY'S PLAN:
   • Continue monitoring Okara marketing feed
   • Process any queued tasks
   • Run daily research sessions (6 AM - 12 PM)
   • Check payment follow-ups
   • Monitor social media sessions

The system is running autonomously. You'll be notified of any urgent items.`;

    await sendToOwner(message);
    console.info('broadcaster: daily briefing sent');
  } catch (err) {
    console.warn('broadcaster: daily briefing failed', { err: (err as Error).message });
  }
}

// ─── Hourly progress update ──────────────────────────────────────────
export async function sendHourlyUpdate(): Promise<void> {
  const now = new Date();

  try {
    const stats = await getHourlyStats();

    if (
      stats.hourActions === 0 &&
      stats.completedTasks === 0 &&
      stats.pendingTasks === 0 &&
      stats.pendingPayments === 0 &&
      stats.overduePayments === 0
    ) {
      return;
    }

    const message = `📊 JARVIS Hourly Update — ${now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}

LAST HOUR:
   • ${stats.hourActions} autonomous actions
   • ${stats.completedTasks} tasks completed

CURRENT QUEUE:
   • ${stats.pendingTasks} pending tasks
   • ${stats.pendingPayments} pending payments
   • ${stats.overduePayments} overdue payments${stats.overduePayments > 0 ? ' ⚠️' : ''}

${stats.overduePayments > 0 ? '⚠️ Overdue payments need attention. Check the Revenue tab.' : 'System running smoothly.'}`;

    await sendToOwner(message);
    console.info('broadcaster: hourly update sent');
  } catch (err) {
    console.warn('broadcaster: hourly update failed', { err: (err as Error).message });
  }
}

// ─── Improvement notification (when research finds something) ────────
export async function sendImprovementNotification(opts: {
  category: string;
  topic: string;
  finding: string;
  actionItems: string[];
}): Promise<void> {
  const message = `🔬 Research Finding: ${opts.category}

${opts.topic}

${opts.finding.slice(0, 500)}

ACTION ITEMS:
${opts.actionItems.slice(0, 5).map((a, i) => `   ${i + 1}. ${a}`).join('\n')}

View full details in the Research tab of your dashboard.`;

  await sendToOwner(message);
  console.info('broadcaster: improvement notification sent', { category: opts.category });
}

// ─── Plan update (when the system changes its roadmap) ───────────────
export async function sendPlanUpdate(opts: {
  change: string;
  reason: string;
  affectedAreas: string[];
}): Promise<void> {
  const message = `📋 Plan Update

CHANGE: ${opts.change}

REASON: ${opts.reason}

AFFECTED AREAS:
${opts.affectedAreas.map((a) => `   • ${a}`).join('\n')}

This change was made autonomously based on research findings. Review in the dashboard if needed.`;

  await sendToOwner(message);
  console.info('broadcaster: plan update sent', { change: opts.change });
}

// ─── Weekly summary (Sunday 6 PM) ────────────────────────────────────
export async function sendWeeklySummary(): Promise<void> {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  try {
    const [weekActions, weekTasks, activeClients, activeServices, researchRows] = await Promise.all([
      db.memoryItem.count({ where: { scope: 'autonomous-action', createdAt: { gte: weekAgo } } }),
      db.task.count({ where: { updatedAt: { gte: weekAgo }, status: 'completed' } }),
      db.memoryItem.count({ where: { scope: 'client', tags: { contains: 'active' } } }),
      db.memoryItem.count({ where: { scope: 'service', tags: { contains: 'active' } } }),
      db.memoryItem.count({ where: { scope: 'research-log', createdAt: { gte: weekAgo } } }),
    ]);

    // Sum weekly revenue
    let weekRevenue = 0;
    try {
      const revRows = await db.memoryItem.findMany({ where: { scope: 'revenue', tags: { contains: 'received' } } });
      for (const row of revRows) {
        try {
          const r = JSON.parse(row.value);
          const ts = r.paymentDate || r.createdAt || row.createdAt;
          if (ts && new Date(ts) >= weekAgo) {
            weekRevenue += Number(r.amount) || 0;
          }
        } catch {}
      }
    } catch {}

    const message = `📅 JARVIS Weekly Summary — Week of ${weekAgo.toISOString().split('T')[0]}

WEEK IN REVIEW:
   • ${weekActions} autonomous actions
   • ${weekTasks} tasks completed
   • ${researchRows} research sessions run

REVENUE:
   • Total received: $${weekRevenue.toFixed(2)}
   • Active clients: ${activeClients}
   • Active services: ${activeServices}

NEXT WEEK'S PRIORITIES:
   • Continue client outreach (3D website previews)
   • Follow up on overdue payments
   • Research new open-source tools
   • Monitor social media engagement
   • Optimize agent performance based on analytics

The system will continue running 24/7. Have a great week!`;

    await sendToOwner(message);
    console.info('broadcaster: weekly summary sent');
  } catch (err) {
    console.warn('broadcaster: weekly summary failed', { err: (err as Error).message });
  }
}

// ─── Start the broadcast schedule ────────────────────────────────────
let broadcastStarted = false;
export function startBroadcastSchedule(): void {
  if (broadcastStarted) return;
  broadcastStarted = true;

  const now = new Date();

  // Daily briefing at 8 AM
  const next8AM = new Date(now);
  next8AM.setHours(8, 0, 0, 0);
  if (next8AM <= now) next8AM.setDate(next8AM.getDate() + 1);
  const msUntil8AM = next8AM.getTime() - now.getTime();

  const dailyTimer = setTimeout(() => {
    void sendDailyBriefing();
    const interval = setInterval(() => {
      void sendDailyBriefing();
    }, 24 * 60 * 60 * 1000);
    interval.unref();
  }, msUntil8AM);
  dailyTimer.unref();

  // Hourly updates
  const hourlyTimer = setInterval(() => {
    void sendHourlyUpdate().catch(() => {});
  }, 60 * 60 * 1000);
  hourlyTimer.unref();

  // Weekly summary on Sunday at 6 PM
  const nextSunday6PM = new Date(now);
  const daysUntilSunday = (7 - now.getDay()) % 7;
  nextSunday6PM.setDate(now.getDate() + daysUntilSunday);
  nextSunday6PM.setHours(18, 0, 0, 0);
  if (nextSunday6PM <= now) nextSunday6PM.setDate(nextSunday6PM.getDate() + 7);
  const msUntilSunday = nextSunday6PM.getTime() - now.getTime();

  const weeklyTimer = setTimeout(() => {
    void sendWeeklySummary();
    const interval = setInterval(() => {
      void sendWeeklySummary();
    }, 7 * 24 * 60 * 60 * 1000);
    interval.unref();
  }, msUntilSunday);
  weeklyTimer.unref();

  console.info('broadcaster: schedule started (daily 8AM, hourly, weekly Sun 6PM)');
}
