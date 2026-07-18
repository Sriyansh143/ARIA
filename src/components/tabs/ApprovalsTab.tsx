'use client';

// =====================================================================
// ApprovalsTab — ApprovalRequest lifecycle UI + escalation engine panel.
// =====================================================================
// Task ID: 3-ESCALATION
//
// Shows:
//   - Stats cards (pending, escalating, approved today, rejected today,
//     avg response time, expired total)
//   - Filterable table of approvals (status / category filters)
//   - Per-row escalation level (0/1/2/3 with colored dots)
//   - "Next escalation" countdown for pending approvals
//   - Inline approve/reject buttons with optional note input
//   - Row expand → full description + payload JSON
//   - "Create Approval" dialog (operator can request one)
//   - "Test Escalation Sweep" button → POST /api/approvals/escalate
// =====================================================================

import { useMemo, useState, useEffect, Fragment } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ShieldCheck, BellRing, Clock, CheckCircle2, XCircle, AlertTriangle,
  Loader2, Plus, ChevronDown, ChevronRight, Zap, Timer, History, Phone,
  Mail, MessageSquare,
} from 'lucide-react';
import { useApi, postJson } from '@/lib/hooks/use-api';
import { JARVIS, fmtTime, timeAgo } from '@/lib/config';
import { SectionTitle, StatCard, EmptyState, Pill } from '@/components/jarvis/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';

// ─── Types ────────────────────────────────────────────────────────────

interface ApprovalRow {
  id: string;
  category: string;
  title: string;
  description: string;
  requestedBy: string;
  payload: string;
  status: string;
  decidedBy: string | null;
  decisionNote: string | null;
  escalationLevel: number;
  lastEscalatedAt: string | null;
  nextEscalateAt: string | null;
  resolvedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ApprovalStats {
  byStatus: Record<string, number>;
  byCategory: Record<string, number>;
  pending: number;
  escalating: number;
  escalatedTotal: number;
  approvedToday: number;
  rejectedToday: number;
  expiredTotal: number;
  avgResponseMinutes: number | null;
  oldestPendingMinutes: number | null;
}

interface ApprovalsResponse {
  approvals: ApprovalRow[];
  count: number;
  filters: { status: string; category: string; limit: number };
  stats: ApprovalStats | null;
  error?: string;
}

// ─── Constants ────────────────────────────────────────────────────────

const STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'all', label: 'all statuses' },
  { value: 'pending', label: 'pending' },
  { value: 'approved', label: 'approved' },
  { value: 'rejected', label: 'rejected' },
  { value: 'expired', label: 'expired' },
  { value: 'superseded', label: 'superseded' },
];

const CATEGORY_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'all', label: 'all categories' },
  { value: 'app-change', label: 'app-change' },
  { value: 'payment-refund', label: 'payment-refund' },
  { value: 'earning-deploy', label: 'earning-deploy' },
  { value: 'agent-spawn', label: 'agent-spawn' },
  { value: 'plan-step', label: 'plan-step' },
  { value: 'destructive-cmd', label: 'destructive-cmd' },
  { value: 'other', label: 'other' },
];

const STATUS_COLORS: Record<string, string> = {
  pending: JARVIS.colors.amber,
  approved: JARVIS.colors.green,
  rejected: JARVIS.colors.red,
  expired: JARVIS.colors.textMute,
  superseded: JARVIS.colors.violet,
};

const ESCALATION_COLORS: Array<string> = [
  JARVIS.colors.textMute, // Level 0 — gray
  JARVIS.colors.amber,    // Level 1 — amber
  '#FB923C',              // Level 2 — orange (no direct JARVIS token)
  JARVIS.colors.red,      // Level 3 — red
];

const CATEGORY_COLORS: Record<string, string> = {
  'app-change': JARVIS.colors.violet,
  'payment-refund': JARVIS.colors.green,
  'earning-deploy': JARVIS.colors.cyan,
  'agent-spawn': JARVIS.colors.amber,
  'plan-step': JARVIS.colors.cyan,
  'destructive-cmd': JARVIS.colors.red,
  other: JARVIS.colors.textDim,
};

// ─── Helpers ──────────────────────────────────────────────────────────

function shortId(id: string, n = 8): string {
  return id.length > n ? `${id.slice(0, n)}…` : id;
}

function safeParsePayload(raw: string): Record<string, unknown> | null {
  if (!raw || raw === '{}') return null;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function countdownTo(dateStr: string | null): { label: string; overdue: boolean } {
  if (!dateStr) return { label: '—', overdue: false };
  const target = new Date(dateStr).getTime();
  const now = Date.now();
  const diffMs = target - now;
  if (diffMs <= 0) return { label: 'overdue', overdue: true };
  const minutes = Math.floor(diffMs / 60000);
  const seconds = Math.floor((diffMs % 60000) / 1000);
  if (minutes > 60) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return { label: `${h}h ${m}m`, overdue: false };
  }
  if (minutes > 0) return { label: `${minutes}m ${seconds}s`, overdue: false };
  return { label: `${seconds}s`, overdue: false };
}

function EscalationDots({ level }: { level: number }) {
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3].map((n) => {
        const filled = level >= n;
        const color = ESCALATION_COLORS[n];
        return (
          <span
            key={n}
            className="inline-block rounded-full transition-all"
            style={{
              width: 8,
              height: 8,
              background: filled ? color : 'transparent',
              border: `1px solid ${color}66`,
              boxShadow: filled ? `0 0 6px ${color}80` : 'none',
            }}
            title={`Level ${n}: ${n === 1 ? 'Telegram' : n === 2 ? 'Telegram + Email' : 'Telegram + Email + Voice'}`}
          />
        );
      })}
      <span
        className="ml-1 jarvis-mono text-[9px] uppercase"
        style={{ color: ESCALATION_COLORS[level] ?? JARVIS.colors.textMute }}
      >
        L{level}
      </span>
    </div>
  );
}

// Live countdown — re-renders every second so the "next escalation in 5m 23s"
// is always accurate.
function useLiveTick(): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);
  return tick;
}

// ─── Component ────────────────────────────────────────────────────────

export default function ApprovalsTab() {
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [decideTarget, setDecideTarget] = useState<{ approval: ApprovalRow; decision: 'approved' | 'rejected' } | null>(null);
  const [decideNote, setDecideNote] = useState('');
  const [decideBusy, setDecideBusy] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [escalating, setEscalating] = useState(false);

  // Build the query string. Memoised so the polling hook doesn't refire.
  const qs = useMemo(() => {
    const params = new URLSearchParams();
    params.set('status', statusFilter);
    params.set('category', categoryFilter);
    params.set('limit', '200');
    return params.toString();
  }, [statusFilter, categoryFilter]);

  const { data, loading, refresh } = useApi<ApprovalsResponse>(`/api/approvals?${qs}`, 8000);
  // Re-render every second for live countdowns.
  useLiveTick();

  const approvals = data?.approvals ?? [];
  const stats = data?.stats;

  const handleEscalate = async () => {
    setEscalating(true);
    try {
      const res = await postJson<{
        ok: boolean;
        escalated: number;
        expired: number;
        details: Array<{ id: string; title: string; level: number; channels: string[]; expired: boolean }>;
        error?: string;
      }>('/api/approvals/escalate', { manual: true });
      toast({
        title: `Escalation sweep complete`,
        description: `Escalated ${res.escalated} · Expired ${res.expired}`,
      });
      refresh();
    } catch (e) {
      toast({
        title: 'Escalation sweep failed',
        description: e instanceof Error ? e.message : '',
        variant: 'destructive',
      });
    } finally {
      setEscalating(false);
    }
  };

  const handleDecide = async () => {
    if (!decideTarget) return;
    setDecideBusy(true);
    try {
      await postJson(`/api/approvals/${decideTarget.approval.id}`, {
        decision: decideTarget.decision,
        decidedBy: 'operator',
        decisionNote: decideNote.trim() || undefined,
      });
      toast({
        title: `Approval ${decideTarget.decision}`,
        description: decideTarget.approval.title,
      });
      setDecideTarget(null);
      setDecideNote('');
      refresh();
    } catch (e) {
      toast({
        title: `Failed to ${decideTarget.decision} approval`,
        description: e instanceof Error ? e.message : '',
        variant: 'destructive',
      });
    } finally {
      setDecideBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <SectionTitle
        title="Approvals & Escalation"
        icon={ShieldCheck}
        accent={JARVIS.colors.red}
        action={
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-[10px] jarvis-mono uppercase border-[var(--j-border)] hover:border-[var(--j-amber)] hover:text-[var(--j-amber)]"
              onClick={handleEscalate}
              disabled={escalating}
            >
              {escalating ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Zap className="h-3.5 w-3.5 mr-1.5" />}
              Test Escalation
            </Button>
            <Button
              size="sm"
              className="h-8 text-[10px] jarvis-mono uppercase bg-[var(--j-red)] hover:bg-[var(--j-red)]/80 text-white"
              onClick={() => setCreateOpen(true)}
            >
              <Plus className="h-3.5 w-3.5 mr-1.5" />
              New Approval
            </Button>
            <button
              onClick={refresh}
              className="flex h-8 w-8 items-center justify-center rounded-md border border-[var(--j-border)] text-[var(--j-text-dim)] hover:text-[var(--j-cyan)]"
              aria-label="Refresh"
            >
              <History className="h-3.5 w-3.5" />
            </button>
          </div>
        }
      />

      {/* Stats strip */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard
          label="Pending"
          value={stats?.pending ?? 0}
          icon={Clock}
          accent={JARVIS.colors.amber}
          sub={stats && stats.oldestPendingMinutes !== null ? `oldest: ${stats.oldestPendingMinutes}m` : undefined}
        />
        <StatCard
          label="Escalating"
          value={stats?.escalating ?? 0}
          icon={BellRing}
          accent={JARVIS.colors.red}
          sub={stats && stats.escalatedTotal > 0 ? `total escalated: ${stats.escalatedTotal}` : undefined}
        />
        <StatCard
          label="Approved Today"
          value={stats?.approvedToday ?? 0}
          icon={CheckCircle2}
          accent={JARVIS.colors.green}
        />
        <StatCard
          label="Rejected Today"
          value={stats?.rejectedToday ?? 0}
          icon={XCircle}
          accent={JARVIS.colors.red}
        />
        <StatCard
          label="Avg Response"
          value={stats?.avgResponseMinutes !== null && stats?.avgResponseMinutes !== undefined ? `${stats.avgResponseMinutes}m` : '—'}
          icon={Timer}
          accent={JARVIS.colors.cyan}
        />
        <StatCard
          label="Expired Total"
          value={stats?.expiredTotal ?? 0}
          icon={AlertTriangle}
          accent={JARVIS.colors.textMute}
        />
      </div>

      {/* Filter bar */}
      <div className="jarvis-panel p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5">
            <span className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)]">status</span>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-8 w-[140px] jarvis-mono text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value} className="jarvis-mono text-xs uppercase">
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)]">category</span>
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="h-8 w-[180px] jarvis-mono text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CATEGORY_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value} className="jarvis-mono text-xs uppercase">
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="ml-auto jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">
            showing {approvals.length}
          </div>
        </div>
      </div>

      {data?.error && (
        <div className="rounded-lg border border-[var(--j-red)]/40 bg-[var(--j-red)]/10 p-3 text-xs text-[var(--j-red)]">
          {data.error}
        </div>
      )}

      {/* Approvals table */}
      <div className="jarvis-panel p-0 overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-2 border-b border-[var(--j-border)] bg-[var(--j-panel-soft)]/40">
          <ShieldCheck className="h-3.5 w-3.5" style={{ color: JARVIS.colors.red }} />
          <span className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">
            approval requests · {approvals.length} shown
          </span>
        </div>

        <div className="max-h-[60vh] overflow-y-auto jarvis-scroll">
          {loading && !data ? (
            <div className="p-4 flex items-center gap-2 text-[var(--j-text-mute)] text-xs">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> loading…
            </div>
          ) : approvals.length ? (
            <Table>
              <TableHeader>
                <TableRow className="border-b border-[var(--j-border)] hover:bg-transparent">
                  <TableHead className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)] bg-[var(--j-panel-soft)]/40 w-8" />
                  <TableHead className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)] bg-[var(--j-panel-soft)]/40">Title / Category</TableHead>
                  <TableHead className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)] bg-[var(--j-panel-soft)]/40">Requested By</TableHead>
                  <TableHead className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)] bg-[var(--j-panel-soft)]/40">Created</TableHead>
                  <TableHead className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)] bg-[var(--j-panel-soft)]/40">Escalation</TableHead>
                  <TableHead className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)] bg-[var(--j-panel-soft)]/40">Next Escalation</TableHead>
                  <TableHead className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)] bg-[var(--j-panel-soft)]/40">Status</TableHead>
                  <TableHead className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)] bg-[var(--j-panel-soft)]/40 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {approvals.map((a) => {
                  const isExpanded = expandedId === a.id;
                  const catColor = CATEGORY_COLORS[a.category] ?? JARVIS.colors.textDim;
                  const statusColor = STATUS_COLORS[a.status] ?? JARVIS.colors.textDim;
                  const cd = countdownTo(a.status === 'pending' ? a.nextEscalateAt : null);
                  const payload = safeParsePayload(a.payload);
                  const canAct = a.status === 'pending';
                  return (
                    <Fragment key={a.id}>
                      <TableRow
                        className="border-b border-[var(--j-border-soft)] hover:bg-[var(--j-panel-soft)]/40 cursor-pointer"
                        onClick={() => setExpandedId(isExpanded ? null : a.id)}
                      >
                        <TableCell className="text-center">
                          {isExpanded ? (
                            <ChevronDown className="h-3.5 w-3.5 text-[var(--j-text-mute)]" />
                          ) : (
                            <ChevronRight className="h-3.5 w-3.5 text-[var(--j-text-mute)]" />
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-0.5 min-w-0">
                            <span className="text-xs text-[var(--j-text)] truncate max-w-[20rem]" title={a.title}>
                              {a.title}
                            </span>
                            <span
                              className="jarvis-mono text-[9px] uppercase px-1.5 py-0.5 rounded w-fit"
                              style={{
                                color: catColor,
                                background: `${catColor}1a`,
                                border: `1px solid ${catColor}33`,
                              }}
                            >
                              {a.category}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="jarvis-mono text-[10px] text-[var(--j-text-dim)]">
                          {a.requestedBy}
                          {a.decidedBy && (
                            <div className="text-[9px] text-[var(--j-text-mute)]">by {a.decidedBy}</div>
                          )}
                        </TableCell>
                        <TableCell className="jarvis-mono text-[10px] text-[var(--j-text-dim)]" title={new Date(a.createdAt).toLocaleString()}>
                          {timeAgo(a.createdAt)}
                        </TableCell>
                        <TableCell>
                          <EscalationDots level={a.escalationLevel} />
                        </TableCell>
                        <TableCell>
                          {a.status === 'pending' ? (
                            <span
                              className={`jarvis-mono text-[10px] ${cd.overdue ? 'text-[var(--j-red)]' : 'text-[var(--j-amber)]'}`}
                              title={a.nextEscalateAt ? new Date(a.nextEscalateAt).toLocaleString() : ''}
                            >
                              {cd.overdue ? '⚠ overdue' : cd.label}
                            </span>
                          ) : a.resolvedAt ? (
                            <span className="jarvis-mono text-[10px] text-[var(--j-text-mute)]">
                              resolved {timeAgo(a.resolvedAt)}
                            </span>
                          ) : (
                            <span className="jarvis-mono text-[10px] text-[var(--j-text-mute)]">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className="jarvis-mono text-[9px] uppercase border-0"
                            style={{
                              color: statusColor,
                              background: `${statusColor}1a`,
                              border: `1px solid ${statusColor}33`,
                            }}
                          >
                            {a.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                          {canAct ? (
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 px-2 text-[10px] jarvis-mono uppercase border-[var(--j-border)] hover:border-[var(--j-green)] hover:text-[var(--j-green)]"
                                onClick={() => {
                                  setDecideTarget({ approval: a, decision: 'approved' });
                                  setDecideNote('');
                                }}
                              >
                                <CheckCircle2 className="h-3 w-3" /> Approve
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 px-2 text-[10px] jarvis-mono uppercase border-[var(--j-border)] hover:border-[var(--j-red)] hover:text-[var(--j-red)]"
                                onClick={() => {
                                  setDecideTarget({ approval: a, decision: 'rejected' });
                                  setDecideNote('');
                                }}
                              >
                                <XCircle className="h-3 w-3" /> Reject
                              </Button>
                            </div>
                          ) : (
                            <span className="jarvis-mono text-[9px] text-[var(--j-text-mute)]">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                      <TableRow key={`${a.id}-exp`} className="border-b border-[var(--j-border-soft)]">
                        <TableCell colSpan={8} className="bg-[var(--j-panel-soft)]/30 p-0">
                          <AnimatePresence>
                            {isExpanded && (
                              <motion.div
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: 'auto', opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                transition={{ duration: 0.2 }}
                                className="px-4 py-3 space-y-3 overflow-hidden"
                              >
                                <div>
                                  <div className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)] mb-1">Description</div>
                                  <div className="text-xs text-[var(--j-text)] whitespace-pre-wrap">
                                    {a.description}
                                  </div>
                                </div>
                                {payload && (
                                  <div>
                                    <div className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)] mb-1">Payload</div>
                                    <pre className="text-[10px] text-[var(--j-text-dim)] bg-[var(--j-panel)]/60 border border-[var(--j-border)] rounded p-2 overflow-x-auto jarvis-scroll max-h-48">
                                      {JSON.stringify(payload, null, 2)}
                                    </pre>
                                  </div>
                                )}
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-[10px]">
                                  <div>
                                    <div className="jarvis-mono uppercase text-[var(--j-text-mute)]">ID</div>
                                    <div className="jarvis-mono text-[var(--j-text-dim)]">{shortId(a.id, 16)}</div>
                                  </div>
                                  <div>
                                    <div className="jarvis-mono uppercase text-[var(--j-text-mute)]">Created</div>
                                    <div className="text-[var(--j-text-dim)]">{new Date(a.createdAt).toLocaleString()}</div>
                                  </div>
                                  <div>
                                    <div className="jarvis-mono uppercase text-[var(--j-text-mute)]">Last Escalated</div>
                                    <div className="text-[var(--j-text-dim)]">{a.lastEscalatedAt ? new Date(a.lastEscalatedAt).toLocaleString() : '—'}</div>
                                  </div>
                                  <div>
                                    <div className="jarvis-mono uppercase text-[var(--j-text-mute)]">Expires At</div>
                                    <div className="text-[var(--j-text-dim)]">{a.expiresAt ? new Date(a.expiresAt).toLocaleString() : '—'}</div>
                                  </div>
                                </div>
                                {a.decisionNote && (
                                  <div>
                                    <div className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)] mb-1">Decision Note</div>
                                    <div className="text-xs text-[var(--j-text)]">{a.decisionNote}</div>
                                  </div>
                                )}
                                {/* Escalation channel legend */}
                                <div className="flex items-center gap-3 pt-1 border-t border-[var(--j-border-soft)]">
                                  <span className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)]">channels</span>
                                  <Pill color={JARVIS.colors.cyan}><MessageSquare className="h-3 w-3 inline mr-1" />Telegram</Pill>
                                  <Pill color={JARVIS.colors.amber}><Mail className="h-3 w-3 inline mr-1" />Email (L2+)</Pill>
                                  <Pill color={JARVIS.colors.red}><Phone className="h-3 w-3 inline mr-1" />Voice (L3)</Pill>
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </TableCell>
                      </TableRow>
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          ) : (
            <EmptyState
              icon={ShieldCheck}
              message="No approval requests match your filters"
              hint="Create one with the 'New Approval' button, or change the status/category filters above. Pending approvals will auto-escalate after the configured timeout."
              accent={JARVIS.colors.red}
            />
          )}
        </div>
      </div>

      {/* Decision dialog */}
      <Dialog open={!!decideTarget} onOpenChange={(o) => { if (!o) { setDecideTarget(null); setDecideNote(''); } }}>
        <DialogContent className="bg-[var(--j-panel)] border-[var(--j-border)] text-[var(--j-text)] max-w-md">
          <DialogHeader>
            <DialogTitle
              className="jarvis-mono text-sm uppercase flex items-center gap-2"
              style={{
                color: decideTarget?.decision === 'approved' ? JARVIS.colors.green : JARVIS.colors.red,
              }}
            >
              {decideTarget?.decision === 'approved' ? (
                <><CheckCircle2 className="h-4 w-4" /> Approve</>
              ) : (
                <><XCircle className="h-4 w-4" /> Reject</>
              )}
            </DialogTitle>
            <DialogDescription className="text-[var(--j-text-mute)] text-xs">
              {decideTarget?.approval.title}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">Decision note (optional)</label>
              <Textarea
                value={decideNote}
                onChange={(e) => setDecideNote(e.target.value)}
                placeholder="Reason / context for this decision…"
                className="bg-[var(--j-panel-soft)] border-[var(--j-border)] text-xs min-h-[80px]"
              />
            </div>
            <div className="text-[10px] text-[var(--j-text-mute)]">
              Decided by <span className="jarvis-mono text-[var(--j-text-dim)]">operator</span>. This will stop all further escalation attempts.
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => { setDecideTarget(null); setDecideNote(''); }}
              disabled={decideBusy}
              className="border-[var(--j-border)] text-[var(--j-text-mute)]"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={decideBusy}
              onClick={handleDecide}
              className={
                decideTarget?.decision === 'approved'
                  ? 'bg-[var(--j-green)] hover:bg-[var(--j-green)]/80 text-white'
                  : 'bg-[var(--j-red)] hover:bg-[var(--j-red)]/80 text-white'
              }
            >
              {decideBusy ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : null}
              {decideTarget?.decision === 'approved' ? 'Confirm Approval' : 'Confirm Rejection'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create dialog */}
      <CreateApprovalDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onDone={() => { setCreateOpen(false); refresh(); }}
      />
    </div>
  );
}

// ─── Create Approval dialog ───────────────────────────────────────────

function CreateApprovalDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const { toast } = useToast();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<string>('other');
  const [requestedBy, setRequestedBy] = useState('operator');
  const [timeoutMinutes, setTimeoutMinutes] = useState('30');
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setTitle('');
    setDescription('');
    setCategory('other');
    setRequestedBy('operator');
    setTimeoutMinutes('30');
  };

  const submit = async () => {
    if (!title.trim() || !description.trim()) {
      toast({ title: 'Title and description are required', variant: 'destructive' });
      return;
    }
    const tm = parseInt(timeoutMinutes, 10);
    setBusy(true);
    try {
      await postJson('/api/approvals', {
        title: title.trim(),
        description: description.trim(),
        category,
        requestedBy: requestedBy.trim() || 'operator',
        timeoutMinutes: isFinite(tm) && tm > 0 ? tm : undefined,
      });
      toast({
        title: 'Approval request created',
        description: `Will auto-escalate after ${isFinite(tm) && tm > 0 ? tm : 30} min if not actioned.`,
      });
      reset();
      onDone();
    } catch (e) {
      toast({
        title: 'Failed to create approval',
        description: e instanceof Error ? e.message : '',
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { reset(); onClose(); } }}>
      <DialogContent className="bg-[var(--j-panel)] border-[var(--j-border)] text-[var(--j-text)] max-w-lg">
        <DialogHeader>
          <DialogTitle className="jarvis-mono text-sm uppercase text-[var(--j-red)] flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" /> New Approval Request
          </DialogTitle>
          <DialogDescription className="text-[var(--j-text-mute)] text-xs">
            Create a formal approval request. The owner will be notified immediately, and the escalation
            engine will follow up via Telegram → Email → Voice call if no decision is made within the timeout.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">Title</label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Deploy earning method v2 to production"
              className="bg-[var(--j-panel-soft)] border-[var(--j-border)] text-xs"
            />
          </div>
          <div>
            <label className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">Description</label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is being requested? What's the impact? What could break?"
              className="bg-[var(--j-panel-soft)] border-[var(--j-border)] text-xs min-h-[100px]"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">Category</label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger className="bg-[var(--j-panel-soft)] border-[var(--j-border)] jarvis-mono text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORY_OPTIONS.filter((c) => c.value !== 'all').map((c) => (
                    <SelectItem key={c.value} value={c.value} className="jarvis-mono text-xs uppercase">
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">Timeout (min)</label>
              <Input
                type="number"
                min="1"
                value={timeoutMinutes}
                onChange={(e) => setTimeoutMinutes(e.target.value)}
                className="bg-[var(--j-panel-soft)] border-[var(--j-border)] jarvis-mono text-xs"
              />
            </div>
          </div>
          <div>
            <label className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">Requested By</label>
            <Input
              value={requestedBy}
              onChange={(e) => setRequestedBy(e.target.value)}
              placeholder="operator / agent codename / system"
              className="bg-[var(--j-panel-soft)] border-[var(--j-border)] text-xs"
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            onClick={() => { reset(); onClose(); }}
            disabled={busy}
            className="border-[var(--j-border)] text-[var(--j-text-mute)]"
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={submit}
            disabled={busy}
            className="bg-[var(--j-red)] hover:bg-[var(--j-red)]/80 text-white"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Plus className="h-3.5 w-3.5 mr-1.5" />}
            Create & Notify
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
