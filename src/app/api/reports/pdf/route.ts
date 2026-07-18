import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { quickChat } from '@/lib/llm';
import { JARVIS } from '@/lib/config';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// GET /api/reports/pdf — returns a print-friendly HTML document for the daily fleet report.
// Opens in a new tab; user can Ctrl+P (or click the on-page button) to save as PDF.
export async function GET() {
  // Gather fleet state — same shape as /api/reports/daily.
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
  const idleAgents = agents.filter((a) => a.status === 'idle').length;
  const errorLogs = logs.filter((l) => l.level === 'error').length;

  const summary = {
    timestamp: new Date().toISOString(),
    fleet: {
      agents: agents.length,
      working: workingAgents,
      idle: idleAgents,
      avgLoad: Math.round((agents.reduce((s, a) => s + a.load, 0) / (agents.length || 1)) * 10) / 10,
      avgSuccess: Math.round((agents.reduce((s, a) => s + a.successRate, 0) / (agents.length || 1)) * 10) / 10,
    },
    tasks: { total: tasks.length, completed, inProgress, pending, failed, completionRate: tasks.length ? Math.round((completed / tasks.length) * 100) : 0 },
    revenue: payments._sum.amount ?? 0,
    activity: { logs: logs.length, errors: errorLogs, comms, skillRuns, memory },
    topTasks: tasks.slice(0, 5).map((t) => ({ title: t.title, status: t.status, priority: t.priority, assignee: t.assignee?.codename ?? 'unassigned', progress: t.progress })),
    recentLogs: logs.slice(0, 8).map((l) => ({ agent: l.agent?.codename ?? '?', level: l.level, message: l.message, time: l.createdAt.toISOString() })),
  };

  const reportDate = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const reportTime = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

  // Have GLM-4.6 generate the narrative report.
  const prompt = `You are JARVIS. Generate a concise daily fleet operations report in markdown based on this state:
${JSON.stringify(summary, null, 2)}

Format:
## Fleet Daily Report — ${reportDate}

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

  let report: string;
  try {
    report = await quickChat(prompt, 'You are JARVIS, generating a fleet operations report. Be concise and operational.');
  } catch (e) {
    report = `## Fleet Daily Report — ${reportDate}\n\n*(GLM-4.6 report generation failed: ${e instanceof Error ? e.message : 'unknown'})*\n\n### Raw Summary\n- Fleet: ${summary.fleet.agents} agents (${summary.fleet.working} working), avg load ${summary.fleet.avgLoad}%\n- Tasks: ${summary.tasks.total} total, ${summary.tasks.completionRate}% completion\n- Revenue: ₹${summary.revenue}\n- Errors: ${summary.activity.errors}`;
  }

  // Convert markdown report → simple HTML.
  const reportHtml = markdownToHtml(report);

  // Build agent table rows.
  const agentRows = agents
    .map((a) => {
      const statusColor = a.status === 'working' ? JARVIS.colors.green : a.status === 'idle' ? JARVIS.colors.cyan : a.status === 'error' ? JARVIS.colors.red : JARVIS.colors.textMute;
      return `<tr>
        <td>${escapeHtml(a.codename)}</td>
        <td>${escapeHtml(a.role)}</td>
        <td><span class="status-pill" style="color:${statusColor};border-color:${statusColor}">${escapeHtml(a.status)}</span></td>
        <td class="mono">${a.load}%</td>
        <td class="mono">${a.successRate}%</td>
        <td class="mono">${a.taskCount}</td>
        <td>${escapeHtml(a.model)}</td>
      </tr>`;
    })
    .join('\n');

  // Build task summary table rows.
  const taskRows = summary.topTasks
    .map((t) => {
      const prioColor = t.priority === 'critical' ? JARVIS.colors.red : t.priority === 'high' ? JARVIS.colors.amber : t.priority === 'medium' ? JARVIS.colors.cyan : JARVIS.colors.textMute;
      const statusColor = t.status === 'completed' ? JARVIS.colors.green : t.status === 'in_progress' ? JARVIS.colors.cyan : t.status === 'failed' ? JARVIS.colors.red : JARVIS.colors.textMute;
      return `<tr>
        <td>${escapeHtml(t.title)}</td>
        <td><span class="status-pill" style="color:${statusColor};border-color:${statusColor}">${escapeHtml(t.status)}</span></td>
        <td><span class="status-pill" style="color:${prioColor};border-color:${prioColor}">${escapeHtml(t.priority)}</span></td>
        <td>${escapeHtml(t.assignee)}</td>
        <td class="mono">${t.progress}%</td>
      </tr>`;
    })
    .join('\n');

  // Build recent log rows.
  const logRows = summary.recentLogs
    .map((l) => {
      const lvlColor = l.level === 'error' ? JARVIS.colors.red : l.level === 'warn' ? JARVIS.colors.amber : l.level === 'success' ? JARVIS.colors.green : JARVIS.colors.cyan;
      return `<tr>
        <td class="mono">${escapeHtml(l.agent)}</td>
        <td><span class="status-pill" style="color:${lvlColor};border-color:${lvlColor}">${escapeHtml(l.level)}</span></td>
        <td>${escapeHtml(l.message)}</td>
        <td class="mono">${new Date(l.time).toLocaleTimeString()}</td>
      </tr>`;
    })
    .join('\n');

  const generatedAt = new Date().toISOString();

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>JARVIS Fleet Daily Report — ${reportDate}</title>
<style>
  @page { size: A4; margin: 14mm 12mm; }
  * { box-sizing: border-box; }
  html, body {
    margin: 0; padding: 0;
    background: ${JARVIS.colors.bg};
    color: ${JARVIS.colors.text};
    font-family: 'JetBrains Mono', 'SF Mono', 'Menlo', 'Consolas', ui-monospace, monospace;
    font-size: 11px;
    line-height: 1.55;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .page { max-width: 210mm; margin: 0 auto; padding: 18px 20px 40px; }
  .mono { font-family: inherit; }

  /* Header */
  .report-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 14px 16px; margin-bottom: 18px;
    background: linear-gradient(135deg, ${JARVIS.colors.bgSoft} 0%, ${JARVIS.colors.panel} 100%);
    border: 1px solid ${JARVIS.colors.border};
    border-radius: 8px;
    position: relative; overflow: hidden;
  }
  .report-header::before {
    content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 3px;
    background: linear-gradient(180deg, ${JARVIS.colors.cyan}, ${JARVIS.colors.violet});
  }
  .brand { display: flex; align-items: center; gap: 12px; }
  .brand-logo {
    width: 36px; height: 36px; border-radius: 8px;
    background: linear-gradient(135deg, ${JARVIS.colors.cyanDim}, ${JARVIS.colors.violet});
    display: flex; align-items: center; justify-content: center;
    color: ${JARVIS.colors.bg}; font-weight: 800; font-size: 14px;
    box-shadow: 0 0 16px ${JARVIS.colors.cyan}44;
  }
  .brand-text .name { font-size: 14px; font-weight: 700; color: ${JARVIS.colors.text}; letter-spacing: 2px; }
  .brand-text .tag { font-size: 9px; color: ${JARVIS.colors.textMute}; text-transform: uppercase; letter-spacing: 1.5px; margin-top: 2px; }
  .report-meta { text-align: right; }
  .report-meta .label { font-size: 8px; color: ${JARVIS.colors.textMute}; text-transform: uppercase; letter-spacing: 1.5px; }
  .report-meta .value { font-size: 11px; color: ${JARVIS.colors.cyan}; margin-top: 2px; }
  .report-meta .sub { font-size: 9px; color: ${JARVIS.colors.textDim}; margin-top: 1px; }

  /* Print button — only on screen */
  .print-bar {
    display: flex; gap: 10px; justify-content: flex-end; margin-bottom: 16px;
  }
  .print-bar button {
    background: ${JARVIS.colors.cyan}; color: ${JARVIS.colors.bg};
    border: 0; border-radius: 6px; padding: 8px 16px;
    font-family: inherit; font-size: 10px; font-weight: 700;
    text-transform: uppercase; letter-spacing: 1.5px; cursor: pointer;
    box-shadow: 0 0 12px ${JARVIS.colors.cyan}55;
  }
  .print-bar button.secondary {
    background: transparent; color: ${JARVIS.colors.textDim};
    border: 1px solid ${JARVIS.colors.border}; box-shadow: none;
  }
  @media print { .print-bar { display: none; } .report-header { box-shadow: none; } }

  /* Section */
  h2.section {
    font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 2px;
    color: ${JARVIS.colors.cyan}; margin: 22px 0 10px 0;
    padding-bottom: 6px; border-bottom: 1px solid ${JARVIS.colors.border};
    display: flex; align-items: center; gap: 8px;
  }
  h2.section::before {
    content: ''; display: inline-block; width: 6px; height: 6px; border-radius: 50%;
    background: ${JARVIS.colors.cyan}; box-shadow: 0 0 8px ${JARVIS.colors.cyan};
  }

  /* KPI grid */
  .kpi-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; margin-bottom: 18px; }
  .kpi { padding: 10px 12px; background: ${JARVIS.colors.bgSoft}; border: 1px solid ${JARVIS.colors.border}; border-radius: 6px; text-align: center; }
  .kpi .label { font-size: 8px; color: ${JARVIS.colors.textMute}; text-transform: uppercase; letter-spacing: 1.5px; }
  .kpi .value { font-size: 18px; font-weight: 700; margin-top: 4px; }
  .kpi .sub { font-size: 8px; color: ${JARVIS.colors.textDim}; margin-top: 2px; }

  /* AI narrative report */
  .ai-report {
    padding: 16px; background: ${JARVIS.colors.bgSoft};
    border: 1px solid ${JARVIS.colors.border}; border-radius: 8px;
    position: relative; overflow: hidden;
  }
  .ai-report::before {
    content: 'GLM-4.6'; position: absolute; top: 10px; right: 12px;
    font-size: 8px; color: ${JARVIS.colors.textMute}; letter-spacing: 1.5px;
    border: 1px solid ${JARVIS.colors.border}; padding: 2px 6px; border-radius: 4px;
  }
  .ai-report h2 { color: ${JARVIS.colors.text}; font-size: 14px; margin: 0 0 10px 0; }
  .ai-report h3 { color: ${JARVIS.colors.cyan}; font-size: 11px; margin: 14px 0 6px 0; text-transform: uppercase; letter-spacing: 1px; }
  .ai-report p { margin: 4px 0; color: ${JARVIS.colors.textDim}; }
  .ai-report ul { margin: 4px 0; padding-left: 18px; }
  .ai-report li { margin: 2px 0; color: ${JARVIS.colors.textDim}; }
  .ai-report strong { color: ${JARVIS.colors.text}; }

  /* Tables */
  table { width: 100%; border-collapse: collapse; margin: 8px 0 4px 0; font-size: 10px; }
  thead th {
    text-align: left; padding: 8px 10px;
    background: ${JARVIS.colors.panelSoft}; color: ${JARVIS.colors.textMute};
    font-size: 8px; text-transform: uppercase; letter-spacing: 1.5px; font-weight: 600;
    border-bottom: 1px solid ${JARVIS.colors.border};
  }
  tbody td { padding: 7px 10px; border-bottom: 1px solid ${JARVIS.colors.borderSoft}; color: ${JARVIS.colors.textDim}; }
  tbody tr:nth-child(even) td { background: ${JARVIS.colors.bgSoft}; }
  tbody tr:hover td { background: ${JARVIS.colors.panelSoft}; }
  .status-pill {
    display: inline-block; padding: 1px 7px; border-radius: 10px;
    font-size: 8px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px;
    border: 1px solid; background: transparent;
  }

  /* Footer */
  .report-footer {
    margin-top: 26px; padding-top: 12px; border-top: 1px solid ${JARVIS.colors.border};
    display: flex; justify-content: space-between; align-items: center;
    font-size: 8px; color: ${JARVIS.colors.textMute}; text-transform: uppercase; letter-spacing: 1.5px;
  }
  .report-footer .seal { color: ${JARVIS.colors.cyan}; }

  /* Avoid breaking inside rows */
  tr, .kpi, .ai-report { page-break-inside: avoid; }
  h2.section { page-break-after: avoid; }
</style>
</head>
<body>
  <div class="page">
    <div class="print-bar">
      <button class="secondary" onclick="window.close()">Close</button>
      <button onclick="window.print()">Save as PDF</button>
    </div>

    <div class="report-header">
      <div class="brand">
        <div class="brand-logo">J</div>
        <div class="brand-text">
          <div class="name">JARVIS MISSION CONTROL</div>
          <div class="tag">Fleet Daily Operations Report · v${JARVIS.version}</div>
        </div>
      </div>
      <div class="report-meta">
        <div class="label">Report Date</div>
        <div class="value">${reportDate}</div>
        <div class="sub">${reportTime} · ${escapeHtml(summary.fleet.working + '/' + summary.fleet.agents)} agents active</div>
      </div>
    </div>

    <h2 class="section">Fleet Snapshot</h2>
    <div class="kpi-grid">
      <div class="kpi">
        <div class="label">Agents</div>
        <div class="value" style="color:${JARVIS.colors.cyan}">${summary.fleet.working}/${summary.fleet.agents}</div>
        <div class="sub">${summary.fleet.idle} idle · ${summary.fleet.avgLoad}% avg load</div>
      </div>
      <div class="kpi">
        <div class="label">Task Completion</div>
        <div class="value" style="color:${JARVIS.colors.green}">${summary.tasks.completionRate}%</div>
        <div class="sub">${summary.tasks.completed}/${summary.tasks.total} done</div>
      </div>
      <div class="kpi">
        <div class="label">Revenue</div>
        <div class="value" style="color:${JARVIS.colors.amber}">₹${summary.revenue.toLocaleString()}</div>
        <div class="sub">confirmed</div>
      </div>
      <div class="kpi">
        <div class="label">Comms</div>
        <div class="value" style="color:${JARVIS.colors.violet}">${summary.activity.comms}</div>
        <div class="sub">messages</div>
      </div>
      <div class="kpi">
        <div class="label">Errors</div>
        <div class="value" style="color:${summary.activity.errors > 0 ? JARVIS.colors.red : JARVIS.colors.green}">${summary.activity.errors}</div>
        <div class="sub">log errors</div>
      </div>
    </div>

    <h2 class="section">AI Operations Report</h2>
    <div class="ai-report">
      ${reportHtml}
    </div>

    <h2 class="section">Agent Fleet Roster</h2>
    <table>
      <thead>
        <tr>
          <th>Codename</th><th>Role</th><th>Status</th><th>Load</th><th>Success</th><th>Tasks</th><th>Model</th>
        </tr>
      </thead>
      <tbody>
        ${agentRows || `<tr><td colspan="7" style="text-align:center;color:${JARVIS.colors.textMute};padding:16px">No agents in fleet</td></tr>`}
      </tbody>
    </table>

    <h2 class="section">Priority Tasks</h2>
    <table>
      <thead>
        <tr>
          <th>Title</th><th>Status</th><th>Priority</th><th>Assignee</th><th>Progress</th>
        </tr>
      </thead>
      <tbody>
        ${taskRows || `<tr><td colspan="5" style="text-align:center;color:${JARVIS.colors.textMute};padding:16px">No tasks</td></tr>`}
      </tbody>
    </table>

    <h2 class="section">Recent Agent Logs</h2>
    <table>
      <thead>
        <tr>
          <th>Agent</th><th>Level</th><th>Message</th><th>Time</th>
        </tr>
      </thead>
      <tbody>
        ${logRows || `<tr><td colspan="4" style="text-align:center;color:${JARVIS.colors.textMute};padding:16px">No recent logs</td></tr>`}
      </tbody>
    </table>

    <div class="report-footer">
      <span>Generated by JARVIS · GLM-4.6 Engine · ${new Date(generatedAt).toLocaleString()}</span>
      <span class="seal">◆ AUTHENTIC · v${JARVIS.version}</span>
    </div>
  </div>

  <script>
    // Auto-trigger print dialog after a short delay so user can save as PDF immediately.
    (function() {
      var auto = new URLSearchParams(window.location.search).get('print');
      if (auto === '1') {
        setTimeout(function() { try { window.print(); } catch(e) {} }, 400);
      }
    })();
  </script>
</body>
</html>`;

  return new NextResponse(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

// Minimal, safe markdown → HTML converter (headings, lists, paragraphs, bold/italic, code).
function markdownToHtml(md: string): string {
  const lines = md.split('\n');
  const out: string[] = [];
  let inList = false;
  let inPara: string[] = [];

  const flushPara = () => {
    if (inPara.length) {
      out.push(`<p>${inline(inPara.join(' '))}</p>`);
      inPara = [];
    }
  };
  const closeList = () => {
    if (inList) { out.push('</ul>'); inList = false; }
  };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (/^##\s+/.test(line)) {
      flushPara(); closeList();
      out.push(`<h2>${inline(line.replace(/^##\s+/, ''))}</h2>`);
    } else if (/^###\s+/.test(line)) {
      flushPara(); closeList();
      out.push(`<h3>${inline(line.replace(/^###\s+/, ''))}</h3>`);
    } else if (/^#\s+/.test(line)) {
      flushPara(); closeList();
      out.push(`<h2>${inline(line.replace(/^#\s+/, ''))}</h2>`);
    } else if (/^[-*]\s+/.test(line)) {
      flushPara();
      if (!inList) { out.push('<ul>'); inList = true; }
      out.push(`<li>${inline(line.replace(/^[-*]\s+/, ''))}</li>`);
    } else if (line.trim() === '') {
      flushPara(); closeList();
    } else {
      closeList();
      inPara.push(line);
    }
  }
  flushPara(); closeList();
  return out.join('\n');
}

function inline(s: string): string {
  return escapeHtml(s)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
    .replace(/`([^`]+)`/g, '<code style="background:#121821;padding:1px 4px;border-radius:3px;font-size:10px">$1</code>');
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
