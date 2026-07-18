'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { Lightbulb, RefreshCw, Sparkles, TrendingUp, Cpu, Bot, Wallet } from 'lucide-react';
import { useApi } from '@/lib/hooks/use-api';
import { JARVIS } from '@/lib/config';
import { SectionTitle, StatCard } from '@/components/jarvis/shared';

interface Insight {
  insight: string;
  snapshot: {
    working: number; idle: number; pending: number; overloaded: string[];
    cpu: number; revenue: number; avgSuccess: number;
  };
}

export default function InsightsTab() {
  const { data, loading, refresh } = useApi<Insight>('/api/insights', 60000);
  const [regenerating, setRegenerating] = useState(false);

  const regen = async () => {
    setRegenerating(true);
    await refresh();
    setTimeout(() => setRegenerating(false), 600);
  };

  const s = data?.snapshot;

  return (
    <div className="space-y-4">
      <SectionTitle
        title="Proactive Insights"
        icon={Lightbulb}
        accent={JARVIS.colors.cyan}
        action={
          <button onClick={regen} className="flex h-8 w-8 items-center justify-center rounded-md border border-[var(--j-border)] text-[var(--j-text-dim)] hover:text-[var(--j-cyan)]">
            <RefreshCw className={`h-3.5 w-3.5 ${regenerating ? 'animate-spin' : ''}`} />
          </button>
        }
      />

      {/* Hero insight card */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="jarvis-panel jarvis-scan p-6 relative overflow-hidden">
        <div className="relative z-10">
          <div className="flex items-center gap-2 mb-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg jarvis-btn-accent">
              <Sparkles className="h-4 w-4" />
            </div>
            <div>
              <div className="jarvis-mono text-[10px] uppercase text-[var(--j-cyan)] tracking-widest">AI Analysis</div>
              <div className="text-xs text-[var(--j-text-mute)]">Generated from live fleet telemetry</div>
            </div>
          </div>
          {loading && !data ? (
            <div className="space-y-2 py-2">
              <div className="h-4 w-3/4 rounded bg-[var(--j-panel-soft)] animate-pulse" />
              <div className="h-4 w-1/2 rounded bg-[var(--j-panel-soft)] animate-pulse" />
            </div>
          ) : (
            <p className="text-base text-[var(--j-text)] leading-relaxed">{data?.insight ?? 'Analyzing fleet state…'}</p>
          )}
        </div>
      </motion.div>

      {/* Snapshot stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Working" value={s?.working ?? 0} icon={Bot} accent={JARVIS.colors.green} />
        <StatCard label="Idle" value={s?.idle ?? 0} icon={Bot} accent={JARVIS.colors.cyan} />
        <StatCard label="Avg Success" value={`${s?.avgSuccess ?? 0}%`} icon={TrendingUp} accent={JARVIS.colors.violet} />
        <StatCard label="Revenue" value={`₹${(s?.revenue ?? 0).toLocaleString()}`} icon={Wallet} accent={JARVIS.colors.amber} />
      </div>

      {/* Fleet snapshot detail */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="jarvis-panel p-4">
          <SectionTitle title="Fleet Snapshot" icon={Bot} accent={JARVIS.colors.cyan} />
          <div className="space-y-3 mt-2">
            <SnapRow icon={Bot} label="Working agents" value={String(s?.working ?? 0)} color={JARVIS.colors.green} />
            <SnapRow icon={Bot} label="Idle agents" value={String(s?.idle ?? 0)} color={JARVIS.colors.cyan} />
            <SnapRow icon={Cpu} label="CPU usage" value={`${s?.cpu ?? 0}%`} color={JARVIS.colors.amber} />
            <SnapRow icon={TrendingUp} label="Pending tasks" value={String(s?.pending ?? 0)} color={JARVIS.colors.violet} />
          </div>
        </div>

        <div className="jarvis-panel p-4">
          <SectionTitle title="Overloaded Agents" icon={Cpu} accent={JARVIS.colors.red} />
          <div className="mt-2">
            {s?.overloaded?.length ? (
              <div className="space-y-2">
                {s.overloaded.map((c) => (
                  <motion.div key={c} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} className="flex items-center gap-3 p-3 rounded-lg border border-[var(--j-red)]/30 bg-[var(--j-red)]/5">
                    <span className="h-2 w-2 rounded-full bg-[var(--j-red)] jarvis-blink" />
                    <span className="jarvis-mono text-sm text-[var(--j-red)]">{c}</span>
                    <span className="ml-auto jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">load &gt; 70%</span>
                  </motion.div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <div className="flex h-10 w-10 items-center justify-center rounded-full mb-2" style={{ background: `${JARVIS.colors.green}1a`, border: `1px solid ${JARVIS.colors.green}33`, color: JARVIS.colors.green }}>
                  <TrendingUp className="h-5 w-5" />
                </div>
                <div className="text-sm text-[var(--j-text-dim)]">All agents within safe load</div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function SnapRow({ icon: Icon, label, value, color }: { icon: typeof Cpu; label: string; value: string; color: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-8 w-8 items-center justify-center rounded-md" style={{ background: `${color}1a`, border: `1px solid ${color}33`, color }}>
        <Icon className="h-4 w-4" />
      </div>
      <span className="text-xs text-[var(--j-text-dim)] flex-1">{label}</span>
      <span className="jarvis-mono text-sm" style={{ color }}>{value}</span>
    </div>
  );
}
