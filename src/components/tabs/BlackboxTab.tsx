'use client';

import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { ShieldCheck, Filter, AlertOctagon, Brain, DollarSign, Activity } from 'lucide-react';
import { useApi } from '@/lib/hooks/use-api';
import { JARVIS } from '@/lib/config';
import { SectionTitle, StatCard, EmptyState, Pill, LevelBadge } from '@/components/jarvis/shared';

interface BlackBoxEntry {
  id: string;
  timestamp: number;
  agentCodename?: string;
  category: string;
  action: string;
  target?: string;
  detail: Record<string, unknown>;
  tokensIn?: number;
  tokensOut?: number;
  costUsd?: number;
  severity?: string;
  status?: string;
}

interface BlackBoxStats {
  bufferSize: number;
  totalRecorded: number;
  totalFlushed: number;
  byCategory: Record<string, number>;
  bySeverity: Record<string, number>;
  byAgent: Record<string, number>;
  totalTokensIn: number;
  totalTokensOut: number;
  totalCostUsd: number;
}

interface DbLog {
  id: string;
  createdAt: string;
  agentCodename: string | null;
  level: string;
  message: string;
  meta: string | null;
}

const CATEGORIES = ['all', 'decision', 'token_spend', 'outbound', 'error', 'autonomous'] as const;
const SEVERITIES = ['all', 'info', 'warn', 'error', 'critical'] as const;

const CATEGORY_COLOR: Record<string, string> = {
  decision: JARVIS.colors.cyan,
  token_spend: JARVIS.colors.amber,
  outbound: JARVIS.colors.violet,
  error: JARVIS.colors.red,
  autonomous: JARVIS.colors.green,
  goal: JARVIS.colors.green,
  task: JARVIS.colors.cyan,
};

function formatRel(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function BlackboxTab() {
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>('all');
  const [severity, setSeverity] = useState<(typeof SEVERITIES)[number]>('all');
  const [agent, setAgent] = useState('all');

  const queryStr = useMemo(() => {
    const params = new URLSearchParams();
    if (category !== 'all') params.set('category', category);
    if (severity !== 'all') params.set('severity', severity);
    if (agent !== 'all') params.set('agent', agent);
    const q = params.toString();
    return q ? `?${q}` : '';
  }, [category, severity, agent]);

  const { data, loading } = useApi<{ entries: BlackBoxEntry[]; dbLogs: DbLog[]; stats: BlackBoxStats }>(
    `/api/blackbox${queryStr}`,
    10000,
  );

  const entries = data?.entries ?? [];
  const dbLogs = data?.dbLogs ?? [];
  const stats = data?.stats ?? {
    bufferSize: 0,
    totalRecorded: 0,
    totalFlushed: 0,
    byCategory: {},
    bySeverity: {},
    byAgent: {},
    totalTokensIn: 0,
    totalTokensOut: 0,
    totalCostUsd: 0,
  };

  // Derive agent list from stats.
  const agentOptions = Object.keys(stats.byAgent).sort();

  return (
    <div className="space-y-4">
      <SectionTitle title="Black Box — Audit Trail" icon={ShieldCheck} accent={JARVIS.colors.red} />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Buffer" value={stats.bufferSize} icon={Activity} accent={JARVIS.colors.cyan} />
        <StatCard label="Recorded" value={stats.totalRecorded} icon={ShieldCheck} accent={JARVIS.colors.violet} />
        <StatCard
          label="Tokens (in+out)"
          value={(stats.totalTokensIn + stats.totalTokensOut).toLocaleString()}
          icon={Brain}
          accent={JARVIS.colors.amber}
        />
        <StatCard
          label="Cost"
          value={`$${stats.totalCostUsd.toFixed(4)}`}
          icon={DollarSign}
          accent={JARVIS.colors.green}
        />
      </div>

      <div className="flex flex-col md:flex-row gap-3 md:items-center">
        <div className="flex flex-wrap gap-2">
          {CATEGORIES.map((c) => (
            <button
              key={c}
              onClick={() => setCategory(c)}
              className={`jarvis-mono text-[10px] uppercase px-3 py-1.5 rounded-md border transition-colors ${category === c ? 'jarvis-btn-accent border-0' : 'border-[var(--j-border)] text-[var(--j-text-dim)] hover:text-[var(--j-text)]'}`}
            >
              {c}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {SEVERITIES.map((s) => (
            <button
              key={s}
              onClick={() => setSeverity(s)}
              className={`jarvis-mono text-[10px] uppercase px-3 py-1.5 rounded-md border transition-colors ${severity === s ? 'jarvis-btn-accent border-0' : 'border-[var(--j-border)] text-[var(--j-text-dim)] hover:text-[var(--j-text)]'}`}
            >
              {s}
            </button>
          ))}
        </div>
        <div className="relative md:ml-auto">
          <Filter className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--j-text-mute)]" />
          <select
            value={agent}
            onChange={(e) => setAgent(e.target.value)}
            className="jarvis-mono text-xs pl-8 pr-3 py-1.5 rounded-md border border-[var(--j-border)] bg-[var(--j-panel-soft)] text-[var(--j-text)] outline-none focus:border-[var(--j-red)]"
          >
            <option value="all">all agents</option>
            {agentOptions.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
      </div>

      {loading && !data ? (
        <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="jarvis-panel h-16 animate-pulse" />)}</div>
      ) : entries.length === 0 ? (
        <EmptyState icon={AlertOctagon} message="No audit entries match the filter" />
      ) : (
        <div className="jarvis-panel p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="jarvis-mono text-xs uppercase tracking-widest text-[var(--j-text)]">
              Live Audit Buffer
            </div>
            <span className="jarvis-mono text-[10px] text-[var(--j-text-mute)]">{entries.length} / {stats.bufferSize}</span>
          </div>
          <div className="max-h-96 overflow-y-auto jarvis-scroll space-y-1.5">
            {entries.map((e, i) => {
              const color = CATEGORY_COLOR[e.category] ?? JARVIS.colors.textDim;
              return (
                <motion.div
                  key={e.id}
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: Math.min(i * 0.01, 0.5) }}
                  className="flex items-start gap-3 p-2.5 rounded-md border border-[var(--j-border-soft)] bg-[var(--j-panel-soft)]"
                >
                  <div className="shrink-0 mt-0.5">
                    <span className="block h-2 w-2 rounded-full" style={{ background: color, boxShadow: `0 0 6px ${color}` }} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                      <span className="jarvis-mono text-[9px] uppercase px-1.5 py-0.5 rounded" style={{ color, background: `${color}1a`, border: `1px solid ${color}33` }}>
                        {e.category}
                      </span>
                      {e.severity && e.severity !== 'info' && <LevelBadge level={e.severity} />}
                      {e.agentCodename && (
                        <span className="jarvis-mono text-xs text-[var(--j-cyan)]">{e.agentCodename}</span>
                      )}
                      <span className="text-xs text-[var(--j-text)]">{e.action}</span>
                      {e.target && (
                        <span className="jarvis-mono text-[10px] text-[var(--j-text-mute)]">→ {e.target}</span>
                      )}
                    </div>
                    {Object.keys(e.detail ?? {}).length > 0 && (
                      <pre className="text-[10px] text-[var(--j-text-mute)] jarvis-mono mt-1 line-clamp-2">
                        {JSON.stringify(e.detail).slice(0, 200)}
                      </pre>
                    )}
                    <div className="flex items-center gap-3 mt-1">
                      <span className="jarvis-mono text-[9px] text-[var(--j-text-mute)]">{formatRel(e.timestamp)}</span>
                      {e.tokensIn != null && e.tokensOut != null && (
                        <span className="jarvis-mono text-[9px] text-[var(--j-amber)]">
                          {e.tokensIn}→{e.tokensOut} tok
                        </span>
                      )}
                      {e.costUsd != null && e.costUsd > 0 && (
                        <span className="jarvis-mono text-[9px] text-[var(--j-green)]">${e.costUsd.toFixed(4)}</span>
                      )}
                      {e.status && <Pill color={e.status === 'failure' ? JARVIS.colors.red : JARVIS.colors.green}>{e.status}</Pill>}
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>
      )}

      {dbLogs.length > 0 && (
        <div className="jarvis-panel p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="jarvis-mono text-xs uppercase tracking-widest text-[var(--j-text)]">
              Persisted Agent Logs
            </div>
            <span className="jarvis-mono text-[10px] text-[var(--j-text-mute)]">{dbLogs.length}</span>
          </div>
          <div className="max-h-72 overflow-y-auto jarvis-scroll space-y-1.5">
            {dbLogs.map((l, i) => (
              <motion.div
                key={l.id}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(i * 0.01, 0.5) }}
                className="flex items-start gap-2 p-2 rounded-md border border-[var(--j-border-soft)] bg-[var(--j-panel-soft)]"
              >
                <LevelBadge level={l.level} />
                <div className="min-w-0 flex-1">
                  <div className="text-xs text-[var(--j-text)]">{l.message}</div>
                  <div className="flex items-center gap-2 mt-0.5">
                    {l.agentCodename && <span className="jarvis-mono text-[9px] text-[var(--j-cyan)]">{l.agentCodename}</span>}
                    <span className="jarvis-mono text-[9px] text-[var(--j-text-mute)]">
                      {new Date(l.createdAt).toLocaleTimeString('en-US', { hour12: false })}
                    </span>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
