'use client';

import { motion } from 'framer-motion';
import {
  Bot, Zap, Sparkles, Wallet, Activity, Cpu, TrendingUp, ArrowRight,
  ListTodo, Brain, Clock, Server,
} from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, ResponsiveContainer, Tooltip } from 'recharts';
import { useApi } from '@/lib/hooks/use-api';
import { JARVIS, fmtTime } from '@/lib/config';
import { StatCard, SectionTitle, StatusDot, Sparkline, Pill } from '@/components/jarvis/shared';
import { useTabNav } from '@/lib/nav-store';

interface DashboardData {
  stats: {
    agents: number; activeAgents: number; tasks: number; pendingTasks: number;
    skills: number; artifacts: number; cronJobs: number; revenue: number;
    tokens: number; providerLatency: number; memMb: number; uptime: number;
  };
  agents: Array<{ id: string; name: string; codename: string; role: string; status: string; load: number; successRate: number; skills: string }>;
  tasks: Array<{ id: string; title: string; status: string; priority: string; progress: number; assignee?: { codename: string } | null }>;
  notifications: Array<{ id: string; type: string; title: string; message: string; createdAt: string }>;
  memory: Array<{ id: string; scope: string; key: string; value: string; pinned: boolean }>;
  telemetry: Array<{ time: string; cpu: number; mem: number; latency: number; tokens: number }>;
}

export default function OverviewTab() {
  const { data, loading } = useApi<DashboardData>('/api/dashboard', 10000);
  const navigate = useTabNav();

  if (loading && !data) {
    return <div className="grid grid-cols-2 md:grid-cols-4 gap-4">{Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}</div>;
  }
  if (!data) return <div className="text-[var(--j-text-mute)] text-sm">Failed to load dashboard.</div>;

  const { stats } = data;
  const cpuSeries = data.telemetry.map((t) => ({ time: fmtTime(new Date(t.time)), cpu: t.cpu, mem: t.mem }));

  return (
    <div className="space-y-5">
      {/* Hero banner */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="jarvis-panel jarvis-scan p-5 md:p-6 relative overflow-hidden"
      >
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="h-2 w-2 rounded-full bg-[var(--j-green)] jarvis-blink" />
              <span className="jarvis-mono text-[10px] uppercase text-[var(--j-green)] tracking-widest">System Operational</span>
            </div>
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
              Welcome back, <span className="jarvis-text-gradient">Operator</span>
            </h1>
            <p className="text-sm text-[var(--j-text-dim)] mt-1 max-w-xl">
              JARVIS is coordinating {stats.agents} agents across {stats.tasks} active tasks. All systems nominal — AI engine online at {stats.providerLatency}ms.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-3 md:gap-4">
            <HeroStat label="Agents" value={stats.agents} accent={JARVIS.colors.cyan} />
            <HeroStat label="Active" value={stats.activeAgents} accent={JARVIS.colors.green} />
            <HeroStat label="Pending" value={stats.pendingTasks} accent={JARVIS.colors.amber} />
          </div>
        </div>
      </motion.div>

      {/* Stat cards — all clickable, deep-link to the relevant tab */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Agent Fleet" value={stats.agents} sub={`${stats.activeAgents} active`} icon={Bot} accent={JARVIS.colors.cyan} delay={0.02} href="fleet" />
        <StatCard label="Tasks" value={stats.tasks} sub={`${stats.pendingTasks} pending`} icon={ListTodo} accent={JARVIS.colors.amber} delay={0.06} href="tasks" />
        <StatCard label="Skills" value={stats.skills} sub="catalog" icon={Sparkles} accent={JARVIS.colors.violet} delay={0.1} href="skills" />
        <StatCard label="Revenue" value={`₹${stats.revenue.toLocaleString()}`} sub="confirmed" icon={Wallet} accent={JARVIS.colors.green} delay={0.14} href="payments" />
      </div>

      {/* Main grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Telemetry chart */}
        <div className="lg:col-span-2 jarvis-panel p-4">
          <SectionTitle title="Live Telemetry" icon={Activity} accent={JARVIS.colors.cyan} action={<Pill>last {data.telemetry.length} pts</Pill>} />
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={cpuSeries} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="cpuGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={JARVIS.colors.cyan} stopOpacity={0.4} />
                    <stop offset="100%" stopColor={JARVIS.colors.cyan} stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="memGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={JARVIS.colors.violet} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={JARVIS.colors.violet} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="time" tick={{ fill: '#64748B', fontSize: 10 }} axisLine={false} tickLine={false} minTickGap={24} />
                <YAxis tick={{ fill: '#64748B', fontSize: 10 }} axisLine={false} tickLine={false} domain={[0, 100]} />
                <Tooltip
                  contentStyle={{ background: '#0E1218', border: '1px solid #1B2330', borderRadius: 8, fontSize: 12 }}
                  labelStyle={{ color: '#94A3B8' }}
                />
                <Area type="monotone" dataKey="cpu" name="CPU %" stroke={JARVIS.colors.cyan} strokeWidth={2} fill="url(#cpuGrad)" />
                <Area type="monotone" dataKey="mem" name="MEM %" stroke={JARVIS.colors.violet} strokeWidth={2} fill="url(#memGrad)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Quick stats / system info — rows clickable to relevant tabs */}
        <div className="jarvis-panel p-4">
          <SectionTitle title="System" icon={Server} accent={JARVIS.colors.green} />
          <div className="space-y-3">
            <InfoRow icon={Cpu} label="Provider Latency" value={`${stats.providerLatency}ms`} color={JARVIS.colors.cyan} href="providers" />
            <InfoRow icon={Zap} label="Tokens Used" value={stats.tokens.toLocaleString()} color={JARVIS.colors.amber} href="telemetry" />
            <InfoRow icon={Brain} label="Memory (RSS)" value={`${stats.memMb} MB`} color={JARVIS.colors.violet} href="memory" />
            <InfoRow icon={Clock} label="Uptime" value={formatUptime(stats.uptime)} color={JARVIS.colors.green} href="health" />
            <InfoRow icon={TrendingUp} label="Artifacts" value={String(stats.artifacts)} color={JARVIS.colors.cyan} href="artifacts" />
            <InfoRow icon={Activity} label="Cron Jobs" value={String(stats.cronJobs)} color={JARVIS.colors.violet} href="scheduler" />
          </div>
        </div>
      </div>

      {/* Agent fleet + recent tasks + notifications */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="jarvis-panel p-4">
          <SectionTitle title="Agent Fleet" icon={Bot} accent={JARVIS.colors.cyan} />
          <div className="space-y-2 max-h-72 overflow-y-auto jarvis-scroll">
            {data.agents.slice(0, 6).map((a) => {
              const spark = Array.from({ length: 12 }, () => Math.max(5, a.load + (Math.random() - 0.5) * 30));
              return (
                <button
                  key={a.id}
                  onClick={() => navigate('fleet', { agentId: a.id, codename: a.codename })}
                  className="flex items-center gap-3 py-1.5 w-full text-left hover:bg-[var(--j-border-soft)] -mx-1 px-1 rounded transition-colors"
                >
                  <StatusDot status={a.status as never} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="jarvis-mono text-xs text-[var(--j-cyan)]">{a.codename}</span>
                      <span className="text-[10px] text-[var(--j-text-mute)] truncate">{a.role}</span>
                    </div>
                  </div>
                  <Sparkline data={spark} color={JARVIS.colors.cyan} width={56} height={18} />
                  <span className="jarvis-mono text-[10px] tabular-nums text-[var(--j-text-dim)] w-9 text-right">{Math.round(a.load)}%</span>
                </button>
              );
            })}
            <button
              onClick={() => navigate('fleet')}
              className="w-full text-center jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)] hover:text-[var(--j-cyan)] py-1.5 border-t border-[var(--j-border-soft)] mt-1"
            >
              View all {stats.agents} agents →
            </button>
          </div>
        </div>

        <div className="jarvis-panel p-4">
          <SectionTitle title="Recent Tasks" icon={ListTodo} accent={JARVIS.colors.amber} />
          <div className="space-y-2 max-h-72 overflow-y-auto jarvis-scroll">
            {data.tasks.map((t) => (
              <button
                key={t.id}
                onClick={() => navigate('tasks', { taskId: t.id, status: t.status })}
                className="py-1.5 w-full text-left hover:bg-[var(--j-border-soft)] -mx-1 px-1 rounded transition-colors block"
              >
                <div className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: statusColor(t.status) }} />
                  <span className="text-xs text-[var(--j-text)] truncate flex-1">{t.title}</span>
                </div>
                <div className="flex items-center gap-2 mt-1 ml-3.5">
                  <span className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)]">{t.status}</span>
                  {t.assignee && <span className="jarvis-mono text-[9px] text-[var(--j-cyan)]">{t.assignee.codename}</span>}
                  {t.status === 'in_progress' && (
                    <div className="flex-1 h-1 rounded-full bg-[var(--j-border)] overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${t.progress}%`, background: JARVIS.colors.amber }} />
                    </div>
                  )}
                </div>
              </button>
            ))}
            <button
              onClick={() => navigate('tasks')}
              className="w-full text-center jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)] hover:text-[var(--j-amber)] py-1.5 border-t border-[var(--j-border-soft)] mt-1"
            >
              View all {stats.tasks} tasks →
            </button>
          </div>
        </div>

        <div className="jarvis-panel p-4">
          <SectionTitle title="Notifications" icon={Activity} accent={JARVIS.colors.green} />
          <div className="space-y-2 max-h-72 overflow-y-auto jarvis-scroll">
            {data.notifications.map((n) => (
              <button
                key={n.id}
                onClick={() => navigate(n.type === 'error' ? 'agent-monitor' : 'activity', { notificationId: n.id })}
                className="py-1.5 border-b border-[var(--j-border-soft)] last:border-0 w-full text-left hover:bg-[var(--j-border-soft)] -mx-1 px-1 rounded transition-colors block"
              >
                <div className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: notifColor(n.type) }} />
                  <span className="text-xs text-[var(--j-text)]">{n.title}</span>
                </div>
                <div className="text-[10px] text-[var(--j-text-dim)] mt-0.5 ml-3.5">{n.message}</div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function HeroStat({ label, value, accent }: { label: string; value: number; accent: string }) {
  return (
    <div className="text-center">
      <div className="text-2xl font-bold" style={{ color: accent }}>{value}</div>
      <div className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)] mt-0.5">{label}</div>
    </div>
  );
}

function InfoRow({ icon: Icon, label, value, color, href }: { icon: typeof Cpu; label: string; value: string; color: string; href?: string }) {
  const navigate = useTabNav();
  const clickable = Boolean(href);
  return (
    <button
      type="button"
      disabled={!clickable}
      onClick={clickable && href ? () => navigate(href!) : undefined}
      className={`flex items-center gap-2.5 w-full text-left ${clickable ? 'hover:bg-[var(--j-border-soft)] -mx-1 px-1 py-0.5 rounded transition-colors cursor-pointer' : 'cursor-default'}`}
    >
      <div className="flex h-7 w-7 items-center justify-center rounded-md shrink-0" style={{ background: `${color}1a`, border: `1px solid ${color}33`, color }}>
        <Icon className="h-3.5 w-3.5" />
      </div>
      <span className="text-xs text-[var(--j-text-dim)] flex-1">{label}</span>
      <span className="jarvis-mono text-xs tabular-nums" style={{ color }}>{value}</span>
      {clickable && <ArrowRight className="h-3 w-3 text-[var(--j-text-mute)] opacity-0 group-hover:opacity-100" />}
    </button>
  );
}

function statusColor(s: string): string {
  switch (s) {
    case 'completed': return JARVIS.colors.green;
    case 'in_progress': return JARVIS.colors.cyan;
    case 'pending': return JARVIS.colors.amber;
    case 'failed': return JARVIS.colors.red;
    default: return JARVIS.colors.textDim;
  }
}

function notifColor(type: string): string {
  switch (type) {
    case 'success': return JARVIS.colors.green;
    case 'warn': return JARVIS.colors.amber;
    case 'error': return JARVIS.colors.red;
    default: return JARVIS.colors.cyan;
  }
}

function formatUptime(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}h ${m}m`;
}

function SkeletonCard() {
  return <div className="jarvis-panel p-4 h-24 animate-pulse" />;
}
