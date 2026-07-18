'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { Wallet, Plus, X, IndianRupee, CheckCircle2, Clock, Receipt, CreditCard, QrCode, Landmark, Smartphone, TrendingUp, BarChart3 } from 'lucide-react';
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid, Line, ComposedChart } from 'recharts';
import { useApi, postJson } from '@/lib/hooks/use-api';
import { JARVIS } from '@/lib/config';
import { SectionTitle, StatCard, Pill, EmptyState } from '@/components/jarvis/shared';
import { useToast } from '@/hooks/use-toast';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface Payment {
  id: string; method: string; amount: number; currency: string; status: string;
  payer?: string | null; note?: string | null; createdAt: string;
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

export default function PaymentsTab() {
  const { data, loading, refresh } = useApi<{ payments: Payment[]; stats: { confirmedTotal: number; pendingTotal: number; count: number } }>('/api/payments', 12000);
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('all');

  const payments = (data?.payments ?? []).filter((p) => filter === 'all' || p.status === filter);

  return (
    <div className="space-y-4">
      <SectionTitle
        title="Payments"
        icon={Wallet}
        accent={JARVIS.colors.green}
        action={<Button size="sm" variant="outline" className="jarvis-btn-accent border-0" onClick={() => setOpen(true)}><Plus className="h-3.5 w-3.5 mr-1" /> New Payment</Button>}
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard label="Confirmed Revenue" value={`₹${(data?.stats.confirmedTotal ?? 0).toLocaleString()}`} sub={`${(data?.payments ?? []).filter((p) => p.status === 'confirmed').length} payments`} icon={CheckCircle2} accent={JARVIS.colors.green} />
        <StatCard label="Pending" value={`₹${(data?.stats.pendingTotal ?? 0).toLocaleString()}`} sub="awaiting confirmation" icon={Clock} accent={JARVIS.colors.amber} />
        <StatCard label="Total Transactions" value={data?.stats.count ?? 0} sub="all time" icon={Receipt} accent={JARVIS.colors.cyan} />
      </div>

      {/* Revenue methods breakdown */}
      <div className="jarvis-panel p-4">
        <SectionTitle title="Payment Methods" icon={CreditCard} accent={JARVIS.colors.violet} />
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {METHODS.map((m) => {
            const count = (data?.payments ?? []).filter((p) => p.method === m.key).length;
            const total = (data?.payments ?? []).filter((p) => p.method === m.key && p.status === 'confirmed').reduce((a, p) => a + p.amount, 0);
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

      {loading && !data ? (
        <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="jarvis-panel h-14 animate-pulse" />)}</div>
      ) : payments.length ? (
        <div className="jarvis-panel p-0 overflow-hidden">
          <div className="grid grid-cols-12 gap-2 px-4 py-2 border-b border-[var(--j-border)] jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)] bg-[var(--j-panel-soft)]/40">
            <div className="col-span-3">Method</div>
            <div className="col-span-3">Payer</div>
            <div className="col-span-3">Note</div>
            <div className="col-span-1 text-right">Amount</div>
            <div className="col-span-2 text-right">Status</div>
          </div>
          <div className="max-h-96 overflow-y-auto jarvis-scroll">
            {payments.map((p, i) => {
              const method = METHODS.find((m) => m.key === p.method);
              const Icon = method?.icon ?? Wallet;
              const color = method?.color ?? JARVIS.colors.cyan;
              return (
                <motion.div key={p.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.02 }} className="grid grid-cols-12 gap-2 px-4 py-2.5 border-b border-[var(--j-border-soft)] hover:bg-[var(--j-panel-soft)]/40 items-center">
                  <div className="col-span-3 flex items-center gap-2 min-w-0">
                    <Icon className="h-3.5 w-3.5 shrink-0" style={{ color }} />
                    <span className="jarvis-mono text-xs text-[var(--j-text)] truncate">{p.method}</span>
                  </div>
                  <div className="col-span-3 text-xs text-[var(--j-text-dim)] truncate">{p.payer ?? '—'}</div>
                  <div className="col-span-3 text-xs text-[var(--j-text-mute)] truncate">{p.note ?? '—'}</div>
                  <div className="col-span-1 text-right jarvis-mono text-xs text-[var(--j-green)] flex items-center justify-end"><IndianRupee className="h-3 w-3" />{p.amount.toLocaleString()}</div>
                  <div className="col-span-2 text-right"><Pill color={STATUS_COLORS[p.status] ?? JARVIS.colors.textDim}>{p.status}</Pill></div>
                </motion.div>
              );
            })}
          </div>
        </div>
      ) : (
        <EmptyState icon={Wallet} message="No payments found" />
      )}

      {open && <NewPaymentModal onClose={() => setOpen(false)} onDone={() => { setOpen(false); refresh(); }} />}
    </div>
  );
}

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

