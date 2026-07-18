'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { ScrollText, RefreshCw, Terminal } from 'lucide-react';
import { useApi } from '@/lib/hooks/use-api';
import { JARVIS, LEVEL_COLORS, fmtTime } from '@/lib/config';
import { SectionTitle, LevelBadge, EmptyState } from '@/components/jarvis/shared';

interface Log {
  id: string; level: string; message: string; createdAt: string;
  agent?: { codename: string } | null;
}

const LEVELS = ['all', 'info', 'success', 'warn', 'error', 'debug'] as const;

export default function LogsTab() {
  const [level, setLevel] = useState<(typeof LEVELS)[number]>('all');
  const [agent, setAgent] = useState('all');
  const { data, loading, refresh } = useApi<{ logs: Log[] }>(`/api/logs?level=${level === 'all' ? '' : level}&agent=${agent === 'all' ? '' : agent}&limit=200`, 6000);

  const logs = data?.logs ?? [];
  const agents = Array.from(new Set(logs.map((l) => l.agent?.codename).filter(Boolean))) as string[];

  return (
    <div className="space-y-4">
      <SectionTitle
        title="System Logs"
        icon={ScrollText}
        accent={JARVIS.colors.amber}
        action={<button onClick={refresh} className="flex h-8 w-8 items-center justify-center rounded-md border border-[var(--j-border)] text-[var(--j-text-dim)] hover:text-[var(--j-cyan)]"><RefreshCw className="h-3.5 w-3.5" /></button>}
      />

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex flex-wrap gap-2">
          {LEVELS.map((l) => (
            <button
              key={l}
              onClick={() => setLevel(l)}
              className={`jarvis-mono text-[10px] uppercase px-3 py-1.5 rounded-md border transition-colors ${level === l ? 'jarvis-btn-accent border-0' : 'border-[var(--j-border)] text-[var(--j-text-dim)] hover:text-[var(--j-text)]'}`}
            >
              {l}
            </button>
          ))}
        </div>
        <select
          value={agent}
          onChange={(e) => setAgent(e.target.value)}
          className="jarvis-mono text-xs px-3 py-1.5 rounded-md border border-[var(--j-border)] bg-[var(--j-panel-soft)] text-[var(--j-text)] outline-none focus:border-[var(--j-cyan)] sm:ml-auto"
        >
          <option value="all">all agents</option>
          {agents.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
      </div>

      <div className="jarvis-panel p-0 overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-2 border-b border-[var(--j-border)] bg-[var(--j-panel-soft)]/40">
          <Terminal className="h-3.5 w-3.5 text-[var(--j-green)]" />
          <span className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">jarvis@mission-control:~$ tail -f /var/log/agents.log</span>
          <span className="ml-auto jarvis-mono text-[10px] text-[var(--j-text-mute)]">{logs.length} lines</span>
        </div>
        <div className="max-h-[60vh] overflow-y-auto jarvis-scroll font-mono text-xs">
          {loading && !data ? (
            <div className="p-4 text-[var(--j-text-mute)]">loading…</div>
          ) : logs.length ? (
            logs.map((l, i) => {
              const color = LEVEL_COLORS[l.level] ?? JARVIS.colors.textDim;
              return (
                <motion.div
                  key={l.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: Math.min(i * 0.005, 0.3) }}
                  className="flex items-start gap-3 px-4 py-1.5 border-b border-[var(--j-border-soft)] hover:bg-[var(--j-panel-soft)]/40"
                >
                  <span className="text-[var(--j-text-mute)] shrink-0 tabular-nums">{fmtTime(new Date(l.createdAt))}</span>
                  <span className="shrink-0"><LevelBadge level={l.level} /></span>
                  {l.agent && <span className="shrink-0 text-[var(--j-cyan)]">[{l.agent.codename}]</span>}
                  <span className="text-[var(--j-text-dim)]" style={{ color: l.level === 'error' ? color : undefined }}>{l.message}</span>
                </motion.div>
              );
            })
          ) : (
            <EmptyState icon={ScrollText} message="No logs match filter" />
          )}
        </div>
      </div>
    </div>
  );
}
