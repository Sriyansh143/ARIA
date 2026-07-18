'use client';

import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  HeartPulse, ShieldCheck, Activity, Cpu, Database, CalendarClock,
  Zap, AlertTriangle, RefreshCw, Wrench, Server, HardDrive, Clock,
  Power, ChevronUp, ChevronDown, Sparkles, ArrowRight, Bot,
} from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';
import { useApi, postJson } from '@/lib/hooks/use-api';
import { JARVIS, STATUS_COLORS, LEVEL_COLORS, timeAgo } from '@/lib/config';
import {
  SectionTitle, StatCard, RadialGauge, StatusDot, Pill, EmptyState, TimeAgo,
} from '@/components/jarvis/shared';
import { useTabNav } from '@/lib/nav-store';
import { useToast } from '@/hooks/use-toast';

// ─── Types matching the /api/health response ──────────────────────────
interface Check {
  key: string;
  label: string;
  ok: boolean;
  severity: 'ok' | 'warn' | 'fail';
  detail: string;
  fixAction?: string;
  fixTarget?: string;
}
interface AgentRow {
  id: string;
  codename: string;
  name: string;
  role: string;
  status: string;
  load: number;
  successRate: number;
  lastActive: string;
  logCount: number;
  recentErrors: number;
  healthScore: number;
}
interface Incident {
  id: string;
  type: 'log' | 'fallback';
  level: string;
  agent?: string;
  message: string;
  createdAt: string;
}
interface ProviderRow {
  id: string;
  key: string;
  name: string;
  model: string;
  enabled: boolean;
  latency: number;
  tokens: number;
  lastError: string | null;
}
interface Remediation {
  id: string;
  action: 'restart-agent' | 'enable-provider' | 'disable-provider' | 'run-selfheal' | 'clear-logs';
  target?: string;
  label: string;
  severity: 'warn' | 'fail';
}
interface Health {
  overall: string;
  healthScore: number;
  lastUpdated: string;
  summary: {
    agentCount: number;
    avgSuccess: number;
    avgLoad: number;
    counts: Record<string, number>;
    errorAgents: number;
    activeProviders: number;
    totalProviders: number;
    fallbackEvents: number;
    recoveredFallbacks: number;
    memoryItems: number;
    memorySizeBytes: number;
    enabledCrons: number;
    totalCrons: number;
    staleCrons: number;
    incidentCount: number;
  };
  system: {
    cpu: number;
    mem: number;
    disk: number;
    net: number;
    latency: number;
    tokens: number;
    uptime: number;
  };
  checks: Check[];
  agents: AgentRow[];
  incidents: Incident[];
  providers: ProviderRow[];
  cron: {
    total: number;
    enabled: number;
    stale: number;
    jobs: Array<{
      id: string;
      key: string;
      name: string;
      enabled: boolean;
      schedule: string;
      lastRun: string | null;
      runCount: number;
      stale: boolean;
    }>;
  };
  remediation: Remediation[];
}

// ─── Status meta ──────────────────────────────────────────────────────
const OVERALL_META: Record<string, { color: string; label: string; desc: string }> = {
  operational: { color: JARVIS.colors.green, label: 'OPERATIONAL', desc: 'All systems nominal. No incidents detected.' },
  degraded: { color: JARVIS.colors.amber, label: 'DEGRADED', desc: 'Some systems are under strain. Monitoring closely.' },
  critical: { color: JARVIS.colors.red, label: 'CRITICAL', desc: 'Active incidents detected. Immediate attention required.' },
};

const SEVERITY_META: Record<Check['severity'], { color: string; label: string }> = {
  ok: { color: JARVIS.colors.green, label: 'OK' },
  warn: { color: JARVIS.colors.amber, label: 'WARN' },
  fail: { color: JARVIS.colors.red, label: 'FAIL' },
};

const CHECK_ICONS: Record<string, typeof Cpu> = {
  'agent-fleet': Activity,
  'ai-provider': Zap,
  'memory-store': Database,
  'cron-scheduler': CalendarClock,
  'self-heal': HeartPulse,
  'fallback-recovery': ShieldCheck,
};

// ─── Helpers ──────────────────────────────────────────────────────────
function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function scoreColor(score: number): string {
  if (score >= 80) return JARVIS.colors.green;
  if (score >= 60) return JARVIS.colors.cyan;
  if (score >= 40) return JARVIS.colors.amber;
  return JARVIS.colors.red;
}

type SortKey = 'healthScore' | 'codename' | 'load' | 'successRate' | 'recentErrors' | 'lastActive';

// ─── Component ────────────────────────────────────────────────────────
export default function HealthTab() {
  const { data, loading, refresh } = useApi<Health>('/api/health', 12000);
  const navigate = useTabNav();
  const { toast } = useToast();

  const [sortKey, setSortKey] = useState<SortKey>('healthScore');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [busy, setBusy] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const sortedAgents = useMemo(() => {
    if (!data?.agents) return [];
    const arr = [...data.agents];
    arr.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'healthScore': cmp = a.healthScore - b.healthScore; break;
        case 'codename': cmp = a.codename.localeCompare(b.codename); break;
        case 'load': cmp = a.load - b.load; break;
        case 'successRate': cmp = a.successRate - b.successRate; break;
        case 'recentErrors': cmp = a.recentErrors - b.recentErrors; break;
        case 'lastActive': cmp = new Date(a.lastActive).getTime() - new Date(b.lastActive).getTime(); break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return arr;
  }, [data?.agents, sortKey, sortDir]);

  if (loading && !data) return <div className="jarvis-panel h-48 animate-pulse" />;
  if (!data) return <div className="text-[var(--j-text-mute)] text-sm">No health data.</div>;

  const meta = OVERALL_META[data.overall] ?? OVERALL_META.operational;
  const scoreClr = scoreColor(data.healthScore);

  const statusColors: Record<string, string> = {
    working: JARVIS.colors.green,
    thinking: JARVIS.colors.violet,
    idle: JARVIS.colors.cyan,
    error: JARVIS.colors.red,
    offline: JARVIS.colors.textMute,
  };
  const pieData = Object.entries(data.summary.counts).map(([k, v]) => ({
    name: k, value: v, color: statusColors[k] ?? JARVIS.colors.textDim,
  }));

  // ─── Apply a single remediation action ───
  const applyRemediation = async (r: Remediation) => {
    setPendingId(r.id);
    try {
      const res = await postJson<{ ok: boolean; message: string }>(
        '/api/health/remediate',
        { action: r.action, target: r.target },
      );
      toast({ title: res.ok ? 'Remediation Applied' : 'Remediation Failed', description: res.message });
      refresh();
    } catch (e) {
      toast({
        title: 'Remediation Failed',
        description: e instanceof Error ? e.message : 'Unknown error',
      });
    } finally {
      setPendingId(null);
    }
  };

  // ─── Run all suggested remediation actions in sequence ───
  const autoRemediate = async () => {
    if (!data.remediation.length) {
      toast({ title: 'Nothing to Remediate', description: 'No suggested actions.' });
      return;
    }
    setBusy(true);
    let ok = 0, fail = 0;
    for (const r of data.remediation) {
      setPendingId(r.id);
      try {
        const res = await postJson<{ ok: boolean; message: string }>(
          '/api/health/remediate',
          { action: r.action, target: r.target },
        );
        if (res.ok) ok++; else fail++;
      } catch {
        fail++;
      }
    }
    setPendingId(null);
    setBusy(false);
    toast({
      title: 'Auto-Remediation Complete',
      description: `${ok} succeeded · ${fail} failed`,
    });
    refresh();
  };

  // ─── Toggle a provider via the remediate endpoint ───
  const toggleProvider = async (p: ProviderRow) => {
    setPendingId(`provider-${p.key}`);
    const action = p.enabled ? 'disable-provider' : 'enable-provider';
    try {
      const res = await postJson<{ ok: boolean; message: string }>(
        '/api/health/remediate',
        { action, target: p.key },
      );
      toast({ title: res.ok ? 'Provider Updated' : 'Update Failed', description: res.message });
      refresh();
    } catch (e) {
      toast({
        title: 'Toggle Failed',
        description: e instanceof Error ? e.message : 'Unknown error',
      });
    } finally {
      setPendingId(null);
    }
  };

  // ─── Run a single check fix ───
  const applyCheckFix = async (c: Check) => {
    if (!c.fixAction) return;
    setPendingId(`check-${c.key}`);
    try {
      const res = await postJson<{ ok: boolean; message: string }>(
        '/api/health/remediate',
        { action: c.fixAction, target: c.fixTarget },
      );
      toast({ title: res.ok ? 'Fix Applied' : 'Fix Failed', description: res.message });
      refresh();
    } catch (e) {
      toast({
        title: 'Fix Failed',
        description: e instanceof Error ? e.message : 'Unknown error',
      });
    } finally {
      setPendingId(null);
    }
  };

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('desc'); }
  };

  return (
    <div className="space-y-4">
      <SectionTitle
        title="Fleet Health Command Center"
        icon={HeartPulse}
        accent={JARVIS.colors.green}
        action={
          <div className="flex items-center gap-2">
            <button
              onClick={refresh}
              className="jarvis-mono text-[10px] uppercase px-2.5 py-1.5 rounded-md flex items-center gap-1.5 border border-[var(--j-border)] hover:border-[var(--j-cyan)] hover:text-[var(--j-cyan)] transition-colors"
            >
              <RefreshCw className="h-3 w-3" /> Run Health Check
            </button>
            <button
              onClick={autoRemediate}
              disabled={busy || !data.remediation.length}
              className="jarvis-mono text-[10px] uppercase px-2.5 py-1.5 rounded-md flex items-center gap-1.5 border border-[var(--j-amber)]/40 text-[var(--j-amber)] hover:bg-[var(--j-amber)]/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <Wrench className="h-3 w-3" /> Auto-Remediate ({data.remediation.length})
            </button>
          </div>
        }
      />

      {/* ─── Top hero: overall status + health gauge + key stats ─── */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="jarvis-panel jarvis-scan p-6 relative overflow-hidden"
      >
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto_auto] gap-6 items-center">
          {/* Overall status */}
          <div>
            <div className="flex items-center gap-2.5 mb-2">
              <span
                className="h-3 w-3 rounded-full jarvis-blink"
                style={{ background: meta.color, boxShadow: `0 0 12px ${meta.color}` }}
              />
              <span className="jarvis-mono text-lg font-bold" style={{ color: meta.color }}>
                {meta.label}
              </span>
              <span className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)]">
                · updated <TimeAgo date={data.lastUpdated} />
              </span>
            </div>
            <p className="text-sm text-[var(--j-text-dim)] max-w-md">{meta.desc}</p>

            {/* Counts strip */}
            <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
              <CountChip label="Agents" value={data.summary.agentCount} color={JARVIS.colors.cyan} />
              <CountChip label="Errors" value={data.summary.errorAgents} color={JARVIS.colors.red} />
              <CountChip label="Providers" value={`${data.summary.activeProviders}/${data.summary.totalProviders}`} color={JARVIS.colors.violet} />
              <CountChip label="Incidents" value={data.summary.incidentCount} color={JARVIS.colors.amber} />
            </div>
          </div>

          {/* Health score gauge */}
          <div className="flex flex-col items-center">
            <RadialGauge
              value={data.healthScore}
              label="Fleet Score"
              size={140}
              color={scoreClr}
            />
          </div>

          {/* Status pie + avg stats */}
          <div className="flex items-center gap-4">
            <div className="h-32 w-32">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={32} outerRadius={56} paddingAngle={3}>
                    {pieData.map((d, i) => (
                      <Cell key={i} fill={d.color} stroke="#0E1218" strokeWidth={2} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="space-y-1.5">
              <div className="text-center">
                <div className="text-xl font-bold" style={{ color: JARVIS.colors.green }}>
                  {data.summary.avgSuccess}%
                </div>
                <div className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)]">avg success</div>
              </div>
              <div className="text-center">
                <div className="text-xl font-bold" style={{ color: JARVIS.colors.cyan }}>
                  {Math.round(data.summary.avgLoad)}%
                </div>
                <div className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)]">avg load</div>
              </div>
            </div>
          </div>
        </div>
      </motion.div>

      {/* ─── System resources row (4 mini cards → telemetry tab) ─── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <ResourceMini icon={Cpu} label="CPU" value={`${Math.round(data.system.cpu)}%`} pct={data.system.cpu} accent={JARVIS.colors.cyan} onClick={() => navigate('telemetry')} />
        <ResourceMini icon={Server} label="Memory" value={`${Math.round(data.system.mem)}%`} pct={data.system.mem} accent={JARVIS.colors.violet} onClick={() => navigate('telemetry')} />
        <ResourceMini icon={HardDrive} label="Disk" value={`${Math.round(data.system.disk)}%`} pct={data.system.disk} accent={JARVIS.colors.amber} onClick={() => navigate('telemetry')} />
        <ResourceMini icon={Clock} label="Uptime" value={formatUptime(data.system.uptime)} accent={JARVIS.colors.green} onClick={() => navigate('telemetry')} />
      </div>

      {/* ─── Health checks grid ─── */}
      <div className="jarvis-panel p-4">
        <SectionTitle title="System Health Checks" icon={ShieldCheck} accent={JARVIS.colors.green} />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {data.checks.map((c) => {
            const sev = SEVERITY_META[c.severity];
            const Icon = CHECK_ICONS[c.key] ?? Cpu;
            const isPending = pendingId === `check-${c.key}`;
            return (
              <div
                key={c.key}
                className="rounded-md border p-3 transition-colors"
                style={{
                  borderColor: `${sev.color}33`,
                  background: `${sev.color}0d`,
                }}
              >
                <div className="flex items-start gap-3">
                  <div
                    className="flex h-8 w-8 items-center justify-center rounded-md shrink-0"
                    style={{ background: `${sev.color}1a`, border: `1px solid ${sev.color}33`, color: sev.color }}
                  >
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <div className="jarvis-mono text-[10px] uppercase tracking-wider text-[var(--j-text)]">
                        {c.label}
                      </div>
                      <Pill color={sev.color}>{sev.label}</Pill>
                    </div>
                    <div className="jarvis-mono text-[10px] text-[var(--j-text-mute)] mt-1">
                      {c.detail}
                    </div>
                    {c.fixAction && (
                      <button
                        onClick={() => applyCheckFix(c)}
                        disabled={isPending}
                        className="mt-2 jarvis-mono text-[9px] uppercase px-2 py-1 rounded border border-[var(--j-amber)]/40 text-[var(--j-amber)] hover:bg-[var(--j-amber)]/10 disabled:opacity-40 flex items-center gap-1 transition-colors"
                      >
                        {isPending ? <RefreshCw className="h-2.5 w-2.5 animate-spin" /> : <Wrench className="h-2.5 w-2.5" />}
                        Fix
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ─── Per-agent health table + Incident timeline ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-[1.5fr_1fr] gap-4">
        {/* Agent table */}
        <div className="jarvis-panel p-4">
          <SectionTitle title="Per-Agent Health" icon={Bot} accent={JARVIS.colors.cyan} />
          <div className="overflow-x-auto max-h-[420px] overflow-y-auto jarvis-scroll">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-[var(--j-panel)] z-10">
                <tr className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)]">
                  <th className="text-left py-2 px-2">
                    <SortButton label="Agent" k="codename" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                  </th>
                  <th className="text-left py-2 px-2">Status</th>
                  <th className="text-right py-2 px-2">
                    <SortButton label="Score" k="healthScore" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                  </th>
                  <th className="text-right py-2 px-2">
                    <SortButton label="Load" k="load" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                  </th>
                  <th className="text-right py-2 px-2">
                    <SortButton label="Succ%" k="successRate" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                  </th>
                  <th className="text-right py-2 px-2">
                    <SortButton label="Errs" k="recentErrors" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                  </th>
                  <th className="text-right py-2 px-2">
                    <SortButton label="Active" k="lastActive" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedAgents.map((a) => (
                  <tr
                    key={a.id}
                    onClick={() => navigate('fleet', { agentId: a.id })}
                    className="border-t border-[var(--j-border-soft)] cursor-pointer hover:bg-[var(--j-cyan)]/5 transition-colors"
                  >
                    <td className="py-2 px-2">
                      <div className="jarvis-mono text-[11px] text-[var(--j-text)] font-semibold">{a.codename}</div>
                      <div className="text-[10px] text-[var(--j-text-mute)] truncate max-w-[160px]">{a.role}</div>
                    </td>
                    <td className="py-2 px-2">
                      <div className="flex items-center gap-1.5">
                        <StatusDot status={a.status as never} size={7} />
                        <span className="jarvis-mono text-[9px] uppercase text-[var(--j-text-dim)]">{a.status}</span>
                      </div>
                    </td>
                    <td className="py-2 px-2 text-right">
                      <div className="inline-flex items-center gap-1.5 justify-end">
                        <div className="h-1.5 w-12 rounded-full bg-[var(--j-border)] overflow-hidden">
                          <div
                            className="h-full rounded-full"
                            style={{ width: `${a.healthScore}%`, background: scoreColor(a.healthScore) }}
                          />
                        </div>
                        <span className="jarvis-mono text-[10px]" style={{ color: scoreColor(a.healthScore) }}>
                          {a.healthScore}
                        </span>
                      </div>
                    </td>
                    <td className="py-2 px-2 text-right jarvis-mono text-[10px] text-[var(--j-text-dim)]">{a.load}%</td>
                    <td className="py-2 px-2 text-right jarvis-mono text-[10px] text-[var(--j-text-dim)]">{a.successRate}%</td>
                    <td className="py-2 px-2 text-right">
                      <span
                        className="jarvis-mono text-[10px]"
                        style={{ color: a.recentErrors > 0 ? JARVIS.colors.red : JARVIS.colors.textMute }}
                      >
                        {a.recentErrors}
                      </span>
                    </td>
                    <td className="py-2 px-2 text-right jarvis-mono text-[10px] text-[var(--j-text-mute)]">
                      {timeAgo(a.lastActive)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Incident timeline */}
        <div className="jarvis-panel p-4">
          <SectionTitle title="Incident Timeline" icon={AlertTriangle} accent={JARVIS.colors.amber} />
          <div className="max-h-[420px] overflow-y-auto jarvis-scroll pr-1">
            {data.incidents.length === 0 ? (
              <EmptyState icon={ShieldCheck} message="No recent incidents" />
            ) : (
              <ol className="relative pl-4">
                {data.incidents.map((inc, idx) => {
                  const color = LEVEL_COLORS[inc.level] ?? JARVIS.colors.textDim;
                  return (
                    <li key={inc.id} className="relative pb-3 last:pb-0">
                      <span
                        className="absolute -left-4 top-1 h-2 w-2 rounded-full"
                        style={{ background: color, boxShadow: `0 0 6px ${color}` }}
                      />
                      {idx < data.incidents.length - 1 && (
                        <span className="absolute -left-[11px] top-3 bottom-0 w-px bg-[var(--j-border)]" />
                      )}
                      <div className="flex items-start gap-2 ml-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span
                              className="jarvis-mono text-[9px] uppercase px-1.5 py-0.5 rounded"
                              style={{ color, background: `${color}1a`, border: `1px solid ${color}33` }}
                            >
                              {inc.level}
                            </span>
                            {inc.agent && (
                              <span className="jarvis-mono text-[9px] uppercase text-[var(--j-text-dim)]">
                                {inc.agent}
                              </span>
                            )}
                            <span className="jarvis-mono text-[9px] text-[var(--j-text-mute)] ml-auto">
                              {timeAgo(inc.createdAt)}
                            </span>
                          </div>
                          <div className="text-[11px] text-[var(--j-text)] mt-1 line-clamp-2">
                            {inc.message}
                          </div>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        </div>
      </div>

      {/* ─── Provider health row ─── */}
      <div className="jarvis-panel p-4">
        <SectionTitle
          title="AI Provider Health"
          icon={Zap}
          accent={JARVIS.colors.violet}
          action={
            <button
              onClick={() => navigate('models')}
              className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)] hover:text-[var(--j-cyan)] flex items-center gap-1 transition-colors"
            >
              Manage <ArrowRight className="h-2.5 w-2.5" />
            </button>
          }
        />
        {data.providers.length === 0 ? (
          <EmptyState icon={Zap} message="No providers registered" />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {data.providers.map((p) => {
              const isPending = pendingId === `provider-${p.key}`;
              const latColor = p.latency < 800 ? JARVIS.colors.green : p.latency < 2000 ? JARVIS.colors.amber : JARVIS.colors.red;
              return (
                <div
                  key={p.id}
                  className="rounded-md border p-3"
                  style={{
                    borderColor: p.enabled ? `${JARVIS.colors.violet}33` : 'var(--j-border)',
                    background: p.enabled ? `${JARVIS.colors.violet}0a` : 'transparent',
                    opacity: p.enabled ? 1 : 0.6,
                  }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="jarvis-mono text-[10px] uppercase text-[var(--j-text)] font-semibold truncate">
                        {p.name}
                      </div>
                      <div className="jarvis-mono text-[9px] text-[var(--j-text-mute)] truncate">
                        {p.key} · {p.model}
                      </div>
                    </div>
                    <button
                      onClick={() => toggleProvider(p)}
                      disabled={isPending}
                      title={p.enabled ? 'Disable' : 'Enable'}
                      className="flex h-6 w-6 items-center justify-center rounded shrink-0 disabled:opacity-40"
                      style={{
                        background: p.enabled ? `${JARVIS.colors.green}1a` : `${JARVIS.colors.textMute}1a`,
                        border: `1px solid ${p.enabled ? JARVIS.colors.green : JARVIS.colors.textMute}33`,
                        color: p.enabled ? JARVIS.colors.green : JARVIS.colors.textMute,
                      }}
                    >
                      {isPending ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Power className="h-3 w-3" />}
                    </button>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <div>
                      <div className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)]">Latency</div>
                      <div className="jarvis-mono text-xs" style={{ color: latColor }}>
                        {p.latency}ms
                      </div>
                    </div>
                    <div>
                      <div className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)]">Tokens</div>
                      <div className="jarvis-mono text-xs text-[var(--j-text-dim)]">
                        {p.tokens.toLocaleString()}
                      </div>
                    </div>
                  </div>
                  {p.lastError && (
                    <div className="mt-2 jarvis-mono text-[9px] text-[var(--j-red)] truncate" title={p.lastError}>
                      ⚠ {p.lastError}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ─── Remediation panel + Cron health ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_1fr] gap-4">
        {/* Remediation panel */}
        <div className="jarvis-panel p-4">
          <SectionTitle
            title="Suggested Remediation"
            icon={Wrench}
            accent={JARVIS.colors.amber}
            action={
              <span className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)]">
                {data.remediation.length} action(s)
              </span>
            }
          />
          {data.remediation.length === 0 ? (
            <EmptyState icon={Sparkles} message="All clear — no remediation needed" />
          ) : (
            <div className="space-y-2 max-h-72 overflow-y-auto jarvis-scroll">
              <AnimatePresence mode="popLayout">
                {data.remediation.map((r) => {
                  const color = r.severity === 'fail' ? JARVIS.colors.red : JARVIS.colors.amber;
                  const isPending = pendingId === r.id;
                  return (
                    <motion.div
                      key={r.id}
                      layout
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 8 }}
                      className="flex items-center gap-3 rounded-md border p-2.5"
                      style={{ borderColor: `${color}33`, background: `${color}0d` }}
                    >
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0" style={{ color }} />
                      <div className="flex-1 min-w-0 text-xs text-[var(--j-text)] truncate">
                        {r.label}
                      </div>
                      <button
                        onClick={() => applyRemediation(r)}
                        disabled={isPending}
                        className="jarvis-mono text-[9px] uppercase px-2 py-1 rounded border shrink-0 disabled:opacity-40 flex items-center gap-1 transition-colors"
                        style={{ borderColor: `${color}66`, color }}
                      >
                        {isPending ? <RefreshCw className="h-2.5 w-2.5 animate-spin" /> : <Wrench className="h-2.5 w-2.5" />}
                        Apply
                      </button>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>
          )}
        </div>

        {/* Cron health */}
        <div className="jarvis-panel p-4">
          <SectionTitle
            title="Cron Scheduler Health"
            icon={CalendarClock}
            accent={JARVIS.colors.cyan}
            action={
              <button
                onClick={() => navigate('scheduler')}
                className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)] hover:text-[var(--j-cyan)] flex items-center gap-1 transition-colors"
              >
                Open <ArrowRight className="h-2.5 w-2.5" />
              </button>
            }
          />
          <div className="grid grid-cols-3 gap-2 mb-3">
            <MiniStat label="Total" value={data.cron.total} color={JARVIS.colors.cyan} />
            <MiniStat label="Enabled" value={data.cron.enabled} color={JARVIS.colors.green} />
            <MiniStat label="Stale" value={data.cron.stale} color={JARVIS.colors.red} />
          </div>
          <div className="space-y-1 max-h-60 overflow-y-auto jarvis-scroll">
            {data.cron.jobs.map((j) => {
              const color = !j.enabled
                ? JARVIS.colors.textMute
                : j.stale
                  ? JARVIS.colors.amber
                  : JARVIS.colors.green;
              return (
                <div
                  key={j.id}
                  className="flex items-center gap-2 py-1.5 px-2 rounded text-xs border-b border-[var(--j-border-soft)] last:border-0"
                >
                  <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: color, boxShadow: `0 0 4px ${color}` }} />
                  <div className="flex-1 min-w-0">
                    <div className="jarvis-mono text-[10px] text-[var(--j-text)] truncate">{j.name}</div>
                    <div className="jarvis-mono text-[9px] text-[var(--j-text-mute)]">{j.schedule}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="jarvis-mono text-[9px] text-[var(--j-text-dim)]">
                      {j.lastRun ? timeAgo(j.lastRun) : 'never'}
                    </div>
                    <div className="jarvis-mono text-[9px] text-[var(--j-text-mute)]">{j.runCount} runs</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────

function CountChip({ label, value, color }: { label: string; value: React.ReactNode; color: string }) {
  return (
    <div className="rounded-md border p-2" style={{ borderColor: `${color}33`, background: `${color}0d` }}>
      <div className="jarvis-mono text-xl font-bold" style={{ color }}>{value}</div>
      <div className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)]">{label}</div>
    </div>
  );
}

function ResourceMini({
  icon: Icon,
  label,
  value,
  pct,
  accent,
  onClick,
}: {
  icon: typeof Cpu;
  label: string;
  value: string;
  pct?: number;
  accent: string;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="jarvis-panel jarvis-card-hover p-3 text-left transition-all hover:border-[var(--j-cyan)] hover:ring-1 hover:ring-[var(--j-cyan)]/40"
    >
      <div className="flex items-center justify-between mb-2">
        <div
          className="flex h-7 w-7 items-center justify-center rounded-md"
          style={{ background: `${accent}1a`, border: `1px solid ${accent}33`, color: accent }}
        >
          <Icon className="h-3.5 w-3.5" />
        </div>
        <ArrowRight className="h-3 w-3 text-[var(--j-text-mute)]" />
      </div>
      <div className="jarvis-mono text-lg font-bold" style={{ color: accent }}>{value}</div>
      <div className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)]">{label}</div>
      {typeof pct === 'number' && (
        <div className="mt-1.5 h-1 rounded-full bg-[var(--j-border)] overflow-hidden">
          <div className="h-full rounded-full" style={{ width: `${Math.min(100, pct)}%`, background: accent }} />
        </div>
      )}
    </button>
  );
}

function MiniStat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="rounded-md border p-2 text-center" style={{ borderColor: `${color}33`, background: `${color}0d` }}>
      <div className="jarvis-mono text-lg font-bold" style={{ color }}>{value}</div>
      <div className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)]">{label}</div>
    </div>
  );
}

function SortButton({
  label,
  k,
  sortKey,
  sortDir,
  onClick,
}: {
  label: string;
  k: SortKey;
  sortKey: SortKey;
  sortDir: 'asc' | 'desc';
  onClick: (k: SortKey) => void;
}) {
  const active = sortKey === k;
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(k); }}
      className={`inline-flex items-center gap-1 hover:text-[var(--j-cyan)] transition-colors ${active ? 'text-[var(--j-cyan)]' : ''}`}
    >
      {label}
      {active && (sortDir === 'asc' ? <ChevronUp className="h-2.5 w-2.5" /> : <ChevronDown className="h-2.5 w-2.5" />)}
    </button>
  );
}
