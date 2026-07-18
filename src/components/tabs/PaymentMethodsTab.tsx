'use client';

import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CreditCard, Plus, Smartphone, Landmark, Wallet, AtSign, Bitcoin,
  CheckCircle2, ShieldCheck, Star, Pencil, Trash2, Loader2, Receipt,
  ArrowUpRight, Lock, AlertCircle, History,
} from 'lucide-react';
import { useApi, postJson, patchJson, deleteJson } from '@/lib/hooks/use-api';
import { JARVIS, timeAgo } from '@/lib/config';
import { SectionTitle, StatCard, Pill, EmptyState } from '@/components/jarvis/shared';
import { useToast } from '@/hooks/use-toast';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';

// ───────────────────────────────────────────────────────────────────────────
// Types
// ───────────────────────────────────────────────────────────────────────────

type MethodKey = 'upi' | 'bank' | 'card' | 'wallet' | 'paypal' | 'crypto';

interface PaymentMethodRow {
  id: string;
  label: string;
  method: MethodKey;
  masked: string;
  currency: string;
  isDefault: boolean;
  enabled: boolean;
  verified: boolean;
  lastUsedAt: string | null;
  usageCount: number;
  createdAt: string;
  updatedAt: string;
}

interface PaymentMethodListResponse {
  methods: PaymentMethodRow[];
  count: number;
  stats: {
    total: number;
    verified: number;
    enabled: number;
    totalUsage: number;
    defaultMasked: string | null;
    defaultMethod: string | null;
  };
  productionKey: boolean;
}

interface Payment {
  id: string;
  method: string;
  amount: number;
  currency: string;
  status: string;
  payer?: string | null;
  note?: string | null;
  createdAt: string;
}

// ───────────────────────────────────────────────────────────────────────────
// Method metadata (icons, colors, labels, form fields)
// ───────────────────────────────────────────────────────────────────────────

const METHOD_META: Record<
  MethodKey,
  { label: string; icon: typeof CreditCard; color: string; description: string }
> = {
  upi: { label: 'UPI', icon: Smartphone, color: JARVIS.colors.cyan, description: 'Unified Payments Interface VPA' },
  bank: { label: 'Bank Account', icon: Landmark, color: JARVIS.colors.amber, description: 'Direct bank transfer (NEFT/IMPS)' },
  card: { label: 'Card', icon: CreditCard, color: JARVIS.colors.violet, description: 'Debit / credit card (tokenized)' },
  wallet: { label: 'Wallet', icon: Wallet, color: JARVIS.colors.cyan, description: 'Paytm / PhonePe / Amazon Pay' },
  paypal: { label: 'PayPal', icon: AtSign, color: JARVIS.colors.green, description: 'International PayPal account' },
  crypto: { label: 'Crypto', icon: Bitcoin, color: JARVIS.colors.amber, description: 'USDT / BTC / ETH wallet' },
};

const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD'];

// Maps Payment.method values → closest OwnerPaymentMethod.method for the usage panel.
const PAYMENT_TO_METHOD: Record<string, MethodKey | null> = {
  upi: 'upi',
  card: 'card',
  wallet: 'wallet',
  netbanking: 'bank',
  qr: 'upi', // QR payments typically route to UPI
};

// ───────────────────────────────────────────────────────────────────────────
// Main tab component
// ───────────────────────────────────────────────────────────────────────────

export default function PaymentMethodsTab() {
  const { data, loading, refresh } = useApi<PaymentMethodListResponse>('/api/payment-methods', 15000);
  const { data: paymentsData } = useApi<{ payments: Payment[] }>('/api/payments', 30000);
  const { toast } = useToast();

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<PaymentMethodRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PaymentMethodRow | null>(null);
  const [verifyingId, setVerifyingId] = useState<string | null>(null);

  const methods = data?.methods ?? [];
  const stats = data?.stats;
  const recentPayments = useMemo(() => {
    const all = paymentsData?.payments ?? [];
    return all.slice(0, 8);
  }, [paymentsData]);

  // ── Actions ──
  const handleSetDefault = async (m: PaymentMethodRow) => {
    try {
      await patchJson(`/api/payment-methods/${m.id}`, { isDefault: true });
      toast({ title: 'Default updated', description: `“${m.label}” is now the default payout method.` });
      refresh();
    } catch (e) {
      toast({ title: 'Failed', description: e instanceof Error ? e.message : '', variant: 'destructive' });
    }
  };

  const handleToggleEnabled = async (m: PaymentMethodRow, next: boolean) => {
    try {
      await patchJson(`/api/payment-methods/${m.id}`, { enabled: next });
      refresh();
    } catch (e) {
      toast({ title: 'Failed', description: e instanceof Error ? e.message : '', variant: 'destructive' });
    }
  };

  const handleVerify = async (m: PaymentMethodRow) => {
    setVerifyingId(m.id);
    try {
      await postJson(`/api/payment-methods/${m.id}/verify`, {});
      toast({ title: 'Verified', description: `“${m.label}” passed the micro-test transaction.` });
      refresh();
    } catch (e) {
      toast({ title: 'Verification failed', description: e instanceof Error ? e.message : '', variant: 'destructive' });
    } finally {
      setVerifyingId(null);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteJson(`/api/payment-methods/${deleteTarget.id}`);
      toast({ title: 'Method removed', description: `“${deleteTarget.label}” was deleted.` });
      setDeleteTarget(null);
      refresh();
    } catch (e) {
      toast({ title: 'Failed', description: e instanceof Error ? e.message : '', variant: 'destructive' });
    }
  };

  return (
    <div className="space-y-4">
      <SectionTitle
        title="Payment Methods"
        icon={CreditCard}
        accent={JARVIS.colors.green}
        action={
          <Button
            size="sm"
            variant="outline"
            className="jarvis-btn-accent border-0"
            onClick={() => { setEditing(null); setModalOpen(true); }}
          >
            <Plus className="h-3.5 w-3.5 mr-1" /> Add Payment Method
          </Button>
        }
      />

      {/* Stat cards row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          label="Total Methods"
          value={stats?.total ?? 0}
          sub={`${stats?.enabled ?? 0} enabled`}
          icon={CreditCard}
          accent={JARVIS.colors.cyan}
          delay={0}
        />
        <StatCard
          label="Verified"
          value={stats?.verified ?? 0}
          sub="micro-test passed"
          icon={ShieldCheck}
          accent={JARVIS.colors.green}
          delay={0.05}
        />
        <StatCard
          label="Default Method"
          value={stats?.defaultMasked ?? '—'}
          sub={stats?.defaultMethod ? METHOD_META[stats.defaultMethod as MethodKey]?.label ?? stats.defaultMethod : 'none set'}
          icon={Star}
          accent={JARVIS.colors.amber}
          delay={0.1}
        />
        <StatCard
          label="Total Usage"
          value={stats?.totalUsage ?? 0}
          sub="lifetime payouts"
          icon={Receipt}
          accent={JARVIS.colors.violet}
          delay={0.15}
        />
      </div>

      {/* Security notice */}
      {!data?.productionKey ? (
        <div
          className="flex items-start gap-2 rounded-md border px-3 py-2 text-xs"
          style={{
            borderColor: `${JARVIS.colors.amber}44`,
            background: `${JARVIS.colors.amber}11`,
            color: JARVIS.colors.amber,
          }}
        >
          <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>
            Dev encryption key in use — set <code className="jarvis-mono">CREDENTIAL_ENCRYPTION_KEY</code> (64-char hex) in production. All method details are still AES-256-GCM encrypted at rest.
          </span>
        </div>
      ) : null}

      {/* Methods grid */}
      {loading && !data ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="jarvis-panel h-44 animate-pulse" />
          ))}
        </div>
      ) : methods.length ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          <AnimatePresence mode="popLayout">
            {methods.map((m, i) => (
              <MethodCard
                key={m.id}
                method={m}
                delay={i * 0.04}
                verifying={verifyingId === m.id}
                onSetDefault={() => handleSetDefault(m)}
                onToggleEnabled={(next) => handleToggleEnabled(m, next)}
                onVerify={() => handleVerify(m)}
                onEdit={() => { setEditing(m); setModalOpen(true); }}
                onDelete={() => setDeleteTarget(m)}
              />
            ))}
          </AnimatePresence>
        </div>
      ) : (
        <div className="jarvis-panel p-6">
          <EmptyState icon={CreditCard} message="No payment methods yet — add your first payout instrument" />
        </div>
      )}

      {/* Usage panel — recent transactions from Payment table */}
      <UsagePanel payments={recentPayments} methods={methods} />

      {/* Add / Edit modal */}
      <PaymentMethodModal
        open={modalOpen}
        editing={editing}
        onClose={() => setModalOpen(false)}
        onDone={() => { setModalOpen(false); refresh(); }}
      />

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}>
        <AlertDialogContent className="bg-[var(--j-panel)] border-[var(--j-border)] text-[var(--j-text)]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-[var(--j-text)]">Delete payment method?</AlertDialogTitle>
            <AlertDialogDescription className="text-[var(--j-text-dim)]">
              {deleteTarget ? (
                <>
                  “<span className="text-[var(--j-text)] font-medium">{deleteTarget.label}</span>” ({METHOD_META[deleteTarget.method].label} · {deleteTarget.masked}) will be permanently removed. The encrypted details cannot be recovered.
                  {deleteTarget.isDefault ? ' A new default will be auto-promoted.' : ''}
                </>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-[var(--j-panel-soft)] border-[var(--j-border)] text-[var(--j-text-dim)] hover:text-[var(--j-text)]">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-[var(--j-red)] text-white border-0 hover:bg-[var(--j-red)]/80"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Method card
// ───────────────────────────────────────────────────────────────────────────

function MethodCard({
  method,
  delay,
  verifying,
  onSetDefault,
  onToggleEnabled,
  onVerify,
  onEdit,
  onDelete,
}: {
  method: PaymentMethodRow;
  delay: number;
  verifying: boolean;
  onSetDefault: () => void;
  onToggleEnabled: (next: boolean) => void;
  onVerify: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const meta = METHOD_META[method.method];
  const Icon = meta.icon;
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ duration: 0.3, delay }}
      className={`jarvis-panel p-4 relative overflow-hidden group ${method.enabled ? '' : 'opacity-60'}`}
      style={method.isDefault ? { borderColor: `${JARVIS.colors.amber}66`, boxShadow: `0 0 0 1px ${JARVIS.colors.amber}22` } : undefined}
    >
      {/* Accent top bar */}
      <div
        className="absolute top-0 left-0 h-[2px]"
        style={{ width: '40%', background: `linear-gradient(90deg, ${meta.color}, transparent)` }}
      />

      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className="flex h-9 w-9 items-center justify-center rounded-lg shrink-0"
            style={{ background: `${meta.color}1a`, border: `1px solid ${meta.color}33`, color: meta.color }}
          >
            <Icon className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-medium text-[var(--j-text)] truncate">{method.label}</div>
            <div className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">{meta.label}</div>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {method.isDefault && (
            <Badge
              variant="outline"
              className="border-0 text-[9px] uppercase jarvis-mono"
              style={{ color: JARVIS.colors.amber, background: `${JARVIS.colors.amber}1a`, border: `1px solid ${JARVIS.colors.amber}33` }}
            >
              <Star className="h-2.5 w-2.5 mr-0.5" /> Default
            </Badge>
          )}
          {method.verified && (
            <Badge
              variant="outline"
              className="border-0 text-[9px] uppercase jarvis-mono"
              style={{ color: JARVIS.colors.green, background: `${JARVIS.colors.green}1a`, border: `1px solid ${JARVIS.colors.green}33` }}
            >
              <CheckCircle2 className="h-2.5 w-2.5 mr-0.5" /> Verified
            </Badge>
          )}
        </div>
      </div>

      {/* Masked preview */}
      <div className="flex items-center gap-2 mb-3">
        <Lock className="h-3 w-3 text-[var(--j-text-mute)] shrink-0" />
        <span className="jarvis-mono text-xs text-[var(--j-text)] tracking-wider truncate">{method.masked}</span>
        <Pill color={meta.color}>{method.currency}</Pill>
      </div>

      {/* Meta row */}
      <div className="flex items-center justify-between text-[10px] text-[var(--j-text-mute)] mb-3">
        <span>
          Used {method.usageCount}× · {method.lastUsedAt ? timeAgo(method.lastUsedAt) : 'never'}
        </span>
        <div className="flex items-center gap-1.5">
          <span className="jarvis-mono uppercase">{method.enabled ? 'on' : 'off'}</span>
          <Switch checked={method.enabled} onCheckedChange={onToggleEnabled} aria-label="Toggle enabled" />
        </div>
      </div>

      {/* Hover actions */}
      <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-[var(--j-border-soft)]">
        {!method.isDefault && (
          <Button size="sm" variant="ghost" className="h-7 px-2 text-[10px] text-[var(--j-text-dim)] hover:text-[var(--j-amber)]" onClick={onSetDefault}>
            <Star className="h-3 w-3 mr-1" /> Set Default
          </Button>
        )}
        {!method.verified && (
          <Button size="sm" variant="ghost" className="h-7 px-2 text-[10px] text-[var(--j-text-dim)] hover:text-[var(--j-green)]" onClick={onVerify} disabled={verifying}>
            {verifying ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <ShieldCheck className="h-3 w-3 mr-1" />}
            Verify
          </Button>
        )}
        <Button size="sm" variant="ghost" className="h-7 px-2 text-[10px] text-[var(--j-text-dim)] hover:text-[var(--j-cyan)]" onClick={onEdit}>
          <Pencil className="h-3 w-3 mr-1" /> Edit
        </Button>
        <Button size="sm" variant="ghost" className="h-7 px-2 text-[10px] text-[var(--j-text-dim)] hover:text-[var(--j-red)] ml-auto" onClick={onDelete}>
          <Trash2 className="h-3 w-3 mr-1" /> Delete
        </Button>
      </div>
    </motion.div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Usage panel — recent Payment transactions for context
// ───────────────────────────────────────────────────────────────────────────

function UsagePanel({ payments, methods }: { payments: Payment[]; methods: PaymentMethodRow[] }) {
  if (!payments.length && !methods.length) return null;
  return (
    <div className="jarvis-panel p-4">
      <SectionTitle title="Recent Transaction Activity" icon={History} accent={JARVIS.colors.cyan} />
      {payments.length ? (
        <div className="max-h-72 overflow-y-auto jarvis-scroll -mx-2">
          {payments.map((p, i) => {
            const mapped = PAYMENT_TO_METHOD[p.method] ?? null;
            const meta = mapped ? METHOD_META[mapped] : null;
            const Icon = meta?.icon ?? Receipt;
            const color = meta?.color ?? JARVIS.colors.textMute;
            const statusColor =
              p.status === 'confirmed' ? JARVIS.colors.green :
              p.status === 'pending' ? JARVIS.colors.amber :
              p.status === 'failed' ? JARVIS.colors.red :
              JARVIS.colors.violet;
            return (
              <motion.div
                key={p.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: i * 0.02 }}
                className="flex items-center gap-3 px-2 py-2 rounded-md hover:bg-[var(--j-panel-soft)]/50"
              >
                <div
                  className="flex h-7 w-7 items-center justify-center rounded-md shrink-0"
                  style={{ background: `${color}1a`, border: `1px solid ${color}33`, color }}
                >
                  <Icon className="h-3.5 w-3.5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-xs text-[var(--j-text)] truncate">
                    {p.payer ?? '—'} · <span className="text-[var(--j-text-mute)]">{p.note ?? p.method}</span>
                  </div>
                  <div className="jarvis-mono text-[10px] text-[var(--j-text-mute)]">{timeAgo(p.createdAt)}</div>
                </div>
                <div className="text-right shrink-0">
                  <div className="jarvis-mono text-xs" style={{ color: statusColor }}>
                    {p.currency === 'INR' ? '₹' : p.currency + ' '}{p.amount.toLocaleString()}
                  </div>
                  <Pill color={statusColor}>{p.status}</Pill>
                </div>
              </motion.div>
            );
          })}
        </div>
      ) : (
        <EmptyState icon={Receipt} message="No recent transactions — payments recorded in the Payments tab will appear here" />
      )}
      <div className="mt-2 text-[10px] text-[var(--j-text-mute)] flex items-center gap-1">
        <ArrowUpRight className="h-3 w-3" />
        Transactions are recorded in the Payments tab and shown here for payout-method context.
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Add / Edit modal with dynamic method-specific fields
// ───────────────────────────────────────────────────────────────────────────

interface FormState {
  label: string;
  method: MethodKey;
  currency: string;
  isDefault: boolean;
  enabled: boolean;
  // method-specific
  vpa: string;
  accountNo: string;
  ifsc: string;
  name: string;
  cardNumber: string;
  cardExpiry: string;
  cardCvv: string;
  walletId: string;
  paypalEmail: string;
  cryptoAddress: string;
  cryptoChain: string;
}

const EMPTY_FORM: FormState = {
  label: '', method: 'upi', currency: 'INR', isDefault: false, enabled: true,
  vpa: '', accountNo: '', ifsc: '', name: '',
  cardNumber: '', cardExpiry: '', cardCvv: '',
  walletId: '', paypalEmail: '', cryptoAddress: '', cryptoChain: '',
};

function PaymentMethodModal({
  open,
  editing,
  onClose,
  onDone,
}: {
  open: boolean;
  editing: PaymentMethodRow | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [replaceDetails, setReplaceDetails] = useState(false);

  // Reset form when modal opens / target changes.
  useEffect(() => {
    if (!open) return;
    if (editing) {
      setForm({
        ...EMPTY_FORM,
        label: editing.label,
        method: editing.method,
        currency: editing.currency,
        isDefault: editing.isDefault,
        enabled: editing.enabled,
      });
      setReplaceDetails(false);
    } else {
      setForm(EMPTY_FORM);
      setReplaceDetails(false);
    }
  }, [open, editing]);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  // Build the details object for the current method.
  const buildDetails = (): Record<string, string> | null => {
    switch (form.method) {
      case 'upi': {
        const vpa = form.vpa.trim();
        if (!vpa || !vpa.includes('@')) return null;
        return { vpa };
      }
      case 'bank': {
        const accountNo = form.accountNo.trim();
        const ifsc = form.ifsc.trim().toUpperCase();
        const name = form.name.trim();
        if (!accountNo || !ifsc || !name) return null;
        return { accountNo, ifsc, name };
      }
      case 'card': {
        const digits = form.cardNumber.replace(/\s+/g, '');
        if (!/^\d{12,19}$/.test(digits)) return null;
        const cardLast4 = digits.slice(-4);
        const expiry = form.cardExpiry.trim();
        const cvv = form.cardCvv.trim();
        if (!/^\d{2}\/\d{2}$/.test(expiry)) return null;
        if (!/^\d{3,4}$/.test(cvv)) return null;
        // token holds the sensitive full details (encrypted at rest).
        return { cardLast4, token: `${digits}|${expiry}|${cvv}` };
      }
      case 'wallet': {
        const walletId = form.walletId.trim();
        if (!walletId) return null;
        return { walletId };
      }
      case 'paypal': {
        const email = form.paypalEmail.trim();
        if (!email || !email.includes('@')) return null;
        return { email };
      }
      case 'crypto': {
        const address = form.cryptoAddress.trim();
        if (!address) return null;
        const chain = form.cryptoChain.trim() || 'generic';
        return { address, chain };
      }
      default:
        return null;
    }
  };

  const submit = async () => {
    if (!form.label.trim()) {
      toast({ title: 'Label is required', variant: 'destructive' });
      return;
    }

    if (editing) {
      // Edit mode: only update metadata unless replaceDetails is on.
      const patch: Record<string, unknown> = {
        label: form.label.trim(),
        currency: form.currency,
        isDefault: form.isDefault,
        enabled: form.enabled,
      };
      if (replaceDetails) {
        const details = buildDetails();
        if (!details) {
          toast({ title: 'Invalid details', description: 'Check the method-specific fields.', variant: 'destructive' });
          return;
        }
        patch.details = details;
      }
      setBusy(true);
      try {
        await patchJson(`/api/payment-methods/${editing.id}`, patch);
        toast({ title: 'Method updated', description: `“${form.label}” saved.` });
        onDone();
      } catch (e) {
        toast({ title: 'Failed', description: e instanceof Error ? e.message : '', variant: 'destructive' });
      } finally {
        setBusy(false);
      }
      return;
    }

    // Add mode: details required.
    const details = buildDetails();
    if (!details) {
      toast({ title: 'Invalid details', description: 'Fill all method-specific fields correctly.', variant: 'destructive' });
      return;
    }
    setBusy(true);
    try {
      await postJson('/api/payment-methods', {
        label: form.label.trim(),
        method: form.method,
        details,
        currency: form.currency,
        isDefault: form.isDefault,
      });
      toast({ title: 'Payment method added', description: `“${form.label}” stored with AES-256-GCM encryption.` });
      onDone();
    } catch (e) {
      toast({ title: 'Failed', description: e instanceof Error ? e.message : '', variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  const meta = METHOD_META[form.method];
  const Icon = meta.icon;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="bg-[var(--j-panel)] border-[var(--j-border)] text-[var(--j-text)] max-w-lg max-h-[90vh] overflow-y-auto jarvis-scroll">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[var(--j-green)]">
            <CreditCard className="h-4 w-4" />
            {editing ? 'Edit Payment Method' : 'Add Payment Method'}
          </DialogTitle>
          <DialogDescription className="text-[var(--j-text-dim)]">
            {editing
              ? 'Update label, default, or replace encrypted details. Stored details are never displayed.'
              : 'Store a payout instrument for receiving earnings. Details are AES-256-GCM encrypted at rest.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Label + currency */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">Label</Label>
              <Input
                value={form.label}
                onChange={(e) => set('label', e.target.value)}
                placeholder="Primary UPI"
                className="bg-[var(--j-panel-soft)] border-[var(--j-border)]"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">Currency</Label>
              <Select value={form.currency} onValueChange={(v) => set('currency', v)}>
                <SelectTrigger className="bg-[var(--j-panel-soft)] border-[var(--j-border)]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CURRENCIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Method selector */}
          <div className="space-y-1.5">
            <Label className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">Method</Label>
            <Select
              value={form.method}
              onValueChange={(v) => set('method', v as MethodKey)}
              disabled={!!editing}
            >
              <SelectTrigger className="bg-[var(--j-panel-soft)] border-[var(--j-border)]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(METHOD_META) as MethodKey[]).map((k) => {
                  const M = METHOD_META[k];
                  const I = M.icon;
                  return (
                    <SelectItem key={k} value={k}>
                      <span className="flex items-center gap-2">
                        <I className="h-3.5 w-3.5" style={{ color: M.color }} />
                        {M.label} — <span className="text-[var(--j-text-mute)] text-xs">{M.description}</span>
                      </span>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
            {editing && (
              <p className="text-[10px] text-[var(--j-text-mute)]">Method cannot be changed after creation. Use “Replace details” below to rotate credentials.</p>
            )}
          </div>

          {/* Method-specific fields */}
          {editing && !replaceDetails ? (
            <div
              className="rounded-md border p-3 flex items-center gap-2 text-xs"
              style={{ borderColor: `${JARVIS.colors.cyan}33`, background: `${JARVIS.colors.cyan}0a`, color: JARVIS.colors.cyan }}
            >
              <Lock className="h-3.5 w-3.5 shrink-0" />
              <span>Stored details are encrypted and hidden. Enable “Replace details” to enter new values.</span>
            </div>
          ) : (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              className="space-y-3 p-3 rounded-md border border-[var(--j-border)] bg-[var(--j-panel-soft)]/40"
            >
              <div className="flex items-center gap-2 text-xs text-[var(--j-text-dim)]">
                <Icon className="h-3.5 w-3.5" style={{ color: meta.color }} />
                <span className="jarvis-mono uppercase text-[10px]">{meta.label} fields</span>
              </div>
              {form.method === 'upi' && (
                <Field label="VPA (Virtual Payment Address)" value={form.vpa} onChange={(v) => set('vpa', v)} placeholder="yourname@oksbi" />
              )}
              {form.method === 'bank' && (
                <>
                  <Field label="Account Number" value={form.accountNo} onChange={(v) => set('accountNo', v)} placeholder="1234567890123" />
                  <Field label="IFSC Code" value={form.ifsc} onChange={(v) => set('ifsc', v.toUpperCase())} placeholder="HDFC0001234" />
                  <Field label="Account Holder Name" value={form.name} onChange={(v) => set('name', v)} placeholder="Raviteja Voruganti" />
                </>
              )}
              {form.method === 'card' && (
                <>
                  <Field label="Card Number" value={form.cardNumber} onChange={(v) => set('cardNumber', v)} placeholder="4242 4242 4242 4242" />
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Expiry (MM/YY)" value={form.cardExpiry} onChange={(v) => set('cardExpiry', v)} placeholder="12/27" />
                    <Field label="CVV" value={form.cardCvv} onChange={(v) => set('cardCvv', v)} placeholder="123" type="password" />
                  </div>
                  <p className="text-[10px] text-[var(--j-text-mute)]">Only the last 4 digits are shown in previews; full card data is encrypted.</p>
                </>
              )}
              {form.method === 'wallet' && (
                <Field label="Wallet ID / Phone" value={form.walletId} onChange={(v) => set('walletId', v)} placeholder="+91 98765 43210 or wallet@paytm" />
              )}
              {form.method === 'paypal' && (
                <Field label="PayPal Email" value={form.paypalEmail} onChange={(v) => set('paypalEmail', v)} placeholder="you@example.com" type="email" />
              )}
              {form.method === 'crypto' && (
                <>
                  <Field label="Wallet Address" value={form.cryptoAddress} onChange={(v) => set('cryptoAddress', v)} placeholder="0x... or bc1..." />
                  <Field label="Chain (optional)" value={form.cryptoChain} onChange={(v) => set('cryptoChain', v)} placeholder="USDT-TRC20 / BTC / ETH" />
                </>
              )}
            </motion.div>
          )}

          {editing && (
            <div className="flex items-center justify-between rounded-md border border-[var(--j-border)] px-3 py-2">
              <div>
                <div className="text-xs text-[var(--j-text)]">Replace stored details</div>
                <div className="text-[10px] text-[var(--j-text-mute)]">Re-enter all method-specific fields to rotate credentials.</div>
              </div>
              <Switch checked={replaceDetails} onCheckedChange={setReplaceDetails} />
            </div>
          )}

          {/* Toggles: default + enabled */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex items-center justify-between rounded-md border border-[var(--j-border)] px-3 py-2">
              <div>
                <div className="text-xs text-[var(--j-text)]">Set as default</div>
                <div className="text-[10px] text-[var(--j-text-mute)]">Primary payout target</div>
              </div>
              <Switch checked={form.isDefault} onCheckedChange={(v) => set('isDefault', v)} />
            </div>
            {!editing && (
              <div className="flex items-center justify-between rounded-md border border-[var(--j-border)] px-3 py-2">
                <div>
                  <div className="text-xs text-[var(--j-text)]">Enabled</div>
                  <div className="text-[10px] text-[var(--j-text-mute)]">Available for payouts</div>
                </div>
                <Switch checked={form.enabled} onCheckedChange={(v) => set('enabled', v)} />
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onClose} className="text-[var(--j-text-dim)] hover:text-[var(--j-text)]">
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy} className="jarvis-btn-accent border-0">
            {busy ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : null}
            {editing ? 'Save Changes' : 'Add Method'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Reusable field
// ───────────────────────────────────────────────────────────────────────────

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">{label}</Label>
      <Input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="bg-[var(--j-panel-soft)] border-[var(--j-border)]"
        autoComplete="off"
      />
    </div>
  );
}
