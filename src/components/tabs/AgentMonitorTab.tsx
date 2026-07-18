'use client';

// =====================================================================
// AgentMonitorTab — User Action Tracking + Agent Monitoring command center.
// =====================================================================
// Surfaces:
//   1. Header with "Run All Monitors" + last-run time + summary counts.
//   2. Monitor registry grid — one card per monitor agent (8 total).
//   3. High-Priority Findings panel — open critical/error findings.
//   4. All Findings table — filterable by status/severity/tab/monitor.
//   5. User Activity Stats — last 24h actions by type, top tabs, errors.
//
// Polls /api/agent-monitors, /api/agent-monitors/findings, and
// /api/user-actions/stats every 15s. Uses JARVIS design tokens + framer-motion.
// =====================================================================

import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ShieldCheck, Play, RefreshCw, AlertTriangle, Activity, Clock,
  Zap, CheckCircle2, XCircle, Eye, EyeOff, ChevronRight, Cpu,
  Bot, MessageSquare, CalendarClock, Wallet, Brain, Gauge,
  Filter, ListChecks, Sparkles, ArrowRight, FileText, AlertOctagon,
} from 'lucide-react';
import { JARVIS } from '@/lib/config';
import { useApi, postJson, patchJson } from '@/lib/hooks/use-api';
import { useTabNav } from '@/lib/nav-store';
import { useToast } from '@/hooks/use-toast';
import { SectionTitle, StatCard, EmptyState, Pill, TimeAgo } from '@/components/jarvis/shared';
import { Button } from '@/components/ui/button';

// ─── Types ───────────────────────────────────────────────────────────

interface MonitorInfo {
  key: string;
  name: string;
  description: string;
  intervalMs: number;
  lastRun: { ranAt: string; durationMs: number; findingsCreated: number; ok: boolean } | null;
  openFindings: number;
}

interface MonitorsResponse {
  monitors: MonitorInfo[];
  summary: {
    totalMonitors: number;
    totalOpenFindings: number;
    criticalOpen: number;
    errorOpen: number;
  };
  sampledAt: string;
}

interface Finding {
  id: string;
  monitorKey: string;
  tab: string;
  severity: string;
  category: string;
  title: string;
  detail: string;
  evidence: Record<string, unknown>;
  suggestedAction: string | null;
  actionTab: string | null;
  actionMeta: Record<string, unknown>;
  status: string;
  linkedTaskId: string | null;
  createdAt: string;
  updatedAt: string;
}

interface FindingsResponse {
  findings: Finding[];
  total: number;
  count: number;
  filters: Record<string, unknown>;
}

interface UserActionStats {
  window: string;
  total: number;
  errorCount: number;
  errorRate: number;
  byType: Record<string, number>;
  byTab: Record<string, number>;
  bySeverity: Record<string, number>;
  topTabs: Array<{ tab: string; count: number }>;
  sampledAt: string;
}

interface RunAllResponse {
  ok: boolean;
  ranAt: string;
  summary: { totalMonitors: number; findingsCreated: number; findingsDeduped: number; failedCount: number };
}

// ─── Constants ───────────────────────────────────────────────────────

const SEVERITY_COLORS: Record<string, string> = {
  info: JARVIS.colors.cyan,
  warn: JARVIS.colors.amber,
  error: JARVIS.colors.red,
  critical: JARVIS.colors.red,
};

const STATUS_COLORS: Record<string, string> = {
  open: JARVIS.colors.amber,
  acknowledged: JARVIS.colors.cyan,
  resolved: JARVIS.colors.green,
  dismissed: JARVIS.colors.textMute,
};

const MONITOR_ICONS: Record<string, typeof Bot> = {
  'fleet-watchdog': Bot,
  'api-sentinel': Zap,
  'health-monitor': Gauge,
  'task-watcher': ListChecks,
  'comm-watcher': MessageSquare,
  'cron-monitor': CalendarClock,
  'payment-monitor': Wallet,
  'model-watchdog': Brain,
};

const ACTION_TYPE_ICONS: Record<string, typeof Activity> = {
  navigate: ArrowRight,
  click: Activity,
  submit: CheckCircle2,
  toggle: Zap,
  create: Sparkles,
  delete: XCircle,
  error: AlertTriangle,
  search: Filter,
  command: FileText,
};

const POLL_MS = 15000;

// ─── Component ───────────────────────────────────────────────────────

export default function AgentMonitorTab() {
  const navigate = useTabNav();
  const { toast } = useToast();

  const [running, setRunning] = useState(false);
  const [filterMonitor, setFilterMonitor] = useState<string>('all');
  const [filterSeverity, setFilterSeverity] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('open');
  const [filterTab, setFilterTab] = useState<string>('all');

  const monitorsUrl = '/api/agent-monitors';
  const findingsUrl = useMemo(() => {
    const sp = new URLSearchParams();
    if (filterStatus !== 'all') sp.set('status', filterStatus);
    if (filterSeverity !== 'all') sp.set('severity', filterSeverity);
    if (filterTab !== 'all') sp.set('tab', filterTab);
    if (filterMonitor !== 'all') sp.set('monitorKey', filterMonitor);
    sp.set('limit', '200');
    return `/api/agent-monitors/findings?${sp.toString()}`;
  }, [filterStatus, filterSeverity, filterTab, filterMonitor]);

  const { data: monitorsData, loading: monitorsLoading, refresh: refreshMonitors } =
    useApi<MonitorsResponse>(monitorsUrl, POLL_MS);
  const { data: findingsData, loading: findingsLoading, refresh: refreshFindings } =
    useApi<FindingsResponse>(findingsUrl, POLL_MS);
  const { data: statsData, refresh: refreshStats } = useApi<UserActionStats>(
    '/api/user-actions/stats',
    POLL_MS,
  );

  const monitors = monitorsData?.monitors ?? [];
  const allFindings = findingsData?.findings ?? [];
  const highPriority = allFindings
    .filter((f) => (f.severity === 'critical' || f.severity === 'error') && f.status === 'open')
    .slice(0, 12);
  const summary = monitorsData?.summary;

  // ── Actions ──────────────────────────────────────────────────────

  async function runAllMonitors() {
    setRunning(true);
    try {
      const result = await postJson<RunAllResponse>('/api/agent-monitors', {});
      toast({
        title: 'Monitors swept',
        description: `${result.summary.findingsCreated} new finding(s), ${result.summary.findingsDeduped} deduped, ${result.summary.failedCount} failed.`,
      });
      refreshMonitors();
      refreshFindings();
    } catch (err) {
      toast({
        title: 'Run failed',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setRunning(false);
    }
  }

  async function runSingleMonitor(key: string) {
    setRunning(true);
    try {
      const result = await postJson<{ ok: boolean; findingsCreated: number; findingsDeduped: number; error?: string }>(
        `/api/agent-monitors/${key}`,
        {},
      );
      if (result.ok) {
        toast({
          title: `${key} ran`,
          description: `${result.findingsCreated} new finding(s), ${result.findingsDeduped} deduped.`,
        });
      } else {
        toast({
          title: `${key} failed`,
          description: result.error ?? 'Unknown error',
          variant: 'destructive',
        });
      }
      refreshMonitors();
      refreshFindings();
    } catch (err) {
      toast({
        title: 'Run failed',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setRunning(false);
    }
  }

  async function acknowledgeFinding(id: string) {
    try {
      await patchJson(`/api/agent-monitors/findings/${id}`, { status: 'acknowledged' });
      toast({ title: 'Finding acknowledged' });
      refreshFindings();
      refreshMonitors();
    } catch (err) {
      toast({
        title: 'Failed',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  }

  async function dismissFinding(id: string) {
    try {
      await patchJson(`/api/agent-monitors/findings/${id}`, { status: 'dismissed' });
      toast({ title: 'Finding dismissed' });
      refreshFindings();
      refreshMonitors();
    } catch (err) {
      toast({
        title: 'Failed',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  }

  async function resolveFinding(id: string) {
    try {
      await patchJson(`/api/agent-monitors/findings/${id}`, { status: 'resolved' });
      toast({ title: 'Finding resolved' });
      refreshFindings();
      refreshMonitors();
    } catch (err) {
      toast({
        title: 'Failed',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  }

  async function createTaskFromFinding(id: string, title: string) {
    try {
      const result = await postJson<{ ok: boolean; task?: { id: string }; error?: string }>(
        `/api/agent-monitors/findings/${id}/create-task`,
        {},
      );
      if (result.ok && result.task) {
        toast({
          title: 'Task created',
          description: `"${title.slice(0, 60)}" → Tasks tab.`,
        });
        refreshFindings();
        refreshMonitors();
      } else {
        toast({
          title: 'Failed',
          description: result.error ?? 'Unknown error',
          variant: 'destructive',
        });
      }
    } catch (err) {
      toast({
        title: 'Failed',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  }

  function takeAction(f: Finding) {
    if (f.actionTab) {
      navigate(f.actionTab, (f.actionMeta as Record<string, string | number | boolean | undefined>) ?? {});
    } else {
      toast({ title: 'No action configured', description: f.title });
    }
  }

  // ── Render ───────────────────────────────────────────────────────

  return (
    <div className="space-y-5">
      {/* ── Header ── */}
      <div className="jarvis-panel p-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div
              className="flex h-10 w-10 items-center justify-center rounded-lg"
              style={{ background: `${JARVIS.colors.red}1a`, border: `1px solid ${JARVIS.colors.red}33`, color: JARVIS.colors.red }}
            >
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <h1 className="jarvis-mono text-lg uppercase tracking-widest text-[var(--j-text)]">Agent Monitors</h1>
              <p className="text-xs text-[var(--j-text-dim)]">
                {summary
                  ? `${summary.totalMonitors} monitors · ${summary.totalOpenFindings} open findings · ${summary.criticalOpen} critical · ${summary.errorOpen} errors`
                  : 'Loading monitor registry…'}
                {monitorsData && (
                  <span className="ml-2">· updated <TimeAgo date={monitorsData.sampleedAt} /></span>
                )}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => { refreshMonitors(); refreshFindings(); refreshStats(); }}
              disabled={running}
              className="jarvis-mono uppercase text-[10px] gap-1.5"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${running ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
            <Button
              size="sm"
              onClick={runAllMonitors}
              disabled={running}
              className="jarvis-mono uppercase text-[10px] gap-1.5"
              style={{ background: `${JARVIS.colors.red}1a`, border: `1px solid ${JARVIS.colors.red}66`, color: JARVIS.colors.red }}
            >
              {running ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
              Run All Monitors
            </Button>
          </div>
        </div>
      </div>

      {/* ── Summary stat cards ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          label="Monitors"
          value={summary?.totalMonitors ?? '—'}
          sub="registered agents"
          icon={ShieldCheck}
          accent={JARVIS.colors.cyan}
        />
        <StatCard
          label="Open Findings"
          value={summary?.totalOpenFindings ?? '—'}
          sub="awaiting action"
          icon={ListChecks}
          accent={JARVIS.colors.amber}
        />
        <StatCard
          label="Critical"
          value={summary?.criticalOpen ?? '—'}
          sub="severity=critical"
          icon={AlertOctagon}
          accent={JARVIS.colors.red}
        />
        <StatCard
          label="User Actions (24h)"
          value={statsData?.total ?? '—'}
          sub={`${statsData?.errorCount ?? 0} errors`}
          icon={Activity}
          accent={JARVIS.colors.violet}
        />
      </div>

      {/* ── Monitor registry grid ── */}
      <section>
        <SectionTitle
          title="Monitor Registry"
          icon={ShieldCheck}
          accent={JARVIS.colors.cyan}
          action={
            <span className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">
              {monitors.length} monitors
            </span>
          }
        />
        {monitorsLoading && monitors.length === 0 ? (
          <div className="jarvis-panel p-6 text-center text-[var(--j-text-mute)] text-xs jarvis-mono uppercase">
            Loading monitors…
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            {monitors.map((m) => {
              const Icon = MONITOR_ICONS[m.key] ?? Cpu;
              const lastRanAt = m.lastRun?.ranAt;
              const accent =
                m.openFindings > 0
                  ? JARVIS.colors.amber
                  : m.lastRun?.ok === false
                    ? JARVIS.colors.red
                    : JARVIS.colors.green;
              return (
                <motion.div
                  key={m.key}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="jarvis-panel p-3 cursor-pointer transition-all hover:ring-1 hover:ring-[var(--j-cyan)]/40"
                  onClick={() => setFilterMonitor(m.key === filterMonitor ? 'all' : m.key)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setFilterMonitor(m.key === filterMonitor ? 'all' : m.key); } }}
                >
                  <div className="flex items-start justify-between mb-2">
                    <div
                      className="flex h-8 w-8 items-center justify-center rounded-md"
                      style={{ background: `${accent}1a`, border: `1px solid ${accent}33`, color: accent }}
                    >
                      <Icon className="h-4 w-4" />
                    </div>
                    {m.openFindings > 0 && (
                      <Pill color={JARVIS.colors.amber}>{m.openFindings} open</Pill>
                    )}
                  </div>
                  <div className="text-sm font-semibold text-[var(--j-text)]">{m.name}</div>
                  <div className="text-[10px] jarvis-mono uppercase text-[var(--j-text-mute)] mt-0.5">{m.key}</div>
                  <p className="text-xs text-[var(--j-text-dim)] mt-2 line-clamp-3" title={m.description}>
                    {m.description}
                  </p>
                  <div className="mt-3 flex items-center justify-between text-[10px] jarvis-mono uppercase text-[var(--j-text-mute)]">
                    <span>every {Math.round(m.intervalMs / 60000)}m</span>
                    {lastRanAt ? (
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        <TimeAgo date={lastRanAt} />
                      </span>
                    ) : (
                      <span>never run</span>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={(e) => { e.stopPropagation(); runSingleMonitor(m.key); }}
                    disabled={running}
                    className="mt-2 w-full jarvis-mono uppercase text-[10px] gap-1.5"
                  >
                    <Play className="h-3 w-3" /> Run Now
                  </Button>
                </motion.div>
              );
            })}
          </div>
        )}
      </section>

      {/* ── High-Priority Findings panel ── */}
      <section>
        <SectionTitle
          title="High-Priority Findings"
          icon={AlertTriangle}
          accent={JARVIS.colors.red}
          action={
            <span className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">
              {highPriority.length} critical/error
            </span>
          }
        />
        {highPriority.length === 0 ? (
          <div className="jarvis-panel">
            <EmptyState icon={CheckCircle2} message="No critical or error findings — fleet looks healthy" />
          </div>
        ) : (
          <div className="space-y-2 max-h-[28rem] overflow-y-auto pr-1 j-scroll">
            <AnimatePresence>
              {highPriority.map((f) => {
                const color = SEVERITY_COLORS[f.severity] ?? JARVIS.colors.cyan;
                return (
                  <motion.div
                    key={f.id}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 8 }}
                    className="jarvis-panel p-3"
                    style={{ borderLeft: `3px solid ${color}` }}
                  >
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Pill color={color}>{f.severity}</Pill>
                        <Pill color={JARVIS.colors.violet}>{f.monitorKey}</Pill>
                        <Pill color={JARVIS.colors.cyan}>{f.tab}</Pill>
                        <Pill color={JARVIS.colors.textMute}>{f.category}</Pill>
                      </div>
                      <TimeAgo date={f.createdAt} />
                    </div>
                    <div className="text-sm font-semibold text-[var(--j-text)]">{f.title}</div>
                    <p className="text-xs text-[var(--j-text-dim)] mt-1 line-clamp-3">{f.detail}</p>
                    <div className="mt-3 flex items-center gap-1.5 flex-wrap">
                      {f.actionTab && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => takeAction(f)}
                          className="jarvis-mono uppercase text-[10px] gap-1"
                          style={{ color: JARVIS.colors.cyan, borderColor: `${JARVIS.colors.cyan}44` }}
                        >
                          <ArrowRight className="h-3 w-3" /> Take Action → {f.actionTab}
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => createTaskFromFinding(f.id, f.title)}
                        disabled={Boolean(f.linkedTaskId)}
                        className="jarvis-mono uppercase text-[10px] gap-1"
                        style={{ color: JARVIS.colors.amber, borderColor: `${JARVIS.colors.amber}44` }}
                      >
                        {f.linkedTaskId ? <CheckCircle2 className="h-3 w-3" /> : <ListChecks className="h-3 w-3" />}
                        {f.linkedTaskId ? 'Task Linked' : 'Create Task'}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => acknowledgeFinding(f.id)}
                        className="jarvis-mono uppercase text-[10px] gap-1"
                        style={{ color: JARVIS.colors.cyan, borderColor: `${JARVIS.colors.cyan}44` }}
                      >
                        <Eye className="h-3 w-3" /> Acknowledge
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => dismissFinding(f.id)}
                        className="jarvis-mono uppercase text-[10px] gap-1"
                        style={{ color: JARVIS.colors.textMute, borderColor: `${JARVIS.colors.textMute}44` }}
                      >
                        <EyeOff className="h-3 w-3" /> Dismiss
                      </Button>
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        )}
      </section>

      {/* ── All Findings table ── */}
      <section>
        <SectionTitle
          title="All Findings"
          icon={ListChecks}
          accent={JARVIS.colors.amber}
          action={
            <span className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">
              {findingsData?.total ?? 0} total
            </span>
          }
        />
        <div className="jarvis-panel p-3">
          {/* Filters */}
          <div className="flex items-center gap-2 flex-wrap mb-3">
            <Filter className="h-3.5 w-3.5 text-[var(--j-text-mute)]" />
            <FilterSelect label="Status" value={filterStatus} onChange={setFilterStatus}
              options={['all', 'open', 'acknowledged', 'resolved', 'dismissed']} />
            <FilterSelect label="Severity" value={filterSeverity} onChange={setFilterSeverity}
              options={['all', 'info', 'warn', 'error', 'critical']} />
            <FilterSelect label="Tab" value={filterTab} onChange={setFilterTab}
              options={['all', 'fleet', 'tasks', 'comms', 'scheduler', 'payments', 'models', 'telemetry', 'logs', 'agent-monitor']} />
            <FilterSelect label="Monitor" value={filterMonitor} onChange={setFilterMonitor}
              options={['all', ...monitors.map((m) => m.key)]} />
            <Button
              size="sm"
              variant="ghost"
              onClick={() => { setFilterStatus('open'); setFilterSeverity('all'); setFilterTab('all'); setFilterMonitor('all'); }}
              className="jarvis-mono uppercase text-[10px] ml-auto"
            >
              Reset
            </Button>
          </div>

          {/* Table */}
          {findingsLoading && allFindings.length === 0 ? (
            <div className="text-center py-6 text-[var(--j-text-mute)] text-xs jarvis-mono uppercase">
              Loading findings…
            </div>
          ) : allFindings.length === 0 ? (
            <EmptyState icon={CheckCircle2} message="No findings match the current filters" />
          ) : (
            <div className="max-h-[28rem] overflow-y-auto j-scroll">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-[var(--j-bg-soft)] z-10">
                  <tr className="text-left jarvis-mono uppercase text-[10px] text-[var(--j-text-mute)]">
                    <th className="px-2 py-2">Sev</th>
                    <th className="px-2 py-2">Monitor</th>
                    <th className="px-2 py-2">Tab</th>
                    <th className="px-2 py-2">Title</th>
                    <th className="px-2 py-2">Age</th>
                    <th className="px-2 py-2">Status</th>
                    <th className="px-2 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {allFindings.map((f) => {
                    const color = SEVERITY_COLORS[f.severity] ?? JARVIS.colors.cyan;
                    const statusColor = STATUS_COLORS[f.status] ?? JARVIS.colors.textMute;
                    return (
                      <tr key={f.id} className="border-t border-[var(--j-border-soft)] hover:bg-[var(--j-panel-soft)]">
                        <td className="px-2 py-2">
                          <span
                            className="jarvis-mono text-[9px] uppercase px-1.5 py-0.5 rounded"
                            style={{ color, background: `${color}1a`, border: `1px solid ${color}33` }}
                          >
                            {f.severity}
                          </span>
                        </td>
                        <td className="px-2 py-2 jarvis-mono text-[10px] text-[var(--j-text-dim)]">{f.monitorKey}</td>
                        <td className="px-2 py-2 text-[var(--j-text-dim)]">{f.tab}</td>
                        <td className="px-2 py-2 text-[var(--j-text)] max-w-[20rem] truncate" title={f.detail}>
                          {f.title}
                          {f.linkedTaskId && (
                            <span className="ml-2 text-[9px] uppercase jarvis-mono text-[var(--j-green)]">task linked</span>
                          )}
                        </td>
                        <td className="px-2 py-2 text-[var(--j-text-mute)]">
                          <TimeAgo date={f.createdAt} />
                        </td>
                        <td className="px-2 py-2">
                          <span
                            className="jarvis-mono text-[9px] uppercase px-1.5 py-0.5 rounded"
                            style={{ color: statusColor, background: `${statusColor}1a`, border: `1px solid ${statusColor}33` }}
                          >
                            {f.status}
                          </span>
                        </td>
                        <td className="px-2 py-2 text-right">
                          <div className="inline-flex gap-1">
                            {f.actionTab && (
                              <button
                                onClick={() => takeAction(f)}
                                title={`Go to ${f.actionTab}`}
                                className="p-1 rounded hover:bg-[var(--j-panel)]"
                                style={{ color: JARVIS.colors.cyan }}
                              >
                                <ArrowRight className="h-3 w-3" />
                              </button>
                            )}
                            <button
                              onClick={() => createTaskFromFinding(f.id, f.title)}
                              disabled={Boolean(f.linkedTaskId)}
                              title="Create task"
                              className="p-1 rounded hover:bg-[var(--j-panel)] disabled:opacity-40"
                              style={{ color: JARVIS.colors.amber }}
                            >
                              <ListChecks className="h-3 w-3" />
                            </button>
                            {f.status === 'open' && (
                              <button
                                onClick={() => acknowledgeFinding(f.id)}
                                title="Acknowledge"
                                className="p-1 rounded hover:bg-[var(--j-panel)]"
                                style={{ color: JARVIS.colors.cyan }}
                              >
                                <Eye className="h-3 w-3" />
                              </button>
                            )}
                            {f.status !== 'resolved' && f.status !== 'dismissed' && (
                              <button
                                onClick={() => resolveFinding(f.id)}
                                title="Resolve"
                                className="p-1 rounded hover:bg-[var(--j-panel)]"
                                style={{ color: JARVIS.colors.green }}
                              >
                                <CheckCircle2 className="h-3 w-3" />
                              </button>
                            )}
                            {f.status === 'open' && (
                              <button
                                onClick={() => dismissFinding(f.id)}
                                title="Dismiss"
                                className="p-1 rounded hover:bg-[var(--j-panel)]"
                                style={{ color: JARVIS.colors.textMute }}
                              >
                                <EyeOff className="h-3 w-3" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      {/* ── User Activity Stats ── */}
      <section>
        <SectionTitle
          title="User Activity (Last 24h)"
          icon={Activity}
          accent={JARVIS.colors.violet}
          action={
            <span className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">
              sampled <TimeAgo date={statsData?.sampledAt ?? Date.now()} />
            </span>
          }
        />
        {!statsData ? (
          <div className="jarvis-panel p-6 text-center text-[var(--j-text-mute)] text-xs jarvis-mono uppercase">
            Loading activity stats…
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {/* By type */}
            <div className="jarvis-panel p-4">
              <div className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)] mb-3">Actions by Type</div>
              {Object.keys(statsData.byType).length === 0 ? (
                <div className="text-xs text-[var(--j-text-mute)] py-4 text-center">No actions recorded yet</div>
              ) : (
                <div className="space-y-2">
                  {Object.entries(statsData.byType)
                    .sort((a, b) => b[1] - a[1])
                    .map(([type, count]) => {
                      const Icon = ACTION_TYPE_ICONS[type] ?? Activity;
                      const color = type === 'error' ? JARVIS.colors.red : type === 'navigate' ? JARVIS.colors.cyan : JARVIS.colors.violet;
                      const pct = statsData.total > 0 ? (count / statsData.total) * 100 : 0;
                      return (
                        <div key={type} className="flex items-center gap-2">
                          <Icon className="h-3.5 w-3.5 shrink-0" style={{ color }} />
                          <span className="jarvis-mono text-[10px] uppercase text-[var(--j-text-dim)] w-16">{type}</span>
                          <div className="flex-1 h-1.5 bg-[var(--j-border-soft)] rounded overflow-hidden">
                            <div className="h-full rounded" style={{ width: `${pct}%`, background: color }} />
                          </div>
                          <span className="jarvis-mono text-[10px] text-[var(--j-text)] w-8 text-right">{count}</span>
                        </div>
                      );
                    })}
                </div>
              )}
            </div>

            {/* Top tabs */}
            <div className="jarvis-panel p-4">
              <div className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)] mb-3">Top Visited Tabs</div>
              {statsData.topTabs.length === 0 ? (
                <div className="text-xs text-[var(--j-text-mute)] py-4 text-center">No navigations yet</div>
              ) : (
                <div className="space-y-2">
                  {statsData.topTabs.map((t, i) => {
                    const maxCount = statsData.topTabs[0]?.count ?? 1;
                    const pct = (t.count / maxCount) * 100;
                    return (
                      <button
                        key={t.tab}
                        onClick={() => navigate(t.tab)}
                        className="w-full flex items-center gap-2 group"
                      >
                        <span className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)] w-4">{i + 1}.</span>
                        <span className="jarvis-mono text-[10px] uppercase text-[var(--j-text-dim)] w-20 group-hover:text-[var(--j-cyan)] truncate">{t.tab}</span>
                        <div className="flex-1 h-1.5 bg-[var(--j-border-soft)] rounded overflow-hidden">
                          <div className="h-full rounded" style={{ width: `${pct}%`, background: JARVIS.colors.cyan }} />
                        </div>
                        <span className="jarvis-mono text-[10px] text-[var(--j-text)] w-8 text-right">{t.count}</span>
                        <ChevronRight className="h-3 w-3 text-[var(--j-text-mute)] group-hover:text-[var(--j-cyan)]" />
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Error stats */}
            <div className="jarvis-panel p-4">
              <div className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)] mb-3">Error Profile</div>
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div className="text-center">
                  <div className="text-2xl font-semibold" style={{ color: statsData.errorCount > 0 ? JARVIS.colors.red : JARVIS.colors.green }}>
                    {statsData.errorCount}
                  </div>
                  <div className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)] mt-1">errors</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-semibold" style={{ color: statsData.errorRate > 10 ? JARVIS.colors.red : JARVIS.colors.green }}>
                    {statsData.errorRate.toFixed(1)}%
                  </div>
                  <div className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)] mt-1">error rate</div>
                </div>
              </div>
              <div className="space-y-1.5">
                {(['critical', 'error', 'warn', 'info'] as const).map((sev) => {
                  const count = statsData.bySeverity[sev] ?? 0;
                  const color = SEVERITY_COLORS[sev] ?? JARVIS.colors.textMute;
                  const pct = statsData.total > 0 ? (count / statsData.total) * 100 : 0;
                  return (
                    <div key={sev} className="flex items-center gap-2">
                      <span className="jarvis-mono text-[10px] uppercase w-12" style={{ color }}>{sev}</span>
                      <div className="flex-1 h-1.5 bg-[var(--j-border-soft)] rounded overflow-hidden">
                        <div className="h-full rounded" style={{ width: `${pct}%`, background: color }} />
                      </div>
                      <span className="jarvis-mono text-[10px] text-[var(--j-text)] w-8 text-right">{count}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

// ─── Inline filter select ────────────────────────────────────────────

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  return (
    <label className="flex items-center gap-1.5">
      <span className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="jarvis-mono text-[10px] uppercase bg-[var(--j-bg-soft)] border border-[var(--j-border)] rounded px-2 py-1 text-[var(--j-text)] focus:outline-none focus:border-[var(--j-cyan)]"
      >
        {options.map((opt) => (
          <option key={opt} value={opt}>{opt}</option>
        ))}
      </select>
    </label>
  );
}
