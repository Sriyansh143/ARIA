'use client';

import { motion } from 'framer-motion';
import { Gauge, Cpu, MemoryStick, HardDrive, Radio, Zap, Clock, Server } from 'lucide-react';
import { AreaChart, Area, LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip } from 'recharts';
import { useApi } from '@/lib/hooks/use-api';
import { JARVIS, fmtTime } from '@/lib/config';
import { SectionTitle, StatCard, RadialGauge } from '@/components/jarvis/shared';

interface Metrics {
  current: { cpu: number; mem: number; disk: number; net: number; latency: number; tokens: number; uptime: number };
  series: Array<{ time: string; cpu: number; mem: number; disk: number; latency: number; tokens: number }>;
  agents: Array<{ name: string; load: number; status: string }>;
}

export default function TelemetryTab() {
  const { data, loading } = useApi<Metrics>('/api/metrics', 5000);

  if (loading && !data) return <div className="grid grid-cols-2 md:grid-cols-4 gap-4">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="jarvis-panel h-24 animate-pulse" />)}</div>;
  if (!data) return <div className="text-[var(--j-text-mute)] text-sm">No telemetry.</div>;

  const c = data.current;
  const cpuSeries = data.series.map((s) => ({ time: fmtTime(new Date(s.time)), cpu: s.cpu, mem: s.mem, disk: s.disk }));
  const latSeries = data.series.map((s) => ({ time: fmtTime(new Date(s.time)), latency: s.latency, tokens: s.tokens }));

  return (
    <div className="space-y-4">
      <SectionTitle title="Live Telemetry" icon={Gauge} accent={JARVIS.colors.cyan} action={<span className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)]">polling 5s</span>} />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="CPU" value={`${Math.round(c.cpu)}%`} icon={Cpu} accent={JARVIS.colors.cyan} />
        <StatCard label="Memory" value={`${Math.round(c.mem)}%`} icon={MemoryStick} accent={JARVIS.colors.violet} />
        <StatCard label="Disk" value={`${Math.round(c.disk)}%`} icon={HardDrive} accent={JARVIS.colors.amber} />
        <StatCard label="Network" value={`${Math.round(c.net)} MB/s`} icon={Radio} accent={JARVIS.colors.green} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Radial gauges */}
        <div className="jarvis-panel p-4">
          <SectionTitle title="System Load" icon={Server} accent={JARVIS.colors.green} />
          <div className="grid grid-cols-3 gap-2 py-2">
            <RadialGauge value={c.cpu} label="CPU" color={JARVIS.colors.cyan} size={104} />
            <RadialGauge value={c.mem} label="MEM" color={JARVIS.colors.violet} size={104} />
            <RadialGauge value={c.disk} label="DISK" color={JARVIS.colors.amber} size={104} />
          </div>
        </div>

        {/* CPU/MEM chart */}
        <div className="lg:col-span-2 jarvis-panel p-4">
          <SectionTitle title="Resource Utilization" icon={Cpu} accent={JARVIS.colors.cyan} />
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={cpuSeries} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="tCpu" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={JARVIS.colors.cyan} stopOpacity={0.4} /><stop offset="100%" stopColor={JARVIS.colors.cyan} stopOpacity={0} /></linearGradient>
                  <linearGradient id="tMem" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={JARVIS.colors.violet} stopOpacity={0.35} /><stop offset="100%" stopColor={JARVIS.colors.violet} stopOpacity={0} /></linearGradient>
                  <linearGradient id="tDisk" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={JARVIS.colors.amber} stopOpacity={0.3} /><stop offset="100%" stopColor={JARVIS.colors.amber} stopOpacity={0} /></linearGradient>
                </defs>
                <XAxis dataKey="time" tick={{ fill: '#64748B', fontSize: 10 }} axisLine={false} tickLine={false} minTickGap={24} />
                <YAxis tick={{ fill: '#64748B', fontSize: 10 }} axisLine={false} tickLine={false} domain={[0, 100]} />
                <Tooltip contentStyle={{ background: '#0E1218', border: '1px solid #1B2330', borderRadius: 8, fontSize: 12 }} labelStyle={{ color: '#94A3B8' }} />
                <Area type="monotone" dataKey="cpu" name="CPU %" stroke={JARVIS.colors.cyan} strokeWidth={2} fill="url(#tCpu)" />
                <Area type="monotone" dataKey="mem" name="MEM %" stroke={JARVIS.colors.violet} strokeWidth={2} fill="url(#tMem)" />
                <Area type="monotone" dataKey="disk" name="DISK %" stroke={JARVIS.colors.amber} strokeWidth={1.5} fill="url(#tDisk)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Latency / tokens + agent load */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="jarvis-panel p-4">
          <SectionTitle title="Provider Latency & Tokens" icon={Zap} accent={JARVIS.colors.amber} />
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={latSeries} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                <XAxis dataKey="time" tick={{ fill: '#64748B', fontSize: 10 }} axisLine={false} tickLine={false} minTickGap={24} />
                <YAxis tick={{ fill: '#64748B', fontSize: 10 }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ background: '#0E1218', border: '1px solid #1B2330', borderRadius: 8, fontSize: 12 }} labelStyle={{ color: '#94A3B8' }} />
                <Line type="monotone" dataKey="latency" name="Latency (ms)" stroke={JARVIS.colors.amber} strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="jarvis-panel p-4">
          <SectionTitle title="Agent Load Distribution" icon={Server} accent={JARVIS.colors.green} />
          <div className="space-y-2 mt-2">
            {data.agents.map((a) => (
              <div key={a.name} className="flex items-center gap-3">
                <span className="jarvis-mono text-[10px] text-[var(--j-cyan)] w-16">{a.name}</span>
                <div className="flex-1 h-2 rounded-full bg-[var(--j-border)] overflow-hidden">
                  <motion.div
                    className="h-full rounded-full"
                    style={{ background: a.load > 70 ? JARVIS.colors.red : a.load > 40 ? JARVIS.colors.amber : JARVIS.colors.green }}
                    initial={{ width: 0 }}
                    animate={{ width: `${a.load}%` }}
                    transition={{ duration: 0.5 }}
                  />
                </div>
                <span className="jarvis-mono text-[10px] tabular-nums text-[var(--j-text-dim)] w-9 text-right">{Math.round(a.load)}%</span>
              </div>
            ))}
          </div>
          <div className="mt-4 pt-3 border-t border-[var(--j-border-soft)] flex items-center justify-between jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">
            <span className="flex items-center gap-1.5"><Clock className="h-3 w-3" /> uptime {formatUptime(c.uptime)}</span>
            <span className="flex items-center gap-1.5"><Zap className="h-3 w-3" /> {c.tokens.toLocaleString()} tok</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function formatUptime(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}h ${m}m`;
}
