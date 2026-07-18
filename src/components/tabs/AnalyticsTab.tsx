'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { BarChart3, Bot, Target, Zap, MessageSquare, Activity, Trophy, Award, Radio, Calendar, Download } from 'lucide-react';
import { BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, LineChart, Line, Legend } from 'recharts';
import { useApi } from '@/lib/hooks/use-api';
import { JARVIS } from '@/lib/config';
import { SectionTitle, StatCard, Pill, EmptyState } from '@/components/jarvis/shared';

interface PerAgent {
  codename: string; name: string; role: string; status: string; load: number; successRate: number;
  tasks: { total: number; completed: number; inProgress: number; pending: number; failed: number; completionRate: number };
  logs: { total: number; errors: number; successes: number };
  comms: { sent: number; received: number };
}

interface AnalyticsData {
  perAgent: PerAgent[];
  fleet: { totalTasks: number; totalCompleted: number; fleetCompletionRate: number; totalLogs: number; totalComms: number; totalSkillRuns: number; avgLoad: number; avgSuccessRate: number };
  statusDist: Array<{ name: string; value: number; color: string }>;
  skillStats: Array<{ skillKey: string; count: number; successRate: number; avgLatency: number }>;
  topPerformers: PerAgent[];
  mostActive: PerAgent[];
  mostConnected: PerAgent[];
  timeSeries: Array<{ date: string; label: string; tasks: number; logs: number; comms: number; skills: number }>;
  range: string;
}

const TYPE_ICON: Record<string, typeof Bot> = { agent: Bot, task: Target, memory: Activity, comms: MessageSquare, skill: Zap };
const RANGES = ['7d', '30d', 'all'] as const;

export default function AnalyticsTab() {
  const [range, setRange] = useState<(typeof RANGES)[number]>('30d');
  const { data, loading } = useApi<AnalyticsData>(`/api/agents/analytics?range=${range}`, 30000);

  if (loading && !data) {
    return (
      <div className="space-y-4">
        <SectionTitle title="Analytics" icon={BarChart3} accent={JARVIS.colors.cyan} />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="jarvis-panel h-24 animate-pulse" />)}</div>
      </div>
    );
  }
  if (!data) return <div className="text-[var(--j-text-mute)] text-sm">Failed to load analytics.</div>;

  const radarData = data.perAgent.map((a) => ({
    agent: a.codename,
    load: a.load,
    success: a.successRate,
    completion: a.tasks.completionRate,
    activity: Math.min(100, a.logs.total * 2),
    comms: Math.min(100, (a.comms.sent + a.comms.received) * 8),
  }));

  const taskBarData = data.perAgent.map((a) => ({
    name: a.codename,
    completed: a.tasks.completed,
    inProgress: a.tasks.inProgress,
    pending: a.tasks.pending,
    failed: a.tasks.failed,
  }));

  return (
    <div className="space-y-4">
      <SectionTitle title="Agent Performance Analytics" icon={BarChart3} accent={JARVIS.colors.cyan} action={
        <div className="flex items-center gap-2">
          <div className="flex gap-1">
            {RANGES.map((r) => (
              <button key={r} onClick={() => setRange(r)} className={`jarvis-mono text-[9px] uppercase px-2 py-1 rounded transition-colors ${range === r ? 'jarvis-btn-accent border-0' : 'text-[var(--j-text-mute)] hover:text-[var(--j-text)]'}`}>{r}</button>
            ))}
          </div>
          <div className="relative group">
            <button className="jarvis-mono text-[9px] uppercase px-2 py-1 rounded border border-[var(--j-border)] text-[var(--j-text-dim)] hover:text-[var(--j-cyan)] hover:border-[var(--j-cyan)] flex items-center gap-1">
              <Download className="h-3 w-3" /> CSV
            </button>
            <div className="absolute right-0 top-full mt-1 hidden group-hover:block z-20 jarvis-panel p-1 min-w-[140px]">
              {([
                { type: 'perAgent', label: 'Per-Agent' },
                { type: 'skillStats', label: 'Skill Stats' },
                { type: 'timeSeries', label: 'Time Series' },
              ] as const).map((e) => (
                <button key={e.type} onClick={() => window.open(`/api/agents/export?range=${range}&type=${e.type}`, '_blank')} className="w-full text-left text-xs px-2.5 py-1.5 rounded hover:bg-[var(--j-panel-soft)] text-[var(--j-text-dim)] hover:text-[var(--j-cyan)]">
                  {e.label}
                </button>
              ))}
            </div>
          </div>
          <Pill color={JARVIS.colors.green}>{data.perAgent.length} agents</Pill>
        </div>
      } />

      {/* Fleet stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Completion Rate" value={`${data.fleet.fleetCompletionRate}%`} sub={`${data.fleet.totalCompleted}/${data.fleet.totalTasks} tasks`} icon={Target} accent={JARVIS.colors.green} />
        <StatCard label="Avg Success" value={`${data.fleet.avgSuccessRate}%`} sub="fleet-wide" icon={Activity} accent={JARVIS.colors.cyan} />
        <StatCard label="Total Comms" value={data.fleet.totalComms} sub="messages" icon={MessageSquare} accent={JARVIS.colors.violet} />
        <StatCard label="Skill Runs" value={data.fleet.totalSkillRuns} sub={`${data.skillStats.length} skills`} icon={Zap} accent={JARVIS.colors.amber} />
      </div>

      {/* Activity trend over time */}
      {data.timeSeries && data.timeSeries.length > 0 && (
        <div className="jarvis-panel p-4">
          <SectionTitle title="Activity Trend" icon={Calendar} accent={JARVIS.colors.cyan} action={<span className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)]">last {data.range}</span>} />
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data.timeSeries} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1B2330" vertical={false} />
                <XAxis dataKey="label" tick={{ fill: '#64748B', fontSize: 10 }} axisLine={false} tickLine={false} minTickGap={20} />
                <YAxis tick={{ fill: '#64748B', fontSize: 10 }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip contentStyle={{ background: '#0E1218', border: '1px solid #1B2330', borderRadius: 8, fontSize: 12 }} labelStyle={{ color: '#94A3B8' }} />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                <Line type="monotone" dataKey="tasks" name="Tasks" stroke={JARVIS.colors.amber} strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="logs" name="Logs" stroke={JARVIS.colors.cyan} strokeWidth={1.5} dot={false} />
                <Line type="monotone" dataKey="comms" name="Comms" stroke={JARVIS.colors.violet} strokeWidth={1.5} dot={false} />
                <Line type="monotone" dataKey="skills" name="Skills" stroke={JARVIS.colors.green} strokeWidth={1.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Task status pie */}
        <div className="jarvis-panel p-4">
          <SectionTitle title="Task Status Distribution" icon={Target} accent={JARVIS.colors.green} />
          {data.statusDist.length > 0 ? (
            <div className="flex items-center gap-4">
              <div className="h-44 w-44 shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={data.statusDist} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={42} outerRadius={68} paddingAngle={3}>
                      {data.statusDist.map((d, i) => <Cell key={i} fill={d.color} stroke="#0E1218" strokeWidth={2} />)}
                    </Pie>
                    <Tooltip contentStyle={{ background: '#0E1218', border: '1px solid #1B2330', borderRadius: 8, fontSize: 12 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="space-y-2 flex-1">
                {data.statusDist.map((d) => (
                  <div key={d.name} className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full" style={{ background: d.color }} />
                    <span className="jarvis-mono text-[10px] uppercase text-[var(--j-text-dim)] flex-1">{d.name}</span>
                    <span className="jarvis-mono text-xs text-[var(--j-text)]">{d.value}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : <EmptyState icon={Target} message="No tasks" />}
        </div>

        {/* Per-agent task bar chart */}
        <div className="jarvis-panel p-4">
          <SectionTitle title="Tasks per Agent" icon={Bot} accent={JARVIS.colors.cyan} />
          <div className="h-44">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={taskBarData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1B2330" vertical={false} />
                <XAxis dataKey="name" tick={{ fill: '#64748B', fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#64748B', fontSize: 10 }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip contentStyle={{ background: '#0E1218', border: '1px solid #1B2330', borderRadius: 8, fontSize: 12 }} cursor={{ fill: 'rgba(125,211,252,0.05)' }} />
                <Bar dataKey="completed" name="Done" stackId="t" fill={JARVIS.colors.green} />
                <Bar dataKey="inProgress" name="Active" stackId="t" fill={JARVIS.colors.cyan} />
                <Bar dataKey="pending" name="Pending" stackId="t" fill={JARVIS.colors.amber} />
                <Bar dataKey="failed" name="Failed" stackId="t" fill={JARVIS.colors.red} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Agent capability radar */}
      <div className="jarvis-panel p-4">
        <SectionTitle title="Agent Capability Radar" icon={Activity} accent={JARVIS.colors.violet} action={<span className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)]">load · success · completion · activity · comms</span>} />
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <RadarChart data={radarData} outerRadius="75%">
              <PolarGrid stroke="#1B2330" />
              <PolarAngleAxis dataKey="agent" tick={{ fill: '#94A3B8', fontSize: 10 }} />
              <PolarRadiusAxis tick={{ fill: '#64748B', fontSize: 9 }} angle={90} domain={[0, 100]} />
              <Tooltip contentStyle={{ background: '#0E1218', border: '1px solid #1B2330', borderRadius: 8, fontSize: 12 }} />
              <Radar name="Success" dataKey="success" stroke={JARVIS.colors.cyan} fill={JARVIS.colors.cyan} fillOpacity={0.15} strokeWidth={1.5} />
              <Radar name="Completion" dataKey="completion" stroke={JARVIS.colors.green} fill={JARVIS.colors.green} fillOpacity={0.15} strokeWidth={1.5} />
              <Radar name="Activity" dataKey="activity" stroke={JARVIS.colors.amber} fill={JARVIS.colors.amber} fillOpacity={0.1} strokeWidth={1.5} />
            </RadarChart>
          </ResponsiveContainer>
        </div>
        <div className="flex flex-wrap gap-4 justify-center mt-2">
          {[
            { label: 'success', color: JARVIS.colors.cyan },
            { label: 'completion', color: JARVIS.colors.green },
            { label: 'activity', color: JARVIS.colors.amber },
          ].map((it) => (
            <span key={it.label} className="jarvis-mono text-[9px] uppercase flex items-center gap-1.5 text-[var(--j-text-dim)]">
              <span className="h-2 w-2 rounded-full" style={{ background: it.color }} />{it.label}
            </span>
          ))}
        </div>
      </div>

      {/* Leaderboards */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Leaderboard title="Top Performers" icon={Trophy} accent={JARVIS.colors.amber} agents={data.topPerformers} metric={(a) => `${a.tasks.completionRate}%`} sub={(a) => `${a.tasks.completed}/${a.tasks.total} tasks`} />
        <Leaderboard title="Most Active" icon={Activity} accent={JARVIS.colors.cyan} agents={data.mostActive} metric={(a) => String(a.logs.total)} sub={(a) => `${a.logs.successes} ok · ${a.logs.errors} err`} />
        <Leaderboard title="Most Connected" icon={Radio} accent={JARVIS.colors.violet} agents={data.mostConnected} metric={(a) => String(a.comms.sent + a.comms.received)} sub={(a) => `${a.comms.sent} sent · ${a.comms.received} recv`} />
      </div>

      {/* Skill stats */}
      {data.skillStats.length > 0 && (
        <div className="jarvis-panel p-4">
          <SectionTitle title="Skill Execution Stats" icon={Zap} accent={JARVIS.colors.green} />
          <div className="overflow-x-auto jarvis-scroll">
            <table className="w-full text-sm">
              <thead>
                <tr className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)] border-b border-[var(--j-border)]">
                  <th className="text-left py-2 px-2">Skill</th>
                  <th className="text-right py-2 px-2">Runs</th>
                  <th className="text-right py-2 px-2">Success</th>
                  <th className="text-right py-2 px-2">Avg Latency</th>
                </tr>
              </thead>
              <tbody>
                {data.skillStats.map((s, i) => (
                  <motion.tr key={s.skillKey} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.03 }} className="border-b border-[var(--j-border-soft)]">
                    <td className="py-2 px-2 jarvis-mono text-xs text-[var(--j-cyan)]">{s.skillKey}</td>
                    <td className="py-2 px-2 text-right jarvis-mono text-xs text-[var(--j-text)]">{s.count}</td>
                    <td className="py-2 px-2 text-right">
                      <span className="jarvis-mono text-xs" style={{ color: s.successRate >= 80 ? JARVIS.colors.green : s.successRate >= 50 ? JARVIS.colors.amber : JARVIS.colors.red }}>{s.successRate}%</span>
                    </td>
                    <td className="py-2 px-2 text-right jarvis-mono text-xs text-[var(--j-text-dim)]">{s.avgLatency}ms</td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function Leaderboard({ title, icon: Icon, accent, agents, metric, sub }: {
  title: string;
  icon: typeof Trophy;
  accent: string;
  agents: PerAgent[];
  metric: (a: PerAgent) => string;
  sub: (a: PerAgent) => string;
}) {
  return (
    <div className="jarvis-panel p-4">
      <SectionTitle title={title} icon={Icon} accent={accent} />
      {agents.length > 0 ? (
        <div className="space-y-2">
          {agents.map((a, i) => (
            <motion.div key={a.codename} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05 }} className="flex items-center gap-3 p-2 rounded-md hover:bg-[var(--j-panel-soft)]/60">
              <span className="jarvis-mono text-xs font-bold w-5 text-center" style={{ color: i === 0 ? JARVIS.colors.amber : 'var(--j-text-mute)' }}>#{i + 1}</span>
              <div className="min-w-0 flex-1">
                <div className="jarvis-mono text-xs text-[var(--j-cyan)]">{a.codename}</div>
                <div className="text-[10px] text-[var(--j-text-mute)] truncate">{sub(a)}</div>
              </div>
              <span className="jarvis-mono text-sm font-semibold" style={{ color: accent }}>{metric(a)}</span>
            </motion.div>
          ))}
        </div>
      ) : <EmptyState icon={Icon} message="No data" />}
    </div>
  );
}
