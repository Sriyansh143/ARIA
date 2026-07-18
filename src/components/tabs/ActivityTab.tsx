'use client';

import { motion } from 'framer-motion';
import { History, Bot, ListTodo, Wallet, Database, Bell } from 'lucide-react';
import { useApi } from '@/lib/hooks/use-api';
import { JARVIS } from '@/lib/config';
import { SectionTitle, LevelBadge, EmptyState } from '@/components/jarvis/shared';

interface Ev {
  id: string; type: string; level: string; agent?: string;
  title: string; detail?: string; time: string;
}

const TYPE_ICON: Record<string, typeof Bot> = {
  log: Bot, task: ListTodo, payment: Wallet, memory: Database, notification: Bell,
};

export default function ActivityTab() {
  const { data, loading } = useApi<{ events: Ev[] }>('/api/activity', 6000);
  const events = data?.events ?? [];

  return (
    <div className="space-y-4">
      <SectionTitle title="Activity Feed" icon={History} accent={JARVIS.colors.green} action={<span className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)]">polling 6s</span>} />

      {loading && !data ? (
        <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="jarvis-panel h-14 animate-pulse" />)}</div>
      ) : events.length ? (
        <div className="relative">
          {/* Timeline line */}
          <div className="absolute left-[19px] top-2 bottom-2 w-px bg-gradient-to-b from-[var(--j-cyan)]/40 via-[var(--j-border)] to-transparent" />
          <div className="space-y-1">
            {events.map((e, i) => {
              const Icon = TYPE_ICON[e.type] ?? History;
              const color = levelColor(e.level);
              return (
                <motion.div
                  key={e.id}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: Math.min(i * 0.015, 0.4) }}
                  className="relative flex items-start gap-3 pl-1 py-1.5"
                >
                  <div className="relative z-10 flex h-8 w-8 items-center justify-center rounded-full shrink-0" style={{ background: `${color}1a`, border: `1px solid ${color}44`, color }}>
                    <Icon className="h-3.5 w-3.5" />
                  </div>
                  <div className="flex-1 min-w-0 pt-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <LevelBadge level={e.level} />
                      {e.agent && <span className="jarvis-mono text-[9px] text-[var(--j-cyan)]">[{e.agent}]</span>}
                      <span className="text-xs text-[var(--j-text)]">{e.title}</span>
                    </div>
                    {e.detail && <div className="text-[10px] text-[var(--j-text-mute)] mt-0.5">{e.detail}</div>}
                  </div>
                  <span className="jarvis-mono text-[9px] text-[var(--j-text-mute)] shrink-0 pt-1.5">{e.time}</span>
                </motion.div>
              );
            })}
          </div>
        </div>
      ) : (
        <EmptyState icon={History} message="No recent activity" />
      )}
    </div>
  );
}

function levelColor(l: string): string {
  switch (l) {
    case 'success': return JARVIS.colors.green;
    case 'warn': return JARVIS.colors.amber;
    case 'error': return JARVIS.colors.red;
    case 'info': return JARVIS.colors.cyan;
    default: return JARVIS.colors.textDim;
  }
}
