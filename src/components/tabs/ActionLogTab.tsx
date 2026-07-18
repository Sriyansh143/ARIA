'use client';

// =====================================================================
// ActionLogTab — Reversible Action Log UI (Task ID 9)
// =====================================================================
// Permanent rule: "keep log of every change made or every action so that
// particular action can be reversed."
//
// Pulls from /api/action-log (which queries the ActionLog Prisma model).
// Each row shows: time, actor, action (mono), category (badge), target,
// reversible icon, reversed icon, and a "Reverse" button (with a
// confirmation dialog) when reversible && !reversed.
//
// Click row → expand to see beforeState / afterState JSON, meta, and
// reverseResult. Stats cards: Total, Reversible, Reversed, Success Rate,
// By-Category breakdown.
// =====================================================================

import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  History, RefreshCw, Filter, Loader2, RotateCcw, AlertTriangle,
  CheckCircle2, XCircle, ShieldAlert,
} from 'lucide-react';
import { useApi, postJson } from '@/lib/hooks/use-api';
import { JARVIS, fmtTime, timeAgo } from '@/lib/config';
import { SectionTitle, StatCard, EmptyState, Pill } from '@/components/jarvis/shared';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';

interface ActionRow {
  id: string;
  actor: string;
  action: string;
  category: string;
  target: string | null;
  beforeState: string | null;
  afterState: string | null;
  reversible: boolean;
  reversed: boolean;
  reversedAt: string | null;
  reversedBy: string | null;
  reverseResult: string | null;
  approvalId: string | null;
  meta: string;
  createdAt: string;
}

interface ActionStats {
  total: number;
  reversible: number;
  irreversible: number;
  reversed: number;
  pendingReversal: number;
  reversalSuccessRate: number;
  byCategory: Record<string, number>;
  byAction: Record<string, number>;
  topActors: Array<{ actor: string; count: number }>;
}

interface ActionLogResponse {
  rows: ActionRow[];
  total: number;
  filters: {
    actor: string | null;
    action: string | null;
    category: string | null;
    reversed: boolean | null;
    limit: number;
    offset: number;
  };
  stats: ActionStats | null;
  error?: string;
}

const CATEGORIES = [
  { value: '', label: 'all categories' },
  { value: 'mutation', label: 'mutation' },
  { value: 'destructive', label: 'destructive' },
  { value: 'config', label: 'config' },
  { value: 'file', label: 'file' },
  { value: 'exec', label: 'exec' },
] as const;

const REVERSED_FILTERS = [
  { value: '', label: 'all' },
  { value: 'true', label: 'reversed' },
  { value: 'false', label: 'not reversed' },
] as const;

const CATEGORY_COLOR: Record<string, string> = {
  mutation: JARVIS.colors.cyan,
  destructive: JARVIS.colors.red,
  config: JARVIS.colors.violet,
  file: JARVIS.colors.amber,
  exec: JARVIS.colors.textDim,
};

function safeParse(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export default function ActionLogTab() {
  const [actor, setActor] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [category, setCategory] = useState<string>('');
  const [reversedFilter, setReversedFilter] = useState<string>('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [reverseTarget, setReverseTarget] = useState<ActionRow | null>(null);
  const [reversing, setReversing] = useState(false);

  const qs = useMemo(() => {
    const params = new URLSearchParams();
    params.set('limit', '100');
    params.set('offset', '0');
    params.set('stats', '1');
    if (actor.trim()) params.set('actor', actor.trim());
    if (actionFilter.trim()) params.set('action', actionFilter.trim());
    if (category) params.set('category', category);
    if (reversedFilter) params.set('reversed', reversedFilter);
    return params.toString();
  }, [actor, actionFilter, category, reversedFilter]);

  const { data, loading, refresh } = useApi<ActionLogResponse>(`/api/action-log?${qs}`, 10000);
  const { toast } = useToast();

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const stats = data?.stats ?? null;

  const resetFilters = () => {
    setActor('');
    setActionFilter('');
    setCategory('');
    setReversedFilter('');
  };

  const doReverse = async (row: ActionRow, reversedBy: string) => {
    setReversing(true);
    try {
      const result = await postJson<{ result?: { ok: boolean; detail?: string; error?: string }; error?: string }>(
        `/api/action-log/${row.id}/reverse`,
        { reversedBy },
      );
      if (result.result?.ok) {
        toast({ title: 'Action reversed', description: result.result.detail ?? 'OK' });
      } else {
        toast({
          title: 'Reversal failed',
          description: result.result?.error ?? result.error ?? 'unknown error',
          variant: 'destructive',
        });
      }
      setReverseTarget(null);
      refresh();
    } catch (e) {
      toast({
        title: 'Reversal request failed',
        description: e instanceof Error ? e.message : 'fetch error',
        variant: 'destructive',
      });
    } finally {
      setReversing(false);
    }
  };

  return (
    <div className="space-y-4">
      <SectionTitle
        title="Action Log"
        icon={History}
        accent={JARVIS.colors.green}
        action={
          <button
            onClick={refresh}
            className="flex h-8 w-8 items-center justify-center rounded-md border border-[var(--j-border)] text-[var(--j-text-dim)] hover:text-[var(--j-cyan)]"
            aria-label="Refresh"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatCard label="Total Actions" value={(stats?.total ?? 0).toLocaleString()} icon={History} accent={JARVIS.colors.cyan} />
        <StatCard label="Reversible" value={stats?.reversible ?? 0} icon={RotateCcw} accent={JARVIS.colors.amber} />
        <StatCard label="Reversed" value={stats?.reversed ?? 0} icon={CheckCircle2} accent={JARVIS.colors.green} />
        <StatCard label="Success Rate" value={`${stats?.reversalSuccessRate ?? 100}%`} icon={ShieldAlert} accent={JARVIS.colors.violet} />
        <StatCard label="Pending" value={stats?.pendingReversal ?? 0} icon={AlertTriangle} accent={JARVIS.colors.red} />
      </div>

      {/* By-category breakdown */}
      {stats && Object.keys(stats.byCategory).length > 0 && (
        <div className="jarvis-panel p-3">
          <div className="flex items-center gap-2 mb-2">
            <Filter className="h-3.5 w-3.5 text-[var(--j-text-mute)]" />
            <span className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">by category</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {Object.entries(stats.byCategory).sort((a, b) => b[1] - a[1]).map(([cat, count]) => {
              const color = CATEGORY_COLOR[cat] ?? JARVIS.colors.textDim;
              return (
                <div
                  key={cat}
                  className="jarvis-mono text-[10px] uppercase px-2 py-1 rounded-md flex items-center gap-1.5"
                  style={{ color, background: `${color}1a`, border: `1px solid ${color}33` }}
                >
                  <span>{cat}</span>
                  <span className="tabular-nums">{count}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Filter bar */}
      <div className="jarvis-panel p-3 space-y-3">
        <div className="flex items-center gap-2">
          <Filter className="h-3.5 w-3.5 text-[var(--j-text-mute)]" />
          <span className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">filters</span>
          <button
            onClick={resetFilters}
            className="ml-auto jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)] hover:text-[var(--j-cyan)]"
          >
            reset
          </button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
          <div className="space-y-1">
            <label className="text-[10px] text-[var(--j-text-mute)] jarvis-mono uppercase">actor</label>
            <Input
              value={actor}
              onChange={(e) => setActor(e.target.value)}
              placeholder="system, operator, agent:orion…"
              className="jarvis-mono text-xs h-9"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] text-[var(--j-text-mute)] jarvis-mono uppercase">action</label>
            <Input
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value)}
              placeholder="payment.create or payment.*"
              className="jarvis-mono text-xs h-9"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] text-[var(--j-text-mute)] jarvis-mono uppercase">category</label>
            <Select
              value={category || '__all__'}
              onValueChange={(v) => setCategory(v === '__all__' ? '' : v)}
            >
              <SelectTrigger className="h-9 jarvis-mono text-xs">
                <SelectValue placeholder="all categories" />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((c) => (
                  <SelectItem key={c.value || '__all__'} value={c.value || '__all__'} className="jarvis-mono text-xs">
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] text-[var(--j-text-mute)] jarvis-mono uppercase">reversed</label>
            <Select
              value={reversedFilter || '__all__'}
              onValueChange={(v) => setReversedFilter(v === '__all__' ? '' : v)}
            >
              <SelectTrigger className="h-9 jarvis-mono text-xs">
                <SelectValue placeholder="all" />
              </SelectTrigger>
              <SelectContent>
                {REVERSED_FILTERS.map((r) => (
                  <SelectItem key={r.value || '__all__'} value={r.value || '__all__'} className="jarvis-mono text-xs">
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {data?.error && (
        <div className="rounded-lg border border-[var(--j-red)]/40 bg-[var(--j-red)]/10 p-3 text-xs text-[var(--j-red)]">
          Failed to load action log: {data.error}
        </div>
      )}

      {/* Table */}
      <div className="jarvis-panel p-0 overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-2 border-b border-[var(--j-border)] bg-[var(--j-panel-soft)]/40">
          <History className="h-3.5 w-3.5" style={{ color: JARVIS.colors.green }} />
          <span className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">
            reversible action trail · {rows.length} of {total.toLocaleString()} entries
          </span>
        </div>

        <div className="max-h-[60vh] overflow-y-auto jarvis-scroll">
          {loading && !data ? (
            <div className="p-4 flex items-center gap-2 text-[var(--j-text-mute)] text-xs">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> loading…
            </div>
          ) : rows.length ? (
            <div className="font-mono text-xs">
              {/* Header */}
              <div className="grid grid-cols-[90px_110px_1fr_90px_60px_60px_90px] gap-2 px-4 py-2 border-b border-[var(--j-border)] text-[10px] uppercase text-[var(--j-text-mute)] bg-[var(--j-panel-soft)]/30 sticky top-0">
                <span>time</span>
                <span>actor</span>
                <span>action / target</span>
                <span>category</span>
                <span className="text-center">rev</span>
                <span className="text-center">done</span>
                <span className="text-right">act</span>
              </div>
              {rows.map((r, i) => {
                const color = CATEGORY_COLOR[r.category] ?? JARVIS.colors.textDim;
                const expanded = expandedId === r.id;
                const before = safeParse(r.beforeState);
                const after = safeParse(r.afterState);
                const meta = safeParse(r.meta);
                const revResult = safeParse(r.reverseResult);
                return (
                  <motion.div
                    key={r.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: Math.min(i * 0.005, 0.3) }}
                    className="border-b border-[var(--j-border-soft)]"
                  >
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => setExpandedId(expanded ? null : r.id)}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpandedId(expanded ? null : r.id); } }}
                      className="grid grid-cols-[90px_110px_1fr_90px_60px_60px_90px] gap-2 px-4 py-1.5 hover:bg-[var(--j-panel-soft)]/40 items-start cursor-pointer"
                    >
                      <span className="text-[var(--j-text-mute)] shrink-0 tabular-nums" title={new Date(r.createdAt).toLocaleString()}>
                        {fmtTime(new Date(r.createdAt))}
                      </span>
                      <span className="shrink-0 text-[var(--j-cyan)] truncate" title={r.actor}>{r.actor}</span>
                      <div className="min-w-0 flex flex-col gap-0.5">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-[var(--j-text)]">{r.action}</span>
                          {r.target && (
                            <span className="text-[var(--j-text-dim)] truncate">{r.target}</span>
                          )}
                        </div>
                        {r.reversed && r.reversedAt && (
                          <div className="text-[10px] text-[var(--j-green)]">
                            reversed {timeAgo(r.reversedAt)} by {r.reversedBy ?? '?'}
                          </div>
                        )}
                      </div>
                      <span className="shrink-0">
                        <span
                          className="jarvis-mono text-[9px] uppercase px-1.5 py-0.5 rounded"
                          style={{ color, background: `${color}1a`, border: `1px solid ${color}33` }}
                        >
                          {r.category}
                        </span>
                      </span>
                      <span className="shrink-0 text-center">
                        {r.reversible
                          ? <CheckCircle2 className="h-3.5 w-3.5 inline" style={{ color: JARVIS.colors.green }} />
                          : <XCircle className="h-3.5 w-3.5 inline" style={{ color: JARVIS.colors.textMute }} />}
                      </span>
                      <span className="shrink-0 text-center">
                        {r.reversed
                          ? <CheckCircle2 className="h-3.5 w-3.5 inline" style={{ color: JARVIS.colors.green }} />
                          : <span className="text-[var(--j-text-mute)]">—</span>}
                      </span>
                      <span className="shrink-0 text-right" onClick={(e) => e.stopPropagation()}>
                        {r.reversible && !r.reversed ? (
                          <button
                            onClick={() => setReverseTarget(r)}
                            className="jarvis-mono text-[9px] uppercase px-1.5 py-0.5 rounded border"
                            style={{
                              color: JARVIS.colors.amber,
                              borderColor: `${JARVIS.colors.amber}40`,
                              background: `${JARVIS.colors.amber}10`,
                            }}
                          >
                            reverse
                          </button>
                        ) : (
                          <span className="text-[var(--j-text-mute)]">—</span>
                        )}
                      </span>
                    </div>
                    <AnimatePresence>
                      {expanded && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          className="px-4 pb-3 pt-1 bg-[var(--j-panel-soft)]/30 overflow-hidden"
                        >
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <div>
                              <div className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)] mb-1">before state</div>
                              <pre className="text-[10px] text-[var(--j-text-dim)] font-mono bg-[var(--j-bg-soft)] border border-[var(--j-border-soft)] rounded p-2 max-h-48 overflow-auto jarvis-scroll">
                                {before ? JSON.stringify(before, null, 2) : 'null'}
                              </pre>
                            </div>
                            <div>
                              <div className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)] mb-1">after state</div>
                              <pre className="text-[10px] text-[var(--j-text-dim)] font-mono bg-[var(--j-bg-soft)] border border-[var(--j-border-soft)] rounded p-2 max-h-48 overflow-auto jarvis-scroll">
                                {after ? JSON.stringify(after, null, 2) : 'null'}
                              </pre>
                            </div>
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                            <div>
                              <div className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)] mb-1">meta</div>
                              <pre className="text-[10px] text-[var(--j-text-mute)] font-mono bg-[var(--j-bg-soft)] border border-[var(--j-border-soft)] rounded p-2 max-h-32 overflow-auto jarvis-scroll">
                                {meta ? JSON.stringify(meta, null, 2) : '{}'}
                              </pre>
                            </div>
                            <div>
                              <div className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)] mb-1">reverse result</div>
                              <pre className="text-[10px] font-mono bg-[var(--j-bg-soft)] border border-[var(--j-border-soft)] rounded p-2 max-h-32 overflow-auto jarvis-scroll"
                                style={{ color: r.reversed ? JARVIS.colors.green : JARVIS.colors.amber }}
                              >
                                {revResult ? JSON.stringify(revResult, null, 2) : (r.reversible ? 'not yet reversed' : 'irreversible')}
                              </pre>
                            </div>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>
                );
              })}
            </div>
          ) : (
            <EmptyState
              icon={History}
              message="No actions logged yet"
              hint="Once you start creating, updating, or deleting entities (payments, agents, tasks, files, configs), each mutation will be logged here and can be reversed."
              accent={JARVIS.colors.green}
            />
          )}
        </div>
      </div>

      {/* Reverse confirmation dialog */}
      <AnimatePresence>
        {reverseTarget && (
          <ReverseConfirmDialog
            row={reverseTarget}
            onCancel={() => setReverseTarget(null)}
            onConfirm={(by) => doReverse(reverseTarget, by)}
            busy={reversing}
          />
        )}
      </AnimatePresence>

      {/* Footer hint */}
      <div className="text-[10px] text-[var(--j-text-mute)] flex items-center gap-2">
        <Pill color={JARVIS.colors.green}>rule</Pill>
        <span>every change is logged with before/after state so it can be reversed — exec actions are marked non-reversible.</span>
      </div>
    </div>
  );
}

function ReverseConfirmDialog({
  row, onCancel, onConfirm, busy,
}: {
  row: ActionRow;
  onCancel: () => void;
  onConfirm: (reversedBy: string) => void;
  busy: boolean;
}) {
  const [by, setBy] = useState('operator');
  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
    >
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={busy ? undefined : onCancel} />
      <motion.div
        initial={{ scale: 0.96, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        className="relative w-full max-w-md jarvis-panel p-5"
      >
        <div className="flex items-center gap-2 mb-3">
          <AlertTriangle className="h-4 w-4" style={{ color: JARVIS.colors.amber }} />
          <h3 className="jarvis-mono text-sm uppercase" style={{ color: JARVIS.colors.amber }}>Confirm Reversal</h3>
        </div>
        <div className="space-y-3 text-xs">
          <p className="text-[var(--j-text-dim)]">
            You are about to reverse this action. The system will use the recorded
            before/after state to perform the inverse mutation.
          </p>
          <div className="jarvis-panel p-3 space-y-1">
            <div><span className="text-[var(--j-text-mute)] jarvis-mono">action:</span> <span className="text-[var(--j-text)]">{row.action}</span></div>
            <div><span className="text-[var(--j-text-mute)] jarvis-mono">target:</span> <span className="text-[var(--j-text)]">{row.target ?? '—'}</span></div>
            <div><span className="text-[var(--j-text-mute)] jarvis-mono">category:</span> <span className="text-[var(--j-text)]">{row.category}</span></div>
            <div><span className="text-[var(--j-text-mute)] jarvis-mono">logged:</span> <span className="text-[var(--j-text)]">{timeAgo(row.createdAt)} by {row.actor}</span></div>
          </div>
          <div>
            <label className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">reversed by</label>
            <Input value={by} onChange={(e) => setBy(e.target.value)} className="bg-[var(--j-panel-soft)] border-[var(--j-border)] jarvis-mono mt-1" disabled={busy} />
          </div>
          <div className="flex gap-2 pt-2">
            <Button variant="outline" size="sm" className="flex-1" onClick={onCancel} disabled={busy}>
              Cancel
            </Button>
            <Button
              size="sm"
              className="flex-1"
              onClick={() => onConfirm(by.trim() || 'operator')}
              disabled={busy}
              style={{ background: `${JARVIS.colors.amber}1a`, color: JARVIS.colors.amber, border: `1px solid ${JARVIS.colors.amber}40` }}
            >
              {busy ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Reversing…</> : <><RotateCcw className="h-3.5 w-3.5 mr-1.5" /> Reverse</>}
            </Button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
