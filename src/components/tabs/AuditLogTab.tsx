'use client';

// =====================================================================
// AuditLogTab — filterable table of admin/operator audit events.
// =====================================================================
// Task ID 4 (PARALLEL-C — zip import).
//
// Pulls from /api/audit (which queries the AuditLog Prisma model).
// Filters: actor (free-text), action-prefix (select), target (free-text),
// since (datetime). Pagination via "Load more" button (100/page).
//
// NOTE: This tab is intentionally NOT registered in page-client.tsx —
// another agent (tab consolidation) is wiring all new tabs into the
// nav store. The component is exported here so it can be imported when
// that wiring happens.
// =====================================================================

import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { ScrollText, RefreshCw, ShieldCheck, Filter, Loader2 } from 'lucide-react';
import { useApi } from '@/lib/hooks/use-api';
import { JARVIS, fmtTime, timeAgo } from '@/lib/config';
import { SectionTitle, StatCard, EmptyState, Pill } from '@/components/jarvis/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';

interface AuditEntry {
  id: string;
  actor: string;
  action: string;
  target: string | null;
  meta: string; // JSON string
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
}

interface AuditResponse {
  entries: AuditEntry[];
  total: number;
  filters: {
    actor: string | null;
    action: string | null;
    target: string | null;
    since: string | null;
    limit: number;
    offset: number;
  };
  error?: string;
}

// Action prefix buckets — these match the constants in src/lib/audit-log.ts.
const ACTION_PREFIXES = [
  { value: '', label: 'all actions' },
  { value: 'auth.', label: 'auth.*' },
  { value: 'user.', label: 'user.*' },
  { value: 'agent.', label: 'agent.*' },
  { value: 'task.', label: 'task.*' },
  { value: 'skill.', label: 'skill.*' },
  { value: 'pipeline.', label: 'pipeline.*' },
  { value: 'data.', label: 'data.*' },
  { value: 'backup.', label: 'backup.*' },
  { value: 'cron.', label: 'cron.*' },
  { value: 'settings.', label: 'settings.*' },
  { value: 'admin.', label: 'admin.*' },
] as const;

function actionColor(action: string): string {
  if (action.startsWith('delete') || action.startsWith('agent.delete') || action.startsWith('user.delete')) return JARVIS.colors.red;
  if (action.startsWith('create') || action.endsWith('.create')) return JARVIS.colors.green;
  if (action.startsWith('update') || action.endsWith('.update')) return JARVIS.colors.amber;
  if (action.startsWith('run') || action.endsWith('.run')) return JARVIS.colors.cyan;
  if (action.startsWith('auth')) return JARVIS.colors.violet;
  return JARVIS.colors.textDim;
}

function safeParseMeta(raw: string): Record<string, unknown> | null {
  if (!raw || raw === '{}') return null;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export default function AuditLogTab() {
  // Filters
  const [actor, setActor] = useState('');
  const [actionPrefix, setActionPrefix] = useState<string>('');
  const [target, setTarget] = useState('');
  const [since, setSince] = useState('');

  // Pagination — we keep a list of accumulated entries (page 1 + "Load more")
  const [page, setPage] = useState(0);
  const pageSize = 100;

  // Build the query string. Memoised so the polling hook doesn't refire
  // on every render.
  const qs = useMemo(() => {
    const params = new URLSearchParams();
    params.set('limit', String(pageSize));
    params.set('offset', String(page * pageSize));
    if (actor.trim()) params.set('actor', actor.trim());
    if (actionPrefix) params.set('action', actionPrefix);
    if (target.trim()) params.set('target', target.trim());
    if (since) params.set('since', new Date(since).toISOString());
    return params.toString();
  }, [actor, actionPrefix, target, since, page]);

  const { data, loading, refresh } = useApi<AuditResponse>(`/api/audit?${qs}`, 15000);
  const entries = data?.entries ?? [];
  const total = data?.total ?? 0;
  const hasMore = entries.length < total;

  const resetFilters = () => {
    setActor('');
    setActionPrefix('');
    setTarget('');
    setSince('');
    setPage(0);
  };

  // Distinct actor list (derived from the current page) — used to populate
  // the actor datalist for quick pick.
  const actors = useMemo(
    () => Array.from(new Set(entries.map((e) => e.actor))).sort(),
    [entries],
  );

  return (
    <div className="space-y-4">
      <SectionTitle
        title="Audit Log"
        icon={ScrollText}
        accent={JARVIS.colors.amber}
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

      {/* Stats strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Total Entries" value={total.toLocaleString()} icon={ScrollText} accent={JARVIS.colors.amber} />
        <StatCard label="Unique Actors" value={actors.length} icon={ShieldCheck} accent={JARVIS.colors.cyan} />
        <StatCard label="Showing" value={entries.length} icon={Filter} accent={JARVIS.colors.green} />
        <StatCard label="Last Entry" value={entries[0] ? timeAgo(entries[0].createdAt) : '—'} icon={RefreshCw} accent={JARVIS.colors.violet} />
      </div>

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
              list="audit-actor-list"
              value={actor}
              onChange={(e) => { setActor(e.target.value); setPage(0); }}
              placeholder="operator"
              className="jarvis-mono text-xs h-9"
            />
            <datalist id="audit-actor-list">
              {actors.map((a) => <option key={a} value={a} />)}
            </datalist>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] text-[var(--j-text-mute)] jarvis-mono uppercase">action</label>
            <Select
              value={actionPrefix || '__all__'}
              onValueChange={(v) => { setActionPrefix(v === '__all__' ? '' : v); setPage(0); }}
            >
              <SelectTrigger className="h-9 jarvis-mono text-xs">
                <SelectValue placeholder="all actions" />
              </SelectTrigger>
              <SelectContent>
                {ACTION_PREFIXES.map((p) => (
                  <SelectItem key={p.value || '__all__'} value={p.value || '__all__'} className="jarvis-mono text-xs">
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] text-[var(--j-text-mute)] jarvis-mono uppercase">target</label>
            <Input
              value={target}
              onChange={(e) => { setTarget(e.target.value); setPage(0); }}
              placeholder="agent:abc"
              className="jarvis-mono text-xs h-9"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] text-[var(--j-text-mute)] jarvis-mono uppercase">since</label>
            <Input
              type="datetime-local"
              value={since}
              onChange={(e) => { setSince(e.target.value); setPage(0); }}
              className="jarvis-mono text-xs h-9"
            />
          </div>
        </div>
      </div>

      {data?.error && (
        <div className="rounded-lg border border-[var(--j-red)]/40 bg-[var(--j-red)]/10 p-3 text-xs text-[var(--j-red)]">
          Failed to load audit log: {data.error}
        </div>
      )}

      {/* Table */}
      <div className="jarvis-panel p-0 overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-2 border-b border-[var(--j-border)] bg-[var(--j-panel-soft)]/40">
          <ScrollText className="h-3.5 w-3.5 text-[var(--j-amber)]" style={{ color: JARVIS.colors.amber }} />
          <span className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">
            audit trail · {entries.length} of {total.toLocaleString()} entries
          </span>
        </div>

        <div className="max-h-[60vh] overflow-y-auto jarvis-scroll">
          {loading && !data ? (
            <div className="p-4 flex items-center gap-2 text-[var(--j-text-mute)] text-xs">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> loading…
            </div>
          ) : entries.length ? (
            <div className="font-mono text-xs">
              {/* Header row */}
              <div className="grid grid-cols-[100px_120px_1fr_140px_70px] gap-2 px-4 py-2 border-b border-[var(--j-border)] text-[10px] uppercase text-[var(--j-text-mute)] bg-[var(--j-panel-soft)]/30 sticky top-0">
                <span>time</span>
                <span>actor</span>
                <span>action / target</span>
                <span>ip</span>
                <span className="text-right">meta</span>
              </div>
              {entries.map((e, i) => {
                const color = actionColor(e.action);
                const meta = safeParseMeta(e.meta);
                return (
                  <motion.div
                    key={e.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: Math.min(i * 0.005, 0.3) }}
                    className="grid grid-cols-[100px_120px_1fr_140px_70px] gap-2 px-4 py-1.5 border-b border-[var(--j-border-soft)] hover:bg-[var(--j-panel-soft)]/40 items-start"
                  >
                    <span className="text-[var(--j-text-mute)] shrink-0 tabular-nums" title={new Date(e.createdAt).toLocaleString()}>
                      {fmtTime(new Date(e.createdAt))}
                    </span>
                    <span className="shrink-0 text-[var(--j-cyan)] truncate" title={e.actor}>{e.actor}</span>
                    <div className="min-w-0 flex flex-col gap-0.5">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span
                          className="jarvis-mono text-[10px] uppercase px-1.5 py-0.5 rounded"
                          style={{ color, background: `${color}1a`, border: `1px solid ${color}33` }}
                        >
                          {e.action}
                        </span>
                        {e.target && (
                          <span className="text-[var(--j-text-dim)] truncate">{e.target}</span>
                        )}
                      </div>
                      {meta && (
                        <pre className="text-[10px] text-[var(--j-text-mute)] truncate font-mono" title={JSON.stringify(meta)}>
                          {JSON.stringify(meta).slice(0, 200)}
                        </pre>
                      )}
                    </div>
                    <span className="shrink-0 text-[var(--j-text-mute)] truncate text-[10px]" title={e.ipAddress ?? ''}>
                      {e.ipAddress ?? '—'}
                    </span>
                    <span className="shrink-0 text-right text-[10px]">
                      {meta ? <Pill color={JARVIS.colors.violet}>json</Pill> : <span className="text-[var(--j-text-mute)]">—</span>}
                    </span>
                  </motion.div>
                );
              })}
            </div>
          ) : (
            <EmptyState
              icon={ShieldCheck}
              message="No audit entries match your filters"
              hint="Try adjusting the actor, action, target, or since filters above. New admin actions (seed, clear, backup, cron toggle) will appear here automatically."
              accent={JARVIS.colors.amber}
            />
          )}
        </div>
      </div>

      {/* Load more */}
      {hasMore && entries.length > 0 && (
        <div className="flex justify-center pt-1">
          <Button
            variant="outline"
            size="sm"
            className="jarvis-btn-accent border-0"
            onClick={() => setPage((p) => p + 1)}
            disabled={loading}
          >
            {loading ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Loading…</> : <>Load more ({total - entries.length} remaining)</>}
          </Button>
        </div>
      )}
    </div>
  );
}
