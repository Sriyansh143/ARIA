'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { Wallet, Plus, X, IndianRupee, CheckCircle2, Clock, Receipt, CreditCard, QrCode, Landmark, Smartphone, TrendingUp, BarChart3, RotateCcw, ArrowLeftRight, AlertTriangle, XCircle, Loader2 } from 'lucide-react';
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid, Line, ComposedChart } from 'recharts';
import { useApi, postJson } from '@/lib/hooks/use-api';
import { JARVIS } from '@/lib/config';
import { SectionTitle, StatCard, Pill, EmptyState } from '@/components/jarvis/shared';
import { useToast } from '@/hooks/use-toast';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';

interface Payment {
  id: string; method: string; amount: number; currency: string; status: string;
  payer?: string | null; note?: string | null; createdAt: string;
}

interface RefundPayment {
  id: string; method: string; amount: number; currency: string;
  status: string; payer: string | null; note: string | null;
}

interface Refund {
  id: string;
  paymentId: string;
  paymentRefId: string | null;
  amount: number;
  currency: string;
  reason: string;
  reasonNote: string | null;
  status: string;
  requestedBy: string;
  reviewedBy: string | null;
  reviewNote: string | null;
  gatewayRef: string | null;
  processedAt: string | null;
  createdAt: string;
  payment: RefundPayment | null;
}

interface RefundStats {
  requestedCount: number;
  requestedSum: number;
  processedCount: number;
  processedSum: number;
  rejectedCount: number;
  underReviewCount: number;
  cancelledCount: number;
  byReason: Array<{ reason: string; count: number; sum: number }>;
}

const METHODS = [
  { key: 'upi', label: 'UPI', icon: Smartphone, color: JARVIS.colors.cyan },
  { key: 'card', label: 'Card', icon: CreditCard, color: JARVIS.colors.violet },
  { key: 'netbanking', label: 'Net Banking', icon: Landmark, color: JARVIS.colors.amber },
  { key: 'qr', label: 'QR Code', icon: QrCode, color: JARVIS.colors.green },
  { key: 'wallet', label: 'Wallet', icon: Wallet, color: JARVIS.colors.cyan },
];

const STATUS_COLORS: Record<string, string> = {
  confirmed: JARVIS.colors.green, pending: JARVIS.colors.amber, failed: JARVIS.colors.red, refunded: JARVIS.colors.violet,
};

const REFUND_STATUS_COLORS: Record<string, string> = {
  requested: JARVIS.colors.amber,
  under_review: JARVIS.colors.cyan,
  approved: JARVIS.colors.green,
  processed: JARVIS.colors.violet,
  rejected: JARVIS.colors.red,
  cancelled: JARVIS.colors.textMute,
};

const REFUND_REASONS: Array<{ value: string; label: string }> = [
  { value: 'customer_request', label: 'Customer Request' },
  { value: 'duplicate', label: 'Duplicate Payment' },
  { value: 'service_not_delivered', label: 'Service Not Delivered' },
  { value: 'fraud', label: 'Fraud' },
  { value: 'other', label: 'Other' },
];

const REFUND_STATUS_FILTERS = ['all', 'requested', 'under_review', 'approved', 'processed', 'rejected', 'cancelled'];

function reasonLabel(reason: string): string {
  return REFUND_REASONS.find((r) => r.value === reason)?.label ?? reason;
}

function shortId(id: string, len = 8): string {
  return id.length <= len ? id : `${id.slice(0, len)}…`;
}

export default function PaymentsTab() {
  const { data, loading, refresh } = useApi<{ payments: Payment[]; stats: { confirmedTotal: number; pendingTotal: number; count: number } }>('/api/payments', 12000);
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('all');
  const [subView, setSubView] = useState<'payments' | 'refunds'>('payments');
  const [refundTarget, setRefundTarget] = useState<Payment | null>(null);

  const payments = (data?.payments ?? []).filter((p) => filter === 'all' || p.status === filter);

  return (
    <div className="space-y-4">
      <SectionTitle
        title="Payments"
        icon={Wallet}
        accent={JARVIS.colors.green}
        action={
          <div className="flex items-center gap-2">
            {/* Sub-view toggle: Payments | Refunds */}
            <div className="flex gap-1 p-0.5 rounded-md border border-[var(--j-border)] bg-[var(--j-panel-soft)]/40">
              <button
                onClick={() => setSubView('payments')}
                className={`jarvis-mono text-[10px] uppercase px-2.5 py-1 rounded transition-colors flex items-center gap-1 ${subView === 'payments' ? 'jarvis-btn-accent border-0' : 'text-[var(--j-text-mute)] hover:text-[var(--j-text)]'}`}
              >
                <Wallet className="h-3 w-3" /> Payments
              </button>
              <button
                onClick={() => setSubView('refunds')}
                className={`jarvis-mono text-[10px] uppercase px-2.5 py-1 rounded transition-colors flex items-center gap-1 ${subView === 'refunds' ? 'jarvis-btn-accent border-0' : 'text-[var(--j-text-mute)] hover:text-[var(--j-text)]'}`}
              >
                <RotateCcw className="h-3 w-3" /> Refunds
              </button>
            </div>
            {subView === 'payments' && (
              <Button size="sm" variant="outline" className="jarvis-btn-accent border-0" onClick={() => setOpen(true)}>
                <Plus className="h-3.5 w-3.5 mr-1" /> New Payment
              </Button>
            )}
          </div>
        }
      />

      {subView === 'payments' ? (
        <PaymentsView
          payments={payments}
          loading={loading && !data}
          hasData={!!data}
          filter={filter}
          setFilter={setFilter}
          confirmedTotal={data?.stats.confirmedTotal ?? 0}
          pendingTotal={data?.stats.pendingTotal ?? 0}
          totalCount={data?.stats.count ?? 0}
          onRequestRefund={(p) => setRefundTarget(p)}
        />
      ) : (
        <RefundsView />
      )}

      {open && <NewPaymentModal onClose={() => setOpen(false)} onDone={() => { setOpen(false); refresh(); }} />}

      {refundTarget && (
        <RequestRefundDialog
          payment={refundTarget}
          onClose={() => setRefundTarget(null)}
          onDone={() => { setRefundTarget(null); refresh(); toast({ title: 'Refund requested', description: 'Awaiting review.' }); }}
        />
      )}
    </div>
  );
}

// =====================================================================
// Payments sub-view
// =====================================================================

function PaymentsView({
  payments, loading, hasData, filter, setFilter, confirmedTotal, pendingTotal, totalCount, onRequestRefund,
}: {
  payments: Payment[];
  loading: boolean;
  hasData: boolean;
  filter: string;
  setFilter: (f: string) => void;
  confirmedTotal: number;
  pendingTotal: number;
  totalCount: number;
  onRequestRefund: (p: Payment) => void;
}) {
  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard label="Confirmed Revenue" value={`₹${confirmedTotal.toLocaleString()}`} sub={`${payments.filter((p) => p.status === 'confirmed').length} payments`} icon={CheckCircle2} accent={JARVIS.colors.green} />
        <StatCard label="Pending" value={`₹${pendingTotal.toLocaleString()}`} sub="awaiting confirmation" icon={Clock} accent={JARVIS.colors.amber} />
        <StatCard label="Total Transactions" value={totalCount} sub="all time" icon={Receipt} accent={JARVIS.colors.cyan} />
      </div>

      {/* Revenue methods breakdown */}
      <div className="jarvis-panel p-4">
        <SectionTitle title="Payment Methods" icon={CreditCard} accent={JARVIS.colors.violet} />
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {METHODS.map((m) => {
            const count = payments.filter((p) => p.method === m.key).length;
            const total = payments.filter((p) => p.method === m.key && p.status === 'confirmed').reduce((a, p) => a + p.amount, 0);
            const Icon = m.icon;
            return (
              <div key={m.key} className="text-center p-3 rounded-lg border border-[var(--j-border)] bg-[var(--j-panel-soft)]/40">
                <div className="flex h-9 w-9 mx-auto items-center justify-center rounded-lg mb-2" style={{ background: `${m.color}1a`, border: `1px solid ${m.color}33`, color: m.color }}>
                  <Icon className="h-4 w-4" />
                </div>
                <div className="text-xs text-[var(--j-text)]">{m.label}</div>
                <div className="jarvis-mono text-[10px] text-[var(--j-text-mute)] mt-0.5">{count} · ₹{total.toLocaleString()}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Revenue trend chart */}
      <RevenueTrendChart />

      <div className="flex flex-wrap gap-2">
        {['all', 'confirmed', 'pending', 'failed', 'refunded'].map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={`jarvis-mono text-[10px] uppercase px-3 py-1.5 rounded-md border transition-colors ${filter === f ? 'jarvis-btn-accent border-0' : 'border-[var(--j-border)] text-[var(--j-text-dim)] hover:text-[var(--j-text)]'}`}>{f}</button>
        ))}
      </div>

      {loading && !hasData ? (
        <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="jarvis-panel h-14 animate-pulse" />)}</div>
      ) : payments.length ? (
        <div className="jarvis-panel p-0 overflow-hidden">
          <div className="grid grid-cols-12 gap-2 px-4 py-2 border-b border-[var(--j-border)] jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)] bg-[var(--j-panel-soft)]/40">
            <div className="col-span-3">Method</div>
            <div className="col-span-3">Payer</div>
            <div className="col-span-2">Note</div>
            <div className="col-span-1 text-right">Amount</div>
            <div className="col-span-2 text-right">Status</div>
            <div className="col-span-1 text-right">Action</div>
          </div>
          <div className="max-h-96 overflow-y-auto jarvis-scroll">
            {payments.map((p, i) => {
              const method = METHODS.find((m) => m.key === p.method);
              const Icon = method?.icon ?? Wallet;
              const color = method?.color ?? JARVIS.colors.cyan;
              const canRefund = p.status === 'confirmed';
              return (
                <motion.div key={p.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.02 }} className="grid grid-cols-12 gap-2 px-4 py-2.5 border-b border-[var(--j-border-soft)] hover:bg-[var(--j-panel-soft)]/40 items-center">
                  <div className="col-span-3 flex items-center gap-2 min-w-0">
                    <Icon className="h-3.5 w-3.5 shrink-0" style={{ color }} />
                    <span className="jarvis-mono text-xs text-[var(--j-text)] truncate">{p.method}</span>
                  </div>
                  <div className="col-span-3 text-xs text-[var(--j-text-dim)] truncate">{p.payer ?? '—'}</div>
                  <div className="col-span-2 text-xs text-[var(--j-text-mute)] truncate">{p.note ?? '—'}</div>
                  <div className="col-span-1 text-right jarvis-mono text-xs text-[var(--j-green)] flex items-center justify-end"><IndianRupee className="h-3 w-3" />{p.amount.toLocaleString()}</div>
                  <div className="col-span-2 text-right"><Pill color={STATUS_COLORS[p.status] ?? JARVIS.colors.textDim}>{p.status}</Pill></div>
                  <div className="col-span-1 text-right">
                    {canRefund ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-[10px] jarvis-mono uppercase border-[var(--j-border)] hover:border-[var(--j-violet)] hover:text-[var(--j-violet)]"
                        onClick={() => onRequestRefund(p)}
                        title="Request refund"
                      >
                        <RotateCcw className="h-3 w-3" /> Refund
                      </Button>
                    ) : (
                      <span className="jarvis-mono text-[9px] text-[var(--j-text-mute)]">—</span>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>
      ) : (
        <EmptyState icon={Wallet} message="No payments found" />
      )}
    </>
  );
}

// =====================================================================
// Refunds sub-view
// =====================================================================

function RefundsView() {
  const { data, loading, refresh } = useApi<{ refunds: Refund[]; stats: RefundStats | null }>(
    '/api/refunds?stats=1',
    15000,
  );
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [reviewTarget, setReviewTarget] = useState<{ refund: Refund; action: 'process' | 'reject' } | null>(null);

  const refunds = (data?.refunds ?? []).filter((r) => statusFilter === 'all' || r.status === statusFilter);
  const stats = data?.stats;

  return (
    <>
      {/* Stats row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard
          label="Total Refunded"
          value={`₹${(stats?.processedSum ?? 0).toLocaleString()}`}
          sub={`${stats?.processedCount ?? 0} processed refunds`}
          icon={CheckCircle2}
          accent={JARVIS.colors.violet}
        />
        <StatCard
          label="Pending Refunds"
          value={`₹${(stats?.requestedSum ?? 0).toLocaleString()}`}
          sub={`${stats?.requestedCount ?? 0} awaiting review · ${stats?.underReviewCount ?? 0} under review`}
          icon={Clock}
          accent={JARVIS.colors.amber}
        />
        <StatCard
          label="Rejected Refunds"
          value={stats?.rejectedCount ?? 0}
          sub={`${stats?.cancelledCount ?? 0} cancelled`}
          icon={XCircle}
          accent={JARVIS.colors.red}
        />
      </div>

      {/* Filter + table */}
      <div className="jarvis-panel p-0 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--j-border)] bg-[var(--j-panel-soft)]/40">
          <div className="flex items-center gap-2">
            <ArrowLeftRight className="h-3.5 w-3.5 text-[var(--j-cyan)]" />
            <h3 className="jarvis-mono text-xs uppercase tracking-widest text-[var(--j-text)]">Refund Requests</h3>
          </div>
          <div className="flex items-center gap-2">
            <span className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">Filter</span>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-7 w-[150px] bg-[var(--j-panel-soft)] border-[var(--j-border)] jarvis-mono text-[10px] uppercase">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REFUND_STATUS_FILTERS.map((s) => (
                  <SelectItem key={s} value={s} className="jarvis-mono text-[10px] uppercase">{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {loading && !data ? (
          <div className="space-y-2 p-4">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-12 animate-pulse rounded bg-[var(--j-panel-soft)]/40" />)}</div>
        ) : refunds.length ? (
          <div className="max-h-[28rem] overflow-y-auto jarvis-scroll">
            <Table>
              <TableHeader>
                <TableRow className="border-b border-[var(--j-border)] hover:bg-transparent">
                  <TableHead className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)] bg-[var(--j-panel-soft)]/40">Date</TableHead>
                  <TableHead className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)] bg-[var(--j-panel-soft)]/40">Payment</TableHead>
                  <TableHead className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)] bg-[var(--j-panel-soft)]/40 text-right">Amount</TableHead>
                  <TableHead className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)] bg-[var(--j-panel-soft)]/40">Reason</TableHead>
                  <TableHead className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)] bg-[var(--j-panel-soft)]/40">Status</TableHead>
                  <TableHead className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)] bg-[var(--j-panel-soft)]/40">Requested By</TableHead>
                  <TableHead className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)] bg-[var(--j-panel-soft)]/40 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {refunds.map((r, i) => {
                  const color = REFUND_STATUS_COLORS[r.status] ?? JARVIS.colors.textDim;
                  const canAct = r.status === 'requested' || r.status === 'under_review' || r.status === 'approved';
                  return (
                    <TableRow key={r.id} className="border-b border-[var(--j-border-soft)] hover:bg-[var(--j-panel-soft)]/40">
                      <TableCell className="jarvis-mono text-[10px] text-[var(--j-text-dim)]">
                        {new Date(r.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                        <span className="text-[var(--j-text-mute)] ml-1">{new Date(r.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span>
                      </TableCell>
                      <TableCell className="jarvis-mono text-[10px] text-[var(--j-text)]" title={r.paymentId}>
                        {r.payment ? (
                          <div className="flex flex-col">
                            <span className="text-[var(--j-text)]">{r.payment.method}</span>
                            <span className="text-[var(--j-text-mute)] text-[9px]">{shortId(r.paymentId, 10)}</span>
                          </div>
                        ) : (
                          <span className="text-[var(--j-text-mute)]">{shortId(r.paymentId, 10)}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right jarvis-mono text-xs text-[var(--j-violet)]">
                        <span className="inline-flex items-center"><IndianRupee className="h-3 w-3" />{r.amount.toLocaleString()}</span>
                        <div className="text-[9px] text-[var(--j-text-mute)]">{r.currency}</div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="jarvis-mono text-[10px] text-[var(--j-text)]">{reasonLabel(r.reason)}</span>
                          {r.reasonNote && <span className="text-[9px] text-[var(--j-text-mute)] truncate max-w-[14rem]" title={r.reasonNote}>{r.reasonNote}</span>}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className="jarvis-mono text-[9px] uppercase border-0"
                          style={{ color, background: `${color}1a`, border: `1px solid ${color}33` }}
                        >
                          {r.status.replace('_', ' ')}
                        </Badge>
                      </TableCell>
                      <TableCell className="jarvis-mono text-[10px] text-[var(--j-text-dim)]">
                        {r.requestedBy}
                        {r.reviewedBy && <div className="text-[9px] text-[var(--j-text-mute)]">by {r.reviewedBy}</div>}
                      </TableCell>
                      <TableCell className="text-right">
                        {canAct ? (
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 px-2 text-[10px] jarvis-mono uppercase border-[var(--j-border)] hover:border-[var(--j-green)] hover:text-[var(--j-green)]"
                              onClick={() => setReviewTarget({ refund: r, action: 'process' })}
                            >
                              <CheckCircle2 className="h-3 w-3" /> Process
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 px-2 text-[10px] jarvis-mono uppercase border-[var(--j-border)] hover:border-[var(--j-red)] hover:text-[var(--j-red)]"
                              onClick={() => setReviewTarget({ refund: r, action: 'reject' })}
                            >
                              <XCircle className="h-3 w-3" /> Reject
                            </Button>
                          </div>
                        ) : r.status === 'processed' ? (
                          <span className="jarvis-mono text-[9px] text-[var(--j-violet)] flex items-center justify-end gap-1">
                            <CheckCircle2 className="h-3 w-3" />
                            {r.processedAt ? new Date(r.processedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : ''}
                          </span>
                        ) : (
                          <span className="jarvis-mono text-[9px] text-[var(--j-text-mute)]">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        ) : (
          <EmptyState icon={RotateCcw} message="No refunds found" hint="Refunds requested on confirmed payments will appear here." />
        )}
      </div>

      {/* By-reason breakdown */}
      {stats && stats.byReason.length > 0 && (
        <div className="jarvis-panel p-4">
          <SectionTitle title="By Reason" icon={BarChart3} accent={JARVIS.colors.cyan} />
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {REFUND_REASONS.map((r) => {
              const bucket = stats.byReason.find((b) => b.reason === r.value);
              const count = bucket?.count ?? 0;
              const sum = bucket?.sum ?? 0;
              return (
                <div key={r.value} className="p-3 rounded-lg border border-[var(--j-border)] bg-[var(--j-panel-soft)]/40">
                  <div className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)]">{r.label}</div>
                  <div className="text-sm font-semibold text-[var(--j-text)] mt-1">{count}</div>
                  <div className="jarvis-mono text-[10px] text-[var(--j-green)]">₹{sum.toLocaleString()}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {reviewTarget && (
        <ReviewRefundDialog
          refund={reviewTarget.refund}
          action={reviewTarget.action}
          onClose={() => setReviewTarget(null)}
          onDone={() => { setReviewTarget(null); refresh(); }}
        />
      )}
    </>
  );
}

// =====================================================================
// Request Refund dialog (from a confirmed payment)
// =====================================================================

function RequestRefundDialog({ payment, onClose, onDone }: { payment: Payment; onClose: () => void; onDone: () => void }) {
  const { toast } = useToast();
  const [amount, setAmount] = useState(String(payment.amount));
  const [reason, setReason] = useState('customer_request');
  const [reasonNote, setReasonNote] = useState('');
  const [requestedBy, setRequestedBy] = useState('operator');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const amt = Number(amount);
    if (!isFinite(amt) || amt <= 0) { toast({ title: 'Refund amount must be greater than 0.', variant: 'destructive' }); return; }
    if (amt > payment.amount) { toast({ title: `Refund amount cannot exceed payment amount (₹${payment.amount}).`, variant: 'destructive' }); return; }
    setBusy(true);
    try {
      await postJson('/api/refunds', {
        paymentId: payment.id,
        amount: amt,
        reason,
        reasonNote: reasonNote.trim() || undefined,
        requestedBy: requestedBy.trim() || 'operator',
      });
      onDone();
    } catch (e) {
      toast({ title: 'Refund request failed', description: e instanceof Error ? e.message : '', variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="bg-[var(--j-panel)] border-[var(--j-border)] text-[var(--j-text)] max-w-md">
        <DialogHeader>
          <DialogTitle className="jarvis-mono text-sm uppercase text-[var(--j-violet)] flex items-center gap-2">
            <RotateCcw className="h-4 w-4" /> Request Refund
          </DialogTitle>
          <DialogDescription className="text-[var(--j-text-mute)] text-xs">
            Refund against payment <span className="jarvis-mono text-[var(--j-text-dim)]">{shortId(payment.id, 12)}</span> · {payment.method} · ₹{payment.amount.toLocaleString()} {payment.currency}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <label className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">Amount (₹)</label>
            <div className="relative">
              <IndianRupee className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--j-text-mute)]" />
              <Input
                type="number"
                step="0.01"
                min="0.01"
                max={payment.amount}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="bg-[var(--j-panel-soft)] border-[var(--j-border)] pl-8"
              />
            </div>
            <p className="text-[9px] text-[var(--j-text-mute)] mt-1">Max refundable: ₹{payment.amount.toLocaleString()}</p>
          </div>

          <div>
            <label className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">Reason</label>
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger className="bg-[var(--j-panel-soft)] border-[var(--j-border)]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {REFUND_REASONS.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">Reason Note</label>
            <Textarea
              value={reasonNote}
              onChange={(e) => setReasonNote(e.target.value)}
              placeholder="Optional — extra context for the reviewer…"
              className="bg-[var(--j-panel-soft)] border-[var(--j-border)] min-h-16 text-xs"
            />
          </div>

          <div>
            <label className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">Requested By</label>
            <Input value={requestedBy} onChange={(e) => setRequestedBy(e.target.value)} className="bg-[var(--j-panel-soft)] border-[var(--j-border)]" />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} className="border-[var(--j-border)] text-[var(--j-text-dim)]">Cancel</Button>
          <Button onClick={submit} disabled={busy} className="jarvis-btn-accent border-0">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <RotateCcw className="h-3.5 w-3.5 mr-1" />}
            {busy ? 'Requesting…' : 'Request Refund'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// =====================================================================
// Review (Process / Reject) Refund dialog
// =====================================================================

function ReviewRefundDialog({
  refund, action, onClose, onDone,
}: {
  refund: Refund;
  action: 'process' | 'reject';
  onClose: () => void;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [reviewer, setReviewer] = useState('operator');
  const [gatewayRef, setGatewayRef] = useState('');
  const [reviewNote, setReviewNote] = useState('');
  const [busy, setBusy] = useState(false);

  const isProcess = action === 'process';
  const accent = isProcess ? JARVIS.colors.green : JARVIS.colors.red;

  const submit = async () => {
    if (!reviewer.trim()) { toast({ title: 'Reviewer name is required.', variant: 'destructive' }); return; }
    setBusy(true);
    try {
      await postJson(`/api/refunds/${refund.id}`, {
        action,
        reviewer: reviewer.trim(),
        gatewayRef: isProcess ? (gatewayRef.trim() || undefined) : undefined,
        reviewNote: reviewNote.trim() || undefined,
      });
      toast({ title: `Refund ${isProcess ? 'processed' : 'rejected'}`, description: `Refund ${shortId(refund.id, 8)} marked as ${isProcess ? 'processed' : 'rejected'}.` });
      onDone();
    } catch (e) {
      toast({ title: 'Action failed', description: e instanceof Error ? e.message : '', variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="bg-[var(--j-panel)] border-[var(--j-border)] text-[var(--j-text)] max-w-md">
        <DialogHeader>
          <DialogTitle className="jarvis-mono text-sm uppercase flex items-center gap-2" style={{ color: accent }}>
            {isProcess ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
            {isProcess ? 'Process Refund' : 'Reject Refund'}
          </DialogTitle>
          <DialogDescription className="text-[var(--j-text-mute)] text-xs">
            Refund <span className="jarvis-mono text-[var(--j-text-dim)]">{shortId(refund.id, 10)}</span> · ₹{refund.amount.toLocaleString()} {refund.currency} · {reasonLabel(refund.reason)}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <label className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">Reviewer</label>
            <Input value={reviewer} onChange={(e) => setReviewer(e.target.value)} className="bg-[var(--j-panel-soft)] border-[var(--j-border)]" placeholder="operator name" />
          </div>

          {isProcess && (
            <div>
              <label className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">Gateway Reference (optional)</label>
              <Input value={gatewayRef} onChange={(e) => setGatewayRef(e.target.value)} className="bg-[var(--j-panel-soft)] border-[var(--j-border)] jarvis-mono text-xs" placeholder="PRF-xxxxxx" />
            </div>
          )}

          <div>
            <label className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">Review Note</label>
            <Textarea
              value={reviewNote}
              onChange={(e) => setReviewNote(e.target.value)}
              placeholder={isProcess ? 'Optional — processing notes…' : 'Why is this refund being rejected?'}
              className="bg-[var(--j-panel-soft)] border-[var(--j-border)] min-h-16 text-xs"
            />
          </div>

          {!isProcess && (
            <div className="text-[10px] text-[var(--j-text-mute)] flex items-start gap-2 p-2 rounded border border-[var(--j-red)]/30 bg-[var(--j-red)]/5">
              <AlertTriangle className="h-3.5 w-3.5 text-[var(--j-red)] shrink-0 mt-0.5" />
              <span>Rejecting will release the committed refund amount back to the payment's available refundable balance. This cannot be undone.</span>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} className="border-[var(--j-border)] text-[var(--j-text-dim)]">Cancel</Button>
          <Button onClick={submit} disabled={busy} className="border-0" style={{ background: `${accent}1a`, color: accent, border: `1px solid ${accent}55` }}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : isProcess ? <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> : <XCircle className="h-3.5 w-3.5 mr-1" />}
            {busy ? 'Working…' : isProcess ? 'Process Refund' : 'Reject Refund'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// =====================================================================
// Existing NewPaymentModal + RevenueTrendChart (unchanged)
// =====================================================================

function NewPaymentModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { toast } = useToast();
  const [method, setMethod] = useState('upi');
  const [amount, setAmount] = useState('');
  const [payer, setPayer] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const amt = Number(amount);
    if (!method || !amt || amt <= 0) { toast({ title: 'Valid method and amount required', variant: 'destructive' }); return; }
    setBusy(true);
    try {
      await postJson('/api/payments', { method, amount: amt, payer, note });
      toast({ title: 'Payment recorded' });
      onDone();
    } catch (e) {
      toast({ title: 'Failed', description: e instanceof Error ? e.message : '', variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <motion.div className="fixed inset-0 z-50 flex items-center justify-center p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <motion.div initial={{ scale: 0.96, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="relative w-full max-w-md jarvis-panel p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="jarvis-mono text-sm uppercase text-[var(--j-green)]">New Payment</h3>
          <button onClick={onClose} className="text-[var(--j-text-mute)] hover:text-[var(--j-text)]"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">Method</label>
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger className="bg-[var(--j-panel-soft)] border-[var(--j-border)]"><SelectValue /></SelectTrigger>
              <SelectContent>{METHODS.map((m) => <SelectItem key={m.key} value={m.key}>{m.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <label className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">Amount (₹)</label>
            <div className="relative">
              <IndianRupee className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--j-text-mute)]" />
              <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="4999" className="bg-[var(--j-panel-soft)] border-[var(--j-border)] pl-8" />
            </div>
          </div>
          <div>
            <label className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">Payer</label>
            <Input value={payer} onChange={(e) => setPayer(e.target.value)} placeholder="acme-corp" className="bg-[var(--j-panel-soft)] border-[var(--j-border)]" />
          </div>
          <div>
            <label className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">Note</label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Enterprise tier — monthly" className="bg-[var(--j-panel-soft)] border-[var(--j-border)]" />
          </div>
          <Button onClick={submit} disabled={busy} className="w-full jarvis-btn-accent border-0">{busy ? 'Recording…' : 'Record Payment'}</Button>
        </div>
      </motion.div>
    </motion.div>
  );
}

interface TrendData {
  series: Array<{ date: string; label: string; total: number; count: number; upi: number; card: number; netbanking: number; qr: number; wallet: number }>;
  cumulative: number[];
  total: number;
  avgDaily: number;
  bestDay: { date: string; total: number; label: string };
}

function RevenueTrendChart() {
  const { data, loading } = useApi<TrendData>('/api/payments/trend', 30000);
  const [view, setView] = useState<'daily' | 'stacked' | 'cumulative'>('daily');

  if (loading && !data) return <div className="jarvis-panel h-64 animate-pulse" />;
  if (!data || data.series.length === 0) return null;

  const series = data.series.map((s, i) => ({ ...s, cumulative: data.cumulative[i] ?? 0 }));

  return (
    <div className="jarvis-panel p-4">
      <SectionTitle
        title="Revenue Trend"
        icon={TrendingUp}
        accent={JARVIS.colors.green}
        action={
          <div className="flex gap-1">
            {(['daily', 'stacked', 'cumulative'] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`jarvis-mono text-[9px] uppercase px-2 py-1 rounded transition-colors ${view === v ? 'jarvis-btn-accent border-0' : 'text-[var(--j-text-mute)] hover:text-[var(--j-text)]'}`}
              >
                {v}
              </button>
            ))}
          </div>
        }
      />
      <div className="grid grid-cols-3 gap-3 mb-3">
        <TrendStat label="14-Day Total" value={`₹${data.total.toLocaleString()}`} color={JARVIS.colors.green} icon={Wallet} />
        <TrendStat label="Daily Avg" value={`₹${data.avgDaily.toLocaleString()}`} color={JARVIS.colors.cyan} icon={BarChart3} />
        <TrendStat label="Best Day" value={data.bestDay?.label ? `₹${data.bestDay.total.toLocaleString()}` : '—'} sub={data.bestDay?.label} color={JARVIS.colors.amber} icon={TrendingUp} />
      </div>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          {view === 'daily' ? (
            <ComposedChart data={series} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={JARVIS.colors.green} stopOpacity={0.45} />
                  <stop offset="100%" stopColor={JARVIS.colors.green} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1B2330" vertical={false} />
              <XAxis dataKey="label" tick={{ fill: '#64748B', fontSize: 10 }} axisLine={false} tickLine={false} minTickGap={20} />
              <YAxis tick={{ fill: '#64748B', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v) => `₹${v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}`} />
              <Tooltip
                contentStyle={{ background: '#0E1218', border: '1px solid #1B2330', borderRadius: 8, fontSize: 12 }}
                labelStyle={{ color: '#94A3B8' }}
                formatter={(v: number) => [`₹${v.toLocaleString()}`, 'Revenue']}
              />
              <Area type="monotone" dataKey="total" name="Revenue" stroke={JARVIS.colors.green} strokeWidth={2} fill="url(#revGrad)" />
              <Line type="monotone" dataKey="count" name="Count" stroke={JARVIS.colors.cyan} strokeWidth={1.5} dot={false} yAxisId={0} />
            </ComposedChart>
          ) : view === 'stacked' ? (
            <BarChart data={series} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1B2330" vertical={false} />
              <XAxis dataKey="label" tick={{ fill: '#64748B', fontSize: 10 }} axisLine={false} tickLine={false} minTickGap={20} />
              <YAxis tick={{ fill: '#64748B', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v) => `₹${v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}`} />
              <Tooltip contentStyle={{ background: '#0E1218', border: '1px solid #1B2330', borderRadius: 8, fontSize: 12 }} labelStyle={{ color: '#94A3B8' }} formatter={(v: number) => `₹${v.toLocaleString()}`} />
              <Bar dataKey="upi" name="UPI" stackId="r" fill={JARVIS.colors.cyan} />
              <Bar dataKey="card" name="Card" stackId="r" fill={JARVIS.colors.violet} />
              <Bar dataKey="netbanking" name="Net Banking" stackId="r" fill={JARVIS.colors.amber} />
              <Bar dataKey="qr" name="QR" stackId="r" fill={JARVIS.colors.green} />
              <Bar dataKey="wallet" name="Wallet" stackId="r" fill={JARVIS.colors.red} radius={[3, 3, 0, 0]} />
            </BarChart>
          ) : (
            <AreaChart data={series} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="cumGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={JARVIS.colors.amber} stopOpacity={0.4} />
                  <stop offset="100%" stopColor={JARVIS.colors.amber} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1B2330" vertical={false} />
              <XAxis dataKey="label" tick={{ fill: '#64748B', fontSize: 10 }} axisLine={false} tickLine={false} minTickGap={20} />
              <YAxis tick={{ fill: '#64748B', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v) => `₹${v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}`} />
              <Tooltip contentStyle={{ background: '#0E1218', border: '1px solid #1B2330', borderRadius: 8, fontSize: 12 }} labelStyle={{ color: '#94A3B8' }} formatter={(v: number) => [`₹${v.toLocaleString()}`, 'Cumulative']} />
              <Area type="monotone" dataKey="cumulative" name="Cumulative" stroke={JARVIS.colors.amber} strokeWidth={2} fill="url(#cumGrad)" />
            </AreaChart>
          )}
        </ResponsiveContainer>
      </div>
      {/* Method legend for stacked view */}
      {view === 'stacked' && (
        <div className="flex flex-wrap gap-3 mt-3 justify-center">
          {METHODS.map((m) => (
            <span key={m.key} className="jarvis-mono text-[9px] uppercase flex items-center gap-1.5 text-[var(--j-text-dim)]">
              <span className="h-2 w-2 rounded-sm" style={{ background: m.color }} />{m.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function TrendStat({ label, value, sub, color, icon: Icon }: { label: string; value: string; sub?: string; color: string; icon: typeof Wallet }) {
  return (
    <div className="flex items-center gap-2.5 p-2.5 rounded-lg border border-[var(--j-border-soft)] bg-[var(--j-panel-soft)]/40">
      <div className="flex h-8 w-8 items-center justify-center rounded-md shrink-0" style={{ background: `${color}1a`, border: `1px solid ${color}33`, color }}>
        <Icon className="h-3.5 w-3.5" />
      </div>
      <div className="min-w-0">
        <div className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)]">{label}</div>
        <div className="text-sm font-semibold" style={{ color }}>{value}</div>
        {sub && <div className="jarvis-mono text-[9px] text-[var(--j-text-mute)] truncate">{sub}</div>}
      </div>
    </div>
  );
}
