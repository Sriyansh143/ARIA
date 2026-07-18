import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { quickChat } from '@/lib/llm';

// =====================================================================
// POST /api/reports/email — Email a daily fleet report (STUB).
// =====================================================================
// Accepts one of two shapes:
//   { email: string, reportContent: string }   — email the provided content
//   { email: string, generate: true }          — generate a fresh daily
//                                                report (same logic as
//                                                /api/reports/daily GET)
//                                                and email it.
//
// The sandbox has no SMTP gateway configured, so this is a STUB:
//   1. Logs the email + report content to the server console.
//   2. Persists the email to the Notification table (type='email').
//   3. Returns { ok, message, emailLogId }.
//
// When SMTP is added later, swap the console.log + db.notification.create
// block for a real nodemailer / SES call — the contract stays the same.
// =====================================================================

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const EMAIL_MAX_LEN = 254; // RFC 5321 practical limit
const REPORT_MAX_LEN = 20000;

// Basic email shape check — non-empty, has @, has a dot after @.
// Not a strict RFC validator — just enough to reject obvious junk.
function isValidEmail(email: string): boolean {
  if (!email || email.length > EMAIL_MAX_LEN) return false;
  const at = email.indexOf('@');
  if (at < 1 || at === email.length - 1) return false;
  const domain = email.slice(at + 1);
  if (!domain.includes('.') || domain.startsWith('.') || domain.endsWith('.')) return false;
  return true;
}

// Replicates the /api/reports/daily GET logic (kept in sync deliberately
// rather than refactored to a shared helper, so the daily route stays
// untouched and self-contained).
async function generateDailyReport(): Promise<string> {
  const [agents, tasks, payments, logs, comms, skillRuns, memory] = await Promise.all([
    db.agent.findMany({ orderBy: { codename: 'asc' } }),
    db.task.findMany({ orderBy: { createdAt: 'desc' }, take: 20, include: { assignee: { select: { codename: true } } } }),
    db.payment.aggregate({ _sum: { amount: true }, where: { status: 'confirmed' } }),
    db.agentLog.findMany({ orderBy: { createdAt: 'desc' }, take: 30, include: { agent: { select: { codename: true } } } }),
    db.agentMessage.count(),
    db.skillRun.count(),
    db.memoryItem.count(),
  ]);

  const completed = tasks.filter((t) => t.status === 'completed').length;
  const inProgress = tasks.filter((t) => t.status === 'in_progress').length;
  const pending = tasks.filter((t) => t.status === 'pending').length;
  const failed = tasks.filter((t) => t.status === 'failed').length;
  const workingAgents = agents.filter((a) => a.status === 'working').length;
  const errorLogs = logs.filter((l) => l.level === 'error').length;

  const summary = {
    timestamp: new Date().toISOString(),
    fleet: {
      agents: agents.length,
      working: workingAgents,
      idle: agents.filter((a) => a.status === 'idle').length,
      avgLoad: Math.round((agents.reduce((s, a) => s + a.load, 0) / (agents.length || 1)) * 10) / 10,
      avgSuccess: Math.round((agents.reduce((s, a) => s + a.successRate, 0) / (agents.length || 1)) * 10) / 10,
    },
    tasks: { total: tasks.length, completed, inProgress, pending, failed, completionRate: tasks.length ? Math.round((completed / tasks.length) * 100) : 0 },
    revenue: payments._sum.amount ?? 0,
    activity: { logs: logs.length, errors: errorLogs, comms, skillRuns, memory },
    topTasks: tasks.slice(0, 5).map((t) => ({ title: t.title, status: t.status, priority: t.priority, assignee: t.assignee?.codename ?? 'unassigned' })),
    recentLogs: logs.slice(0, 8).map((l) => ({ agent: l.agent?.codename ?? '?', level: l.level, message: l.message })),
  };

  const prompt = `You are JARVIS. Generate a concise daily fleet operations report in markdown based on this state:
${JSON.stringify(summary, null, 2)}

Format:
## Fleet Daily Report — ${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}

### Executive Summary
(2-3 sentences on overall fleet health and key outcomes)

### Key Metrics
- Fleet: X agents (Y working, Z idle), avg load A%, avg success B%
- Tasks: X total (C completed, P in progress, F failed) — CR% completion rate
- Revenue: ₹X confirmed
- Activity: X logs (Y errors), Z comms, W skill runs

### Priority Tasks
(brief list of top 3 tasks with assignees)

### Issues & Risks
(any errors, overloaded agents, or blockers — if none, state "No active issues")

### Recommendations
(2-3 actionable next steps)

Keep it under 300 words. Be operational and direct.`;

  try {
    return await quickChat(prompt, 'You are JARVIS, generating a fleet operations report. Be concise and operational.');
  } catch (e) {
    return `## Fleet Daily Report — ${new Date().toLocaleDateString()}\n\n*(GLM-4.6 report generation failed: ${e instanceof Error ? e.message : 'unknown'})*\n\n### Raw Summary\n- Fleet: ${summary.fleet.agents} agents (${summary.fleet.working} working), avg load ${summary.fleet.avgLoad}%\n- Tasks: ${summary.tasks.total} total, ${summary.tasks.completionRate}% completion\n- Revenue: ₹${summary.revenue}\n- Errors: ${summary.activity.errors}`;
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { email, reportContent, generate } = body as {
    email?: unknown;
    reportContent?: unknown;
    generate?: unknown;
  };

  // ── Validate email ──────────────────────────────────────────────
  if (typeof email !== 'string' || !isValidEmail(email.trim())) {
    return NextResponse.json(
      { ok: false, error: 'A valid email address is required' },
      { status: 400 },
    );
  }
  const recipient = email.trim();

  // ── Resolve report content ──────────────────────────────────────
  let content: string;
  if (generate === true) {
    try {
      content = await generateDailyReport();
    } catch (e) {
      console.error('[reports/email] generation failed:', e);
      return NextResponse.json(
        { ok: false, error: 'Failed to generate report content' },
        { status: 500 },
      );
    }
  } else if (typeof reportContent === 'string' && reportContent.trim().length > 0) {
    content = reportContent;
  } else {
    return NextResponse.json(
      { ok: false, error: 'Either reportContent (non-empty string) or generate:true is required' },
      { status: 400 },
    );
  }

  if (content.length > REPORT_MAX_LEN) {
    content = content.slice(0, REPORT_MAX_LEN) + '\n\n*(report truncated for email)*';
  }

  const subject = `JARVIS Fleet Daily Report — ${new Date().toLocaleDateString()}`;
  const sentAt = new Date().toISOString();

  // ── Stub delivery: console log ─────────────────────────────────
  // SMTP is not configured in the sandbox — log the email so it's
  // visible in dev.log / server stdout for verification.
  console.log(
    '[reports/email] STUB EMAIL — would send to:',
    recipient,
    '\n  subject:',
    subject,
    '\n  sentAt:',
    sentAt,
    '\n  content (first 500 chars):',
    content.slice(0, 500),
  );

  // ── Stub delivery: persist to Notification(type='email') ───────
  // This gives us a queryable audit trail of every "email" we'd have
  // sent, viewable from the existing Notifications tab + API.
  let emailLogId: string | null = null;
  try {
    const log = await db.notification.create({
      data: {
        type: 'email',
        title: `${subject} → ${recipient}`,
        message: content,
        read: false,
      },
    });
    emailLogId = log.id;
  } catch (e) {
    // Persistence failure is non-fatal — the console log already happened.
    console.error('[reports/email] failed to persist EmailLog notification:', e);
  }

  return NextResponse.json({
    ok: true,
    message: 'Email queued (stub — no SMTP configured)',
    emailLogId,
    recipient,
    subject,
    sentAt,
    contentLength: content.length,
  });
}
