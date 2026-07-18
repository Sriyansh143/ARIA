'use client';

// =====================================================================
// ChangeRequestsTab — App-Change Approval Gate UI (Task ID 8)
// =====================================================================
// Permanent rule from the user:
//   "any changes in app or app built by our app which effect things the way
//    they work definitely need approval this is rule (it includes important
//    changes upgrades features adding or removal etc)"
//
// Pulls from /api/changes (which queries the ChangeRequest Prisma model).
// Stats cards: Pending, Approved, Rejected, Deployed, Rolled-Back, Avg Approval Time.
// Table: Title, Type (badge), Scope (badge), Proposed By, Status (colored),
// Created, Actions (Approve / Reject / Deploy / Rollback based on status).
// Filter by status + type. "Request New Change" → Dialog with all fields.
// Click row → expand to see description, rationale, impact, file paths,
// diff summary.
// =====================================================================

import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  GitPullRequest, RefreshCw, Filter, Loader2, Plus, X,
  CheckCircle2, XCircle, Rocket, RotateCcw, Clock, AlertTriangle,
} from 'lucide-react';
import { useApi, postJson } from '@/lib/hooks/use-api';
import { JARVIS, timeAgo } from '@/lib/config';
import { SectionTitle, StatCard, EmptyState, Pill } from '@/components/jarvis/shared';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';

interface ChangeRow {
  id: string;
  changeType: string;
  scope: string;
  title: string;
  description: string;
  rationale: string | null;
  impact: string | null;
  proposedBy: string;
  filePaths: string;
  diffSummary: string | null;
  approvalId: string | null;
  status: string;
  deployedAt: string | null;
  rolledBackAt: string | null;
  actionLogId: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ChangeStats {
  total: number;
  byStatus: Record<string, number>;
  byChangeType: Record<string, number>;
  byScope: Record<string, number>;
  avgApprovalMs: number | null;
}

interface ChangesResponse {
  rows: ChangeRow[];
  total: number;
  filters: {
    status: string | null;
    changeType: string | null;
    scope: string | null;
    limit: number;
    offset: number;
  };
  stats: ChangeStats | null;
  error?: string;
}

const CHANGE_TYPES = [
  { value: '', label: 'all types' },
  { value: 'feature-add', label: 'feature-add' },
  { value: 'feature-remove', label: 'feature-remove' },
  { value: 'upgrade', label: 'upgrade' },
  { value: 'dependency', label: 'dependency' },
  { value: 'schema', label: 'schema' },
  { value: 'config', label: 'config' },
  { value: 'rule', label: 'rule' },
  { value: 'hotfix', label: 'hotfix' },
  { value: 'refactor', label: 'refactor' },
] as const;

const STATUS_FILTERS = [
  { value: '', label: 'all statuses' },
  { value: 'pending', label: 'pending' },
  { value: 'approved', label: 'approved' },
  { value: 'rejected', label: 'rejected' },
  { value: 'deployed', label: 'deployed' },
  { value: 'rolled-back', label: 'rolled-back' },
] as const;

const TYPE_COLOR: Record<string, string> = {
  'feature-add': JARVIS.colors.green,
  'feature-remove': JARVIS.colors.red,
  'upgrade': JARVIS.colors.cyan,
  'dependency': JARVIS.colors.amber,
  'schema': JARVIS.colors.violet,
  'config': JARVIS.colors.violet,
  'rule': JARVIS.colors.amber,
  'hotfix': JARVIS.colors.red,
  'refactor': JARVIS.colors.cyan,
};

const SCOPE_COLOR: Record<string, string> = {
  'app': JARVIS.colors.cyan,
  'built-app': JARVIS.colors.amber,
  'mini-service': JARVIS.colors.green,
  'plugin': JARVIS.colors.violet,
};

const STATUS_COLOR: Record<string, string> = {
  'draft': JARVIS.colors.textDim,
  'pending': JARVIS.colors.amber,
  'approved': JARVIS.colors.green,
  'rejected': JARVIS.colors.red,
  'deployed': JARVIS.colors.cyan,
  'rolled-back': JARVIS.colors.violet,
};

function formatDuration(ms: number | null): string {
  if (ms === null) return '—';
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  return `${(ms / 3_600_000).toFixed(1)}h`;
}

function safeParseArray(raw: string): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export default function ChangeRequestsTab() {
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [actionTarget, setActionTarget] = useState<{ row: ChangeRow; action: 'approve' | 'reject' | 'deploy' | 'rollback' } | null>(null);
  const [busy, setBusy] = useState(false);

  const qs = useMemo(() => {
    const params = new URLSearchParams();
    params.set('limit', '100');
    params.set('offset', '0');
    params.set('stats', '1');
    if (statusFilter) params.set('status', statusFilter);
    if (typeFilter) params.set('changeType', typeFilter);
    return params.toString();
  }, [statusFilter, typeFilter]);

  const { data, loading, refresh } = useApi<ChangesResponse>(`/api/changes?${qs}`, 10000);
  const { toast } = useToast();

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const stats = data?.stats ?? null;

  const resetFilters = () => {
    setStatusFilter('');
    setTypeFilter('');
  };

  const doAction = async (target: { row: ChangeRow; action: 'approve' | 'reject' | 'deploy' | 'rollback' }, decidedBy: string, note: string) => {
    setBusy(true);
    try {
      const body: Record<string, unknown> = { action: target.action, decidedBy };
      if (note) body.decisionNote = note;
      if (target.action === 'rollback') body.rolledBy = decidedBy;
      if (target.action === 'deploy') body.deployedBy = decidedBy;
      const res = await postJson<{ row?: ChangeRow; error?: string; reversal?: unknown }>(
        `/api/changes/${target.row.id}`,
        body,
      );
      if (res.error) {
        toast({ title: `${target.action} failed`, description: res.error, variant: 'destructive' });
      } else {
        toast({ title: `Change ${target.action}d`, description: target.row.title });
      }
      setActionTarget(null);
      refresh();
    } catch (e) {
      toast({
        title: `${target.action} request failed`,
        description: e instanceof Error ? e.message : 'fetch error',
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <SectionTitle
        title="Change Requests"
        icon={GitPullRequest}
        accent={JARVIS.colors.amber}
        action={
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" className="jarvis-btn-accent border-0" onClick={() => setCreating(true)}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Request New Change
            </Button>
            <button
              onClick={refresh}
              className="flex h-8 w-8 items-center justify-center rounded-md border border-[var(--j-border)] text-[var(--j-text-dim)] hover:text-[var(--j-cyan)]"
              aria-label="Refresh"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          </div>
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <StatCard label="Pending" value={stats?.byStatus?.pending ?? 0} icon={Clock} accent={JARVIS.colors.amber} />
        <StatCard label="Approved" value={stats?.byStatus?.approved ?? 0} icon={CheckCircle2} accent={JARVIS.colors.green} />
        <StatCard label="Rejected" value={stats?.byStatus?.rejected ?? 0} icon={XCircle} accent={JARVIS.colors.red} />
        <StatCard label="Deployed" value={stats?.byStatus?.deployed ?? 0} icon={Rocket} accent={JARVIS.colors.cyan} />
        <StatCard label="Rolled-Back" value={stats?.byStatus?.['rolled-back'] ?? 0} icon={RotateCcw} accent={JARVIS.colors.violet} />
        <StatCard label="Avg Approve" value={formatDuration(stats?.avgApprovalMs ?? null)} icon={Clock} accent={JARVIS.colors.textDim} />
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
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          <div className="space-y-1">
            <label className="text-[10px] text-[var(--j-text-mute)] jarvis-mono uppercase">status</label>
            <Select
              value={statusFilter || '__all__'}
              onValueChange={(v) => setStatusFilter(v === '__all__' ? '' : v)}
            >
              <SelectTrigger className="h-9 jarvis-mono text-xs">
                <SelectValue placeholder="all statuses" />
              </SelectTrigger>
              <SelectContent>
                {STATUS_FILTERS.map((s) => (
                  <SelectItem key={s.value || '__all__'} value={s.value || '__all__'} className="jarvis-mono text-xs">
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] text-[var(--j-text-mute)] jarvis-mono uppercase">type</label>
            <Select
              value={typeFilter || '__all__'}
              onValueChange={(v) => setTypeFilter(v === '__all__' ? '' : v)}
            >
              <SelectTrigger className="h-9 jarvis-mono text-xs">
                <SelectValue placeholder="all types" />
              </SelectTrigger>
              <SelectContent>
                {CHANGE_TYPES.map((t) => (
                  <SelectItem key={t.value || '__all__'} value={t.value || '__all__'} className="jarvis-mono text-xs">
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1 flex items-end">
            <div className="text-[10px] text-[var(--j-text-mute)] jarvis-mono uppercase">
              showing {rows.length} of {total.toLocaleString()}
            </div>
          </div>
        </div>
      </div>

      {data?.error && (
        <div className="rounded-lg border border-[var(--j-red)]/40 bg-[var(--j-red)]/10 p-3 text-xs text-[var(--j-red)]">
          Failed to load change requests: {data.error}
        </div>
      )}

      {/* Table */}
      <div className="jarvis-panel p-0 overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-2 border-b border-[var(--j-border)] bg-[var(--j-panel-soft)]/40">
          <GitPullRequest className="h-3.5 w-3.5" style={{ color: JARVIS.colors.amber }} />
          <span className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">
            change requests · {rows.length} of {total.toLocaleString()} entries
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
              <div className="grid grid-cols-[1fr_90px_90px_100px_100px_90px_180px] gap-2 px-4 py-2 border-b border-[var(--j-border)] text-[10px] uppercase text-[var(--j-text-mute)] bg-[var(--j-panel-soft)]/30 sticky top-0">
                <span>title</span>
                <span>type</span>
                <span>scope</span>
                <span>proposed by</span>
                <span>status</span>
                <span>created</span>
                <span className="text-right">actions</span>
              </div>
              {rows.map((r, i) => {
                const typeColor = TYPE_COLOR[r.changeType] ?? JARVIS.colors.textDim;
                const scopeColor = SCOPE_COLOR[r.scope] ?? JARVIS.colors.textDim;
                const statusColor = STATUS_COLOR[r.status] ?? JARVIS.colors.textDim;
                const expanded = expandedId === r.id;
                const files = safeParseArray(r.filePaths);
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
                      className="grid grid-cols-[1fr_90px_90px_100px_100px_90px_180px] gap-2 px-4 py-2 hover:bg-[var(--j-panel-soft)]/40 items-start cursor-pointer"
                    >
                      <div className="min-w-0">
                        <div className="text-[var(--j-text)] truncate">{r.title}</div>
                        {r.actionLogId && (
                          <div className="text-[10px] text-[var(--j-text-mute)] mt-0.5">action log: {r.actionLogId}</div>
                        )}
                      </div>
                      <span className="shrink-0">
                        <span className="jarvis-mono text-[9px] uppercase px-1.5 py-0.5 rounded" style={{ color: typeColor, background: `${typeColor}1a`, border: `1px solid ${typeColor}33` }}>
                          {r.changeType}
                        </span>
                      </span>
                      <span className="shrink-0">
                        <span className="jarvis-mono text-[9px] uppercase px-1.5 py-0.5 rounded" style={{ color: scopeColor, background: `${scopeColor}1a`, border: `1px solid ${scopeColor}33` }}>
                          {r.scope}
                        </span>
                      </span>
                      <span className="shrink-0 text-[var(--j-cyan)] truncate" title={r.proposedBy}>{r.proposedBy}</span>
                      <span className="shrink-0">
                        <span className="jarvis-mono text-[9px] uppercase px-1.5 py-0.5 rounded" style={{ color: statusColor, background: `${statusColor}1a`, border: `1px solid ${statusColor}33` }}>
                          {r.status}
                        </span>
                      </span>
                      <span className="shrink-0 text-[var(--j-text-mute)]" title={new Date(r.createdAt).toLocaleString()}>
                        {timeAgo(r.createdAt)}
                      </span>
                      <span className="shrink-0 text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex justify-end gap-1 flex-wrap">
                          {r.status === 'pending' && (
                            <>
                              <ActionButton label="Approve" color={JARVIS.colors.green} onClick={() => setActionTarget({ row: r, action: 'approve' })} />
                              <ActionButton label="Reject" color={JARVIS.colors.red} onClick={() => setActionTarget({ row: r, action: 'reject' })} />
                            </>
                          )}
                          {r.status === 'approved' && (
                            <ActionButton label="Deploy" color={JARVIS.colors.cyan} onClick={() => setActionTarget({ row: r, action: 'deploy' })} />
                          )}
                          {r.status === 'deployed' && (
                            <ActionButton label="Rollback" color={JARVIS.colors.violet} onClick={() => setActionTarget({ row: r, action: 'rollback' })} />
                          )}
                          {(r.status === 'rejected' || r.status === 'rolled-back') && (
                            <span className="text-[var(--j-text-mute)] text-[10px]">—</span>
                          )}
                        </div>
                      </span>
                    </div>
                    <AnimatePresence>
                      {expanded && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          className="px-4 pb-4 pt-1 bg-[var(--j-panel-soft)]/30 overflow-hidden"
                        >
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <div>
                              <div className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)] mb-1">description</div>
                              <p className="text-xs text-[var(--j-text-dim)]">{r.description}</p>
                            </div>
                            <div>
                              <div className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)] mb-1">rationale</div>
                              <p className="text-xs text-[var(--j-text-dim)]">{r.rationale ?? '—'}</p>
                            </div>
                            <div>
                              <div className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)] mb-1">impact</div>
                              <p className="text-xs text-[var(--j-text-dim)]">{r.impact ?? '—'}</p>
                            </div>
                            <div>
                              <div className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)] mb-1">file paths</div>
                              {files.length ? (
                                <div className="flex flex-col gap-0.5">
                                  {files.map((p, idx) => (
                                    <span key={idx} className="text-[10px] text-[var(--j-text-mute)] font-mono truncate">{p}</span>
                                  ))}
                                </div>
                              ) : (
                                <span className="text-[10px] text-[var(--j-text-mute)]">none</span>
                              )}
                            </div>
                            {r.diffSummary && (
                              <div className="md:col-span-2">
                                <div className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)] mb-1">diff summary</div>
                                <pre className="text-[10px] text-[var(--j-text-mute)] font-mono bg-[var(--j-bg-soft)] border border-[var(--j-border-soft)] rounded p-2 max-h-32 overflow-auto jarvis-scroll">
                                  {r.diffSummary}
                                </pre>
                              </div>
                            )}
                            {(r.deployedAt || r.rolledBackAt) && (
                              <div className="md:col-span-2 flex gap-3 text-[10px] text-[var(--j-text-mute)]">
                                {r.deployedAt && <span>deployed: {timeAgo(r.deployedAt)}</span>}
                                {r.rolledBackAt && <span>rolled back: {timeAgo(r.rolledBackAt)}</span>}
                              </div>
                            )}
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
              icon={GitPullRequest}
              message="No change requests yet"
              hint="Any change that affects how the app works — feature add/remove, upgrade, dependency, schema, config, rule, hotfix, refactor — must go through this approval gate."
              accent={JARVIS.colors.amber}
            />
          )}
        </div>
      </div>

      {/* Create dialog */}
      <AnimatePresence>
        {creating && (
          <CreateChangeDialog
            onClose={() => setCreating(false)}
            onDone={() => { setCreating(false); refresh(); }}
          />
        )}
      </AnimatePresence>

      {/* Action confirmation dialog */}
      <AnimatePresence>
        {actionTarget && (
          <ActionConfirmDialog
            target={actionTarget}
            busy={busy}
            onCancel={() => setActionTarget(null)}
            onConfirm={(by, note) => doAction(actionTarget, by, note)}
          />
        )}
      </AnimatePresence>

      {/* Footer hint */}
      <div className="text-[10px] text-[var(--j-text-mute)] flex items-center gap-2">
        <Pill color={JARVIS.colors.amber}>rule</Pill>
        <span>any change to the app or built-apps that affects how things work must be approved before deploy — feature add/remove, upgrades, schema, config, rule changes, hotfixes, refactors.</span>
      </div>
    </div>
  );
}

function ActionButton({ label, color, onClick }: { label: string; color: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="jarvis-mono text-[9px] uppercase px-1.5 py-0.5 rounded border transition-colors"
      style={{
        color,
        borderColor: `${color}40`,
        background: `${color}10`,
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = `${color}30`; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = `${color}10`; }}
    >
      {label}
    </button>
  );
}

function CreateChangeDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { toast } = useToast();
  const [changeType, setChangeType] = useState('feature-add');
  const [scope, setScope] = useState('app');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [rationale, setRationale] = useState('');
  const [impact, setImpact] = useState('');
  const [proposedBy, setProposedBy] = useState('operator');
  const [filePathsRaw, setFilePathsRaw] = useState('');
  const [diffSummary, setDiffSummary] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!title.trim() || !description.trim()) {
      toast({ title: 'Title and description are required', variant: 'destructive' });
      return;
    }
    setBusy(true);
    try {
      const filePaths = filePathsRaw
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);
      await postJson('/api/changes', {
        changeType, scope, title, description,
        rationale: rationale || undefined,
        impact: impact || undefined,
        proposedBy: proposedBy || undefined,
        filePaths,
        diffSummary: diffSummary || undefined,
      });
      toast({ title: 'Change request created', description: title });
      onDone();
    } catch (e) {
      toast({
        title: 'Create failed',
        description: e instanceof Error ? e.message : 'fetch error',
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
    >
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={busy ? undefined : onClose} />
      <motion.div
        initial={{ scale: 0.96, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        className="relative w-full max-w-lg jarvis-panel p-5 max-h-[90vh] overflow-y-auto jarvis-scroll"
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="jarvis-mono text-sm uppercase" style={{ color: JARVIS.colors.amber }}>New Change Request</h3>
          <button onClick={onClose} className="text-[var(--j-text-mute)] hover:text-[var(--j-text)]"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">change type</label>
              <Select value={changeType} onValueChange={setChangeType}>
                <SelectTrigger className="bg-[var(--j-panel-soft)] border-[var(--j-border)] mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CHANGE_TYPES.filter((t) => t.value).map((t) => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">scope</label>
              <Select value={scope} onValueChange={setScope}>
                <SelectTrigger className="bg-[var(--j-panel-soft)] border-[var(--j-border)] mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {['app', 'built-app', 'mini-service', 'plugin'].map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <label className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">title</label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Add Stripe payment gateway" className="bg-[var(--j-panel-soft)] border-[var(--j-border)] mt-1" disabled={busy} />
          </div>
          <div>
            <label className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">description</label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Describe what is changing…" className="bg-[var(--j-panel-soft)] border-[var(--j-border)] mt-1 min-h-[80px]" disabled={busy} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">rationale</label>
              <Textarea value={rationale} onChange={(e) => setRationale(e.target.value)} placeholder="Why is this needed?" className="bg-[var(--j-panel-soft)] border-[var(--j-border)] mt-1 min-h-[60px]" disabled={busy} />
            </div>
            <div>
              <label className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">impact</label>
              <Textarea value={impact} onChange={(e) => setImpact(e.target.value)} placeholder="What could break?" className="bg-[var(--j-panel-soft)] border-[var(--j-border)] mt-1 min-h-[60px]" disabled={busy} />
            </div>
          </div>
          <div>
            <label className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">file paths (one per line)</label>
            <Textarea value={filePathsRaw} onChange={(e) => setFilePathsRaw(e.target.value)} placeholder={'src/lib/payments.ts\nsrc/app/api/payments/route.ts'} className="bg-[var(--j-panel-soft)] border-[var(--j-border)] mt-1 font-mono text-xs min-h-[60px]" disabled={busy} />
          </div>
          <div>
            <label className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">diff summary (optional)</label>
            <Textarea value={diffSummary} onChange={(e) => setDiffSummary(e.target.value)} placeholder="+120 / -45 across 3 files" className="bg-[var(--j-panel-soft)] border-[var(--j-border)] mt-1 font-mono text-xs min-h-[40px]" disabled={busy} />
          </div>
          <div>
            <label className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">proposed by</label>
            <Input value={proposedBy} onChange={(e) => setProposedBy(e.target.value)} placeholder="operator" className="bg-[var(--j-panel-soft)] border-[var(--j-border)] mt-1 jarvis-mono" disabled={busy} />
          </div>
          <Button onClick={save} disabled={busy} className="w-full jarvis-btn-accent border-0">
            {busy ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Submitting…</> : 'Submit Change Request'}
          </Button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function ActionConfirmDialog({
  target, onCancel, onConfirm, busy,
}: {
  target: { row: ChangeRow; action: 'approve' | 'reject' | 'deploy' | 'rollback' };
  onCancel: () => void;
  onConfirm: (by: string, note: string) => void;
  busy: boolean;
}) {
  const [by, setBy] = useState('operator');
  const [note, setNote] = useState('');
  const colorMap: Record<string, string> = {
    approve: JARVIS.colors.green,
    reject: JARVIS.colors.red,
    deploy: JARVIS.colors.cyan,
    rollback: JARVIS.colors.violet,
  };
  const color = colorMap[target.action];
  const action = target.action;
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
          <AlertTriangle className="h-4 w-4" style={{ color }} />
          <h3 className="jarvis-mono text-sm uppercase" style={{ color }}>
            {action === 'rollback' ? 'Confirm Rollback' : `Confirm ${action[0].toUpperCase()}${action.slice(1)}`}
          </h3>
        </div>
        <div className="space-y-3 text-xs">
          <p className="text-[var(--j-text-dim)]">
            {action === 'approve' && 'You are about to approve this change request. It can then be deployed.'}
            {action === 'reject' && 'You are about to reject this change request. The proposed change will not proceed.'}
            {action === 'deploy' && 'You are marking this change as deployed. If an actionLogId is linked, the deploy will be reversible.'}
            {action === 'rollback' && 'You are about to roll back this deployed change. If an actionLogId is linked, the underlying mutation will be reversed.'}
          </p>
          <div className="jarvis-panel p-3 space-y-1">
            <div><span className="text-[var(--j-text-mute)] jarvis-mono">title:</span> <span className="text-[var(--j-text)]">{target.row.title}</span></div>
            <div><span className="text-[var(--j-text-mute)] jarvis-mono">type:</span> <span className="text-[var(--j-text)]">{target.row.changeType}</span></div>
            <div><span className="text-[var(--j-text-mute)] jarvis-mono">scope:</span> <span className="text-[var(--j-text)]">{target.row.scope}</span></div>
            <div><span className="text-[var(--j-text-mute)] jarvis-mono">proposed by:</span> <span className="text-[var(--j-text)]">{target.row.proposedBy}</span></div>
          </div>
          <div>
            <label className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">{action === 'rollback' ? 'rolled by' : action === 'deploy' ? 'deployed by' : 'decided by'}</label>
            <Input value={by} onChange={(e) => setBy(e.target.value)} className="bg-[var(--j-panel-soft)] border-[var(--j-border)] jarvis-mono mt-1" disabled={busy} />
          </div>
          <div>
            <label className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">note (optional)</label>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} className="bg-[var(--j-panel-soft)] border-[var(--j-border)] mt-1 min-h-[50px]" disabled={busy} />
          </div>
          <div className="flex gap-2 pt-2">
            <Button variant="outline" size="sm" className="flex-1" onClick={onCancel} disabled={busy}>
              Cancel
            </Button>
            <Button
              size="sm"
              className="flex-1"
              onClick={() => onConfirm(by.trim() || 'operator', note.trim())}
              disabled={busy}
              style={{ background: `${color}1a`, color, border: `1px solid ${color}40` }}
            >
              {busy ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Working…</> : action === 'rollback' ? <><RotateCcw className="h-3.5 w-3.5 mr-1.5" /> Rollback</> : action === 'approve' ? <><CheckCircle2 className="h-3.5 w-3.5 mr-1.5" /> Approve</> : action === 'reject' ? <><XCircle className="h-3.5 w-3.5 mr-1.5" /> Reject</> : <><Rocket className="h-3.5 w-3.5 mr-1.5" /> Deploy</>}
            </Button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
