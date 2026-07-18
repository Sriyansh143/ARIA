'use client';

import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  Users, UserPlus, Plus, X, RefreshCw, Trash2, Phone, Mail, Building2,
  Award, Target, Trophy, TrendingUp, Send, AlertTriangle, CheckCircle2, Clock,
  Headphones, MessageSquare, Mail as MailIcon, PhoneCall, Send as SendIcon, Edit3,
} from 'lucide-react';
import { MergedTab } from '@/components/jarvis/MergedTab';
import { useApi, postJson, patchJson, deleteJson } from '@/lib/hooks/use-api';
import { JARVIS } from '@/lib/config';
import { SectionTitle, StatCard, Pill, EmptyState } from '@/components/jarvis/shared';
import { useToast } from '@/hooks/use-toast';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

/* ====================================================================== */
/* Types                                                                  */
/* ====================================================================== */

interface Client {
  id: string; name: string; company: string | null; email: string | null;
  phone: string | null; status: string; source: string | null; value: number;
  notes: string | null; assignee: string | null;
  createdAt: string; updatedAt: string;
}

interface Lead {
  id: string; clientName: string; company: string | null; email: string | null;
  phone: string | null; source: string; status: string; score: number;
  notes: string | null; createdAt: string; updatedAt: string;
}

interface SupportTicket {
  id: string; clientName: string; subject: string; body: string;
  priority: string; status: string; channel: string;
  assignee: string | null; resolution: string | null;
  createdAt: string; updatedAt: string;
}

const POLL_MS = 15000;

/* ====================================================================== */
/* Color maps (JARVIS palette — no indigo/blue)                          */
/* ====================================================================== */

const CLIENT_STATUS_COLOR: Record<string, string> = {
  lead: JARVIS.colors.cyan,
  contacted: JARVIS.colors.violet,
  qualified: JARVIS.colors.amber,
  proposal: JARVIS.colors.cyanDim,
  negotiation: JARVIS.colors.amber,
  won: JARVIS.colors.green,
  lost: JARVIS.colors.red,
};

const LEAD_STATUS_COLOR: Record<string, string> = {
  new: JARVIS.colors.cyan,
  contacted: JARVIS.colors.violet,
  qualified: JARVIS.colors.amber,
  converted: JARVIS.colors.green,
  lost: JARVIS.colors.red,
};

const TICKET_STATUS_COLOR: Record<string, string> = {
  open: JARVIS.colors.cyan,
  in_progress: JARVIS.colors.violet,
  resolved: JARVIS.colors.green,
  closed: JARVIS.colors.textMute,
};

const TICKET_PRIORITY_COLOR: Record<string, string> = {
  low: JARVIS.colors.textMute,
  medium: JARVIS.colors.cyan,
  high: JARVIS.colors.amber,
  urgent: JARVIS.colors.red,
};

const CHANNEL_ICON: Record<string, typeof MessageSquare> = {
  chat: MessageSquare,
  email: MailIcon,
  phone: PhoneCall,
  telegram: SendIcon,
};

const SOURCE_COLOR: Record<string, string> = {
  web: JARVIS.colors.cyan,
  referral: JARVIS.colors.green,
  'cold-outreach': JARVIS.colors.amber,
  inbound: JARVIS.colors.violet,
};

/* ====================================================================== */
/* Main CRMTab — MergedTab with 3 sub-views                              */
/* ====================================================================== */

export default function CRMTab() {
  return (
    <MergedTab
      accent={JARVIS.colors.amber}
      views={[
        { key: 'clients', label: 'Clients', component: <ClientsView /> },
        { key: 'leads', label: 'Leads', component: <LeadsView /> },
        { key: 'support', label: 'Support', component: <SupportView /> },
      ]}
    />
  );
}

/* ====================================================================== */
/* Clients View                                                           */
/* ====================================================================== */

const CLIENT_STATUSES = ['lead', 'contacted', 'qualified', 'proposal', 'negotiation', 'won', 'lost'];

function ClientsView() {
  const { data, loading, refresh } = useApi<{
    clients: Client[];
    stats: { total: number; pipelineValue: number; byStatus: Record<string, { count: number; value: number }> };
  }>('/api/clients', POLL_MS);
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Client | null>(null);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');

  const clients = data?.clients ?? [];
  const filtered = useMemo(() => {
    let list = clients;
    if (filter !== 'all') list = list.filter((c) => c.status === filter);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((c) =>
        c.name.toLowerCase().includes(q) ||
        (c.company ?? '').toLowerCase().includes(q) ||
        (c.email ?? '').toLowerCase().includes(q) ||
        (c.assignee ?? '').toLowerCase().includes(q),
      );
    }
    return list;
  }, [clients, filter, search]);

  const counts = {
    total: data?.stats.total ?? 0,
    lead: data?.stats.byStatus?.lead?.count ?? 0,
    qualified: data?.stats.byStatus?.qualified?.count ?? 0,
    won: data?.stats.byStatus?.won?.count ?? 0,
  };

  const remove = async (c: Client) => {
    if (!confirm(`Delete client "${c.name}"?`)) return;
    try {
      await deleteJson(`/api/clients/${c.id}`);
      toast({ title: 'Client deleted' });
      refresh();
    } catch (e) {
      toast({ title: 'Delete failed', description: e instanceof Error ? e.message : '', variant: 'destructive' });
    }
  };

  return (
    <div className="space-y-4">
      <SectionTitle
        title="Clients & Pipeline"
        icon={Users}
        accent={JARVIS.colors.amber}
        action={
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={refresh} className="border-[var(--j-border)] bg-transparent hover:bg-[var(--j-panel-soft)]">
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
            <Button size="sm" variant="outline" className="jarvis-btn-accent border-0" onClick={() => { setEditing(null); setOpen(true); }}>
              <Plus className="h-3.5 w-3.5 mr-1" /> New Client
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Total Clients" value={counts.total} sub="all stages" icon={Users} accent={JARVIS.colors.cyan} />
        <StatCard label="Leads" value={counts.lead} sub="top of funnel" icon={UserPlus} accent={JARVIS.colors.cyan} />
        <StatCard label="Qualified" value={counts.qualified} sub="sales-ready" icon={Award} accent={JARVIS.colors.amber} />
        <StatCard label="Won" value={counts.won} sub="closed deals" icon={Trophy} accent={JARVIS.colors.green} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="flex flex-wrap gap-1.5">
          {['all', ...CLIENT_STATUSES].map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`jarvis-mono text-[10px] uppercase px-2.5 py-1.5 rounded-md border transition-colors ${
                filter === f ? 'jarvis-btn-accent border-0' : 'border-[var(--j-border)] text-[var(--j-text-dim)] hover:text-[var(--j-text)]'
              }`}
            >
              {f.replace('_', ' ')}
            </button>
          ))}
        </div>
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, company, email…"
          className="bg-[var(--j-panel-soft)] border-[var(--j-border)] h-8 text-xs md:ml-auto md:max-w-[260px]"
        />
      </div>

      {loading && !data ? (
        <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="jarvis-panel h-14 animate-pulse" />)}</div>
      ) : filtered.length ? (
        <div className="jarvis-panel p-0 overflow-hidden">
          <div className="grid grid-cols-12 gap-2 px-4 py-2 border-b border-[var(--j-border)] jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)] bg-[var(--j-panel-soft)]/40">
            <div className="col-span-3">Name / Company</div>
            <div className="col-span-2">Contact</div>
            <div className="col-span-2">Status</div>
            <div className="col-span-1 text-right">Value</div>
            <div className="col-span-2">Assignee</div>
            <div className="col-span-2 text-right">Actions</div>
          </div>
          <div className="max-h-[28rem] overflow-y-auto jarvis-scroll">
            {filtered.map((c, i) => {
              const color = CLIENT_STATUS_COLOR[c.status] ?? JARVIS.colors.textDim;
              return (
                <motion.div
                  key={c.id}
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.02 }}
                  className="grid grid-cols-12 gap-2 px-4 py-2.5 border-b border-[var(--j-border-soft)] hover:bg-[var(--j-panel-soft)]/40 items-center"
                >
                  <div className="col-span-3 min-w-0">
                    <div className="text-xs text-[var(--j-text)] truncate">{c.name}</div>
                    <div className="text-[10px] text-[var(--j-text-mute)] truncate flex items-center gap-1">
                      <Building2 className="h-3 w-3" /> {c.company ?? '—'}
                    </div>
                  </div>
                  <div className="col-span-2 text-[10px] text-[var(--j-text-dim)] space-y-0.5 min-w-0">
                    {c.email && <div className="truncate flex items-center gap-1"><Mail className="h-3 w-3 shrink-0" /> {c.email}</div>}
                    {c.phone && <div className="truncate flex items-center gap-1"><Phone className="h-3 w-3 shrink-0" /> {c.phone}</div>}
                    {!c.email && !c.phone && <div>—</div>}
                  </div>
                  <div className="col-span-2">
                    <Pill color={color}>{c.status}</Pill>
                    {c.source && (
                      <span className="ml-1 jarvis-mono text-[9px] uppercase" style={{ color: SOURCE_COLOR[c.source] ?? JARVIS.colors.textMute }}>
                        · {c.source}
                      </span>
                    )}
                  </div>
                  <div className="col-span-1 text-right jarvis-mono text-xs" style={{ color: JARVIS.colors.green }}>
                    {c.value > 0 ? `₹${c.value.toLocaleString()}` : '—'}
                  </div>
                  <div className="col-span-2 text-xs text-[var(--j-text-dim)] truncate">{c.assignee ?? '—'}</div>
                  <div className="col-span-2 flex items-center justify-end gap-1">
                    <button
                      onClick={() => { setEditing(c); setOpen(true); }}
                      className="p-1.5 rounded-md hover:bg-[var(--j-cyan)]/10 text-[var(--j-cyan)] transition-colors"
                      title="Edit"
                    >
                      <Edit3 className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => remove(c)}
                      className="p-1.5 rounded-md hover:bg-[var(--j-red)]/10 text-[var(--j-red)] transition-colors"
                      title="Delete"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>
      ) : (
        <EmptyState
          icon={Users}
          message="No clients yet"
          hint="Add your first client to start tracking the sales pipeline."
          accent={JARVIS.colors.amber}
          action={{ label: 'Add Client', onClick: () => { setEditing(null); setOpen(true); } }}
        />
      )}

      {open && (
        <ClientModal
          editing={editing}
          onClose={() => setOpen(false)}
          onDone={() => { setOpen(false); refresh(); }}
        />
      )}
    </div>
  );
}

/* ---------- Client Modal ---------- */

function ClientModal({
  editing,
  onClose,
  onDone,
}: {
  editing: Client | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [name, setName] = useState(editing?.name ?? '');
  const [company, setCompany] = useState(editing?.company ?? '');
  const [email, setEmail] = useState(editing?.email ?? '');
  const [phone, setPhone] = useState(editing?.phone ?? '');
  const [status, setStatus] = useState(editing?.status ?? 'lead');
  const [source, setSource] = useState(editing?.source ?? 'web');
  const [value, setValue] = useState(editing ? String(editing.value ?? 0) : '');
  const [assignee, setAssignee] = useState(editing?.assignee ?? '');
  const [notes, setNotes] = useState(editing?.notes ?? '');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!name.trim()) {
      toast({ title: 'Name is required', variant: 'destructive' });
      return;
    }
    setBusy(true);
    try {
      const payload = {
        name: name.trim(),
        company: company.trim() || undefined,
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
        status,
        source,
        value: value ? Number(value) : 0,
        assignee: assignee.trim() || undefined,
        notes: notes.trim() || undefined,
      };
      if (editing) {
        await patchJson(`/api/clients/${editing.id}`, payload);
        toast({ title: 'Client updated' });
      } else {
        await postJson('/api/clients', payload);
        toast({ title: 'Client created' });
      }
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
      <motion.div initial={{ scale: 0.96, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="relative w-full max-w-lg jarvis-panel p-5 max-h-[90vh] overflow-y-auto jarvis-scroll">
        <div className="flex items-center justify-between mb-4">
          <h3 className="jarvis-mono text-sm uppercase text-[var(--j-amber)]">
            {editing ? 'Edit Client' : 'New Client'}
          </h3>
          <button onClick={onClose} className="text-[var(--j-text-mute)] hover:text-[var(--j-text)]"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">Name *</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="John Doe" className="bg-[var(--j-panel-soft)] border-[var(--j-border)]" />
            </div>
            <div>
              <label className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">Company</label>
              <Input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Acme Corp" className="bg-[var(--j-panel-soft)] border-[var(--j-border)]" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">Email</label>
              <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="john@acme.com" className="bg-[var(--j-panel-soft)] border-[var(--j-border)]" />
            </div>
            <div>
              <label className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">Phone</label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 99999 12345" className="bg-[var(--j-panel-soft)] border-[var(--j-border)]" />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">Status</label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="bg-[var(--j-panel-soft)] border-[var(--j-border)]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CLIENT_STATUSES.map((s) => <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">Source</label>
              <Select value={source} onValueChange={setSource}>
                <SelectTrigger className="bg-[var(--j-panel-soft)] border-[var(--j-border)]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {['web', 'referral', 'cold-outreach', 'inbound'].map((s) => <SelectItem key={s} value={s} className="capitalize">{s.replace('-', ' ')}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">Value (₹)</label>
              <Input type="number" value={value} onChange={(e) => setValue(e.target.value)} placeholder="4999" className="bg-[var(--j-panel-soft)] border-[var(--j-border)]" />
            </div>
          </div>
          <div>
            <label className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">Assignee</label>
            <Input value={assignee} onChange={(e) => setAssignee(e.target.value)} placeholder="orion / atlas / sales-agent" className="bg-[var(--j-panel-soft)] border-[var(--j-border)]" />
          </div>
          <div>
            <label className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">Notes</label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Background, decision criteria, next steps…" className="bg-[var(--j-panel-soft)] border-[var(--j-border)] min-h-[70px]" />
          </div>
          <Button onClick={submit} disabled={busy} className="w-full jarvis-btn-accent border-0">
            {busy ? 'Saving…' : editing ? 'Update Client' : 'Create Client'}
          </Button>
        </div>
      </motion.div>
    </motion.div>
  );
}

/* ====================================================================== */
/* Leads View                                                             */
/* ====================================================================== */

const LEAD_STATUSES = ['new', 'contacted', 'qualified', 'converted', 'lost'];
const LEAD_SOURCES = ['web', 'referral', 'cold-outreach', 'inbound'];

function LeadsView() {
  const { data, loading, refresh } = useApi<{
    leads: Lead[];
    stats: { total: number; avgScore: number; byStatus: Record<string, number>; bySource: Record<string, number> };
  }>('/api/leads', POLL_MS);
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');

  const leads = data?.leads ?? [];
  const filtered = useMemo(() => {
    let list = leads;
    if (filter !== 'all') list = list.filter((l) => l.status === filter);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((l) =>
        l.clientName.toLowerCase().includes(q) ||
        (l.company ?? '').toLowerCase().includes(q) ||
        (l.email ?? '').toLowerCase().includes(q),
      );
    }
    return list;
  }, [leads, filter, search]);

  const counts = {
    new: data?.stats.byStatus?.new ?? 0,
    contacted: data?.stats.byStatus?.contacted ?? 0,
    qualified: data?.stats.byStatus?.qualified ?? 0,
    converted: data?.stats.byStatus?.converted ?? 0,
  };

  const remove = async (l: Lead) => {
    if (!confirm(`Delete lead "${l.clientName}"?`)) return;
    try {
      await deleteJson(`/api/leads/${l.id}`);
      toast({ title: 'Lead deleted' });
      refresh();
    } catch (e) {
      toast({ title: 'Delete failed', description: e instanceof Error ? e.message : '', variant: 'destructive' });
    }
  };

  const convert = async (l: Lead) => {
    try {
      // Promote lead → client.
      await postJson('/api/clients', {
        name: l.clientName,
        company: l.company ?? undefined,
        email: l.email ?? undefined,
        phone: l.phone ?? undefined,
        status: 'lead',
        source: l.source,
        notes: l.notes ?? undefined,
      });
      await patchJson(`/api/leads/${l.id}`, { status: 'converted' });
      toast({ title: `Lead converted → ${l.clientName} added to clients` });
      refresh();
    } catch (e) {
      toast({ title: 'Convert failed', description: e instanceof Error ? e.message : '', variant: 'destructive' });
    }
  };

  return (
    <div className="space-y-4">
      <SectionTitle
        title="Leads & Prospects"
        icon={Target}
        accent={JARVIS.colors.amber}
        action={
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={refresh} className="border-[var(--j-border)] bg-transparent hover:bg-[var(--j-panel-soft)]">
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
            <Button size="sm" variant="outline" className="jarvis-btn-accent border-0" onClick={() => setOpen(true)}>
              <Plus className="h-3.5 w-3.5 mr-1" /> New Lead
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="New" value={counts.new} sub="fresh leads" icon={UserPlus} accent={JARVIS.colors.cyan} />
        <StatCard label="Contacted" value={counts.contacted} sub="reached out" icon={Send} accent={JARVIS.colors.violet} />
        <StatCard label="Qualified" value={counts.qualified} sub="sales-ready" icon={Award} accent={JARVIS.colors.amber} />
        <StatCard label="Converted" value={counts.converted} sub="→ clients" icon={Trophy} accent={JARVIS.colors.green} />
      </div>

      {/* Lead-scoring visualization */}
      <div className="jarvis-panel p-4">
        <SectionTitle title="Lead Score Distribution" icon={TrendingUp} accent={JARVIS.colors.green} />
        <LeadScoreDistribution leads={leads} />
        <div className="grid grid-cols-3 gap-3 mt-3 text-center">
          <div>
            <div className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)]">Avg Score</div>
            <div className="text-xl font-semibold" style={{ color: JARVIS.colors.green }}>{data?.stats.avgScore ?? 0}</div>
          </div>
          <div>
            <div className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)]">Hot (≥70)</div>
            <div className="text-xl font-semibold" style={{ color: JARVIS.colors.red }}>{leads.filter((l) => l.score >= 70).length}</div>
          </div>
          <div>
            <div className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)]">{'Cold (<40)'}</div>
            <div className="text-xl font-semibold" style={{ color: JARVIS.colors.cyan }}>{leads.filter((l) => l.score < 40).length}</div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="flex flex-wrap gap-1.5">
          {['all', ...LEAD_STATUSES].map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`jarvis-mono text-[10px] uppercase px-2.5 py-1.5 rounded-md border transition-colors ${
                filter === f ? 'jarvis-btn-accent border-0' : 'border-[var(--j-border)] text-[var(--j-text-dim)] hover:text-[var(--j-text)]'
              }`}
            >
              {f.replace('_', ' ')}
            </button>
          ))}
        </div>
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, company, email…"
          className="bg-[var(--j-panel-soft)] border-[var(--j-border)] h-8 text-xs md:ml-auto md:max-w-[260px]"
        />
      </div>

      {loading && !data ? (
        <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="jarvis-panel h-14 animate-pulse" />)}</div>
      ) : filtered.length ? (
        <div className="jarvis-panel p-0 overflow-hidden">
          <div className="grid grid-cols-12 gap-2 px-4 py-2 border-b border-[var(--j-border)] jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)] bg-[var(--j-panel-soft)]/40">
            <div className="col-span-3">Lead / Company</div>
            <div className="col-span-2">Contact</div>
            <div className="col-span-2">Source</div>
            <div className="col-span-1 text-center">Score</div>
            <div className="col-span-2">Status</div>
            <div className="col-span-2 text-right">Actions</div>
          </div>
          <div className="max-h-[28rem] overflow-y-auto jarvis-scroll">
            {filtered.map((l, i) => {
              const color = LEAD_STATUS_COLOR[l.status] ?? JARVIS.colors.textDim;
              const scoreColor = l.score >= 70 ? JARVIS.colors.red : l.score >= 40 ? JARVIS.colors.amber : JARVIS.colors.cyan;
              return (
                <motion.div
                  key={l.id}
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.02 }}
                  className="grid grid-cols-12 gap-2 px-4 py-2.5 border-b border-[var(--j-border-soft)] hover:bg-[var(--j-panel-soft)]/40 items-center"
                >
                  <div className="col-span-3 min-w-0">
                    <div className="text-xs text-[var(--j-text)] truncate">{l.clientName}</div>
                    <div className="text-[10px] text-[var(--j-text-mute)] truncate flex items-center gap-1">
                      <Building2 className="h-3 w-3" /> {l.company ?? '—'}
                    </div>
                  </div>
                  <div className="col-span-2 text-[10px] text-[var(--j-text-dim)] space-y-0.5 min-w-0">
                    {l.email && <div className="truncate flex items-center gap-1"><Mail className="h-3 w-3 shrink-0" /> {l.email}</div>}
                    {l.phone && <div className="truncate flex items-center gap-1"><Phone className="h-3 w-3 shrink-0" /> {l.phone}</div>}
                    {!l.email && !l.phone && <div>—</div>}
                  </div>
                  <div className="col-span-2">
                    <Pill color={SOURCE_COLOR[l.source] ?? JARVIS.colors.textMute}>{l.source.replace('-', ' ')}</Pill>
                  </div>
                  <div className="col-span-1 text-center">
                    <span className="jarvis-mono text-sm font-semibold" style={{ color: scoreColor }}>{l.score}</span>
                  </div>
                  <div className="col-span-2"><Pill color={color}>{l.status}</Pill></div>
                  <div className="col-span-2 flex items-center justify-end gap-1">
                    {l.status !== 'converted' && (
                      <button
                        onClick={() => convert(l)}
                        className="p-1.5 rounded-md hover:bg-[var(--j-green)]/10 text-[var(--j-green)] transition-colors"
                        title="Convert to client"
                      >
                        <Trophy className="h-3.5 w-3.5" />
                      </button>
                    )}
                    <button
                      onClick={() => remove(l)}
                      className="p-1.5 rounded-md hover:bg-[var(--j-red)]/10 text-[var(--j-red)] transition-colors"
                      title="Delete"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>
      ) : (
        <EmptyState
          icon={Target}
          message="No leads yet"
          hint="Capture prospects from web, referrals, cold outreach, or inbound channels. Lead scores are auto-computed."
          accent={JARVIS.colors.amber}
          action={{ label: 'Add Lead', onClick: () => setOpen(true) }}
        />
      )}

      {open && <LeadModal onClose={() => setOpen(false)} onDone={() => { setOpen(false); refresh(); }} />}
    </div>
  );
}

/* ---------- Lead score distribution bar chart ---------- */

function LeadScoreDistribution({ leads }: { leads: Lead[] }) {
  const BUCKETS = [
    { label: '0-19', min: 0, max: 19, color: JARVIS.colors.cyan },
    { label: '20-39', min: 20, max: 39, color: JARVIS.colors.cyanDim },
    { label: '40-59', min: 40, max: 59, color: JARVIS.colors.amber },
    { label: '60-79', min: 60, max: 79, color: JARVIS.colors.amber },
    { label: '80-100', min: 80, max: 100, color: JARVIS.colors.red },
  ];
  const counts = BUCKETS.map((b) => leads.filter((l) => l.score >= b.min && l.score <= b.max).length);
  const max = Math.max(1, ...counts);
  return (
    <div className="flex items-end justify-between gap-2 h-24">
      {BUCKETS.map((b, i) => (
        <div key={b.label} className="flex-1 flex flex-col items-center justify-end gap-1">
          <span className="jarvis-mono text-[9px] text-[var(--j-text-dim)]">{counts[i]}</span>
          <div
            className="w-full rounded-t transition-all"
            style={{
              height: `${(counts[i] / max) * 64}px`,
              background: `linear-gradient(180deg, ${b.color}, ${b.color}33)`,
              minHeight: counts[i] > 0 ? '4px' : '0',
            }}
          />
          <span className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)]">{b.label}</span>
        </div>
      ))}
    </div>
  );
}

/* ---------- Lead Modal ---------- */

function LeadModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { toast } = useToast();
  const [clientName, setClientName] = useState('');
  const [company, setCompany] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [source, setSource] = useState('web');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  // Live auto-score preview (mirrors server logic).
  const liveScore = useMemo(() => {
    let score = 0;
    if (source === 'referral') score += 25;
    else if (source === 'inbound') score += 20;
    else if (source === 'web') score += 10;
    else if (source === 'cold-outreach') score += 5;
    else score += 5;
    if (clientName.trim().length >= 2) score += 10;
    if (email.includes('@')) {
      score += 15;
      const domain = email.split('@')[1]?.toLowerCase() ?? '';
      const FREE = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com', 'aol.com'];
      if (domain && !FREE.includes(domain)) score += 10;
    }
    if (phone.replace(/\D/g, '').length >= 7) score += 15;
    if (company.trim().length >= 2) score += 10;
    if (notes.trim().length >= 8) score += 5;
    return Math.max(0, Math.min(100, score));
  }, [source, clientName, email, phone, company, notes]);

  const scoreColor = liveScore >= 70 ? JARVIS.colors.red : liveScore >= 40 ? JARVIS.colors.amber : JARVIS.colors.cyan;

  const submit = async () => {
    if (!clientName.trim()) {
      toast({ title: 'Name is required', variant: 'destructive' });
      return;
    }
    setBusy(true);
    try {
      await postJson('/api/leads', {
        clientName: clientName.trim(),
        company: company.trim() || undefined,
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
        source,
        notes: notes.trim() || undefined,
      });
      toast({ title: `Lead created (score: ${liveScore})` });
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
          <h3 className="jarvis-mono text-sm uppercase text-[var(--j-amber)]">New Lead</h3>
          <button onClick={onClose} className="text-[var(--j-text-mute)] hover:text-[var(--j-text)]"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">Name *</label>
            <Input value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="John from Acme" className="bg-[var(--j-panel-soft)] border-[var(--j-border)]" />
          </div>
          <div>
            <label className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">Company</label>
            <Input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Acme Corp" className="bg-[var(--j-panel-soft)] border-[var(--j-border)]" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">Email</label>
              <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="john@acme.com" className="bg-[var(--j-panel-soft)] border-[var(--j-border)]" />
            </div>
            <div>
              <label className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">Phone</label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 99999 12345" className="bg-[var(--j-panel-soft)] border-[var(--j-border)]" />
            </div>
          </div>
          <div>
            <label className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">Source</label>
            <Select value={source} onValueChange={setSource}>
              <SelectTrigger className="bg-[var(--j-panel-soft)] border-[var(--j-border)]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {LEAD_SOURCES.map((s) => <SelectItem key={s} value={s} className="capitalize">{s.replace('-', ' ')}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">Notes</label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Context, intent, next steps…" className="bg-[var(--j-panel-soft)] border-[var(--j-border)] min-h-[60px]" />
          </div>
          {/* Live auto-score preview */}
          <div className="flex items-center justify-between p-3 rounded-lg border border-[var(--j-border-soft)] bg-[var(--j-panel-soft)]/40">
            <div>
              <div className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)]">Auto-Score Preview</div>
              <div className="text-[10px] text-[var(--j-text-dim)] mt-0.5">Computed from source + completeness</div>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-16 h-1.5 rounded-full bg-[var(--j-border)] overflow-hidden">
                <div className="h-full rounded-full transition-all" style={{ width: `${liveScore}%`, background: scoreColor }} />
              </div>
              <span className="jarvis-mono text-lg font-semibold" style={{ color: scoreColor }}>{liveScore}</span>
            </div>
          </div>
          <Button onClick={submit} disabled={busy} className="w-full jarvis-btn-accent border-0">
            {busy ? 'Creating…' : 'Create Lead'}
          </Button>
        </div>
      </motion.div>
    </motion.div>
  );
}

/* ====================================================================== */
/* Support View                                                           */
/* ====================================================================== */

const TICKET_STATUSES = ['open', 'in_progress', 'resolved', 'closed'];
const TICKET_PRIORITIES = ['low', 'medium', 'high', 'urgent'];
const TICKET_CHANNELS = ['chat', 'email', 'phone', 'telegram'];

function SupportView() {
  const { data, loading, refresh } = useApi<{
    tickets: SupportTicket[];
    stats: { total: number; byStatus: Record<string, number>; byPriority: Record<string, number>; byChannel: Record<string, number> };
  }>('/api/support', POLL_MS);
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [assigning, setAssigning] = useState<SupportTicket | null>(null);
  const [filter, setFilter] = useState('all');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [search, setSearch] = useState('');

  const tickets = data?.tickets ?? [];
  const filtered = useMemo(() => {
    let list = tickets;
    if (filter !== 'all') list = list.filter((t) => t.status === filter);
    if (priorityFilter !== 'all') list = list.filter((t) => t.priority === priorityFilter);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((t) =>
        t.clientName.toLowerCase().includes(q) ||
        t.subject.toLowerCase().includes(q) ||
        t.body.toLowerCase().includes(q),
      );
    }
    return list;
  }, [tickets, filter, priorityFilter, search]);

  const counts = {
    open: data?.stats.byStatus?.open ?? 0,
    in_progress: data?.stats.byStatus?.in_progress ?? 0,
    resolved: data?.stats.byStatus?.resolved ?? 0,
    urgent: data?.stats.byPriority?.urgent ?? 0,
  };

  const advance = async (t: SupportTicket) => {
    const next = nextTicketStatus(t.status);
    if (!next) return;
    try {
      await patchJson(`/api/support/${t.id}`, { status: next });
      toast({ title: `Ticket → ${next.replace('_', ' ')}` });
      refresh();
    } catch (e) {
      toast({ title: 'Failed', description: e instanceof Error ? e.message : '', variant: 'destructive' });
    }
  };

  const remove = async (t: SupportTicket) => {
    if (!confirm(`Delete ticket "${t.subject}"?`)) return;
    try {
      await deleteJson(`/api/support/${t.id}`);
      toast({ title: 'Ticket deleted' });
      refresh();
    } catch (e) {
      toast({ title: 'Delete failed', description: e instanceof Error ? e.message : '', variant: 'destructive' });
    }
  };

  return (
    <div className="space-y-4">
      <SectionTitle
        title="Support Tickets"
        icon={Headphones}
        accent={JARVIS.colors.amber}
        action={
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={refresh} className="border-[var(--j-border)] bg-transparent hover:bg-[var(--j-panel-soft)]">
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
            <Button size="sm" variant="outline" className="jarvis-btn-accent border-0" onClick={() => setOpen(true)}>
              <Plus className="h-3.5 w-3.5 mr-1" /> New Ticket
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Open" value={counts.open} sub="awaiting triage" icon={Clock} accent={JARVIS.colors.cyan} />
        <StatCard label="In Progress" value={counts.in_progress} sub="being worked" icon={RefreshCw} accent={JARVIS.colors.violet} />
        <StatCard label="Resolved" value={counts.resolved} sub="closed this period" icon={CheckCircle2} accent={JARVIS.colors.green} />
        <StatCard label="Urgent" value={counts.urgent} sub="needs attention" icon={AlertTriangle} accent={JARVIS.colors.red} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="flex flex-wrap gap-1.5">
          {['all', ...TICKET_STATUSES].map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`jarvis-mono text-[10px] uppercase px-2.5 py-1.5 rounded-md border transition-colors ${
                filter === f ? 'jarvis-btn-accent border-0' : 'border-[var(--j-border)] text-[var(--j-text-dim)] hover:text-[var(--j-text)]'
              }`}
            >
              {f.replace('_', ' ')}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5 md:justify-center">
          {['all', ...TICKET_PRIORITIES].map((f) => (
            <button
              key={f}
              onClick={() => setPriorityFilter(f)}
              className={`jarvis-mono text-[10px] uppercase px-2.5 py-1.5 rounded-md border transition-colors ${
                priorityFilter === f ? 'jarvis-btn-accent border-0' : 'border-[var(--j-border)] text-[var(--j-text-dim)] hover:text-[var(--j-text)]'
              }`}
            >
              {f}
            </button>
          ))}
        </div>
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search subject, body, client…"
          className="bg-[var(--j-panel-soft)] border-[var(--j-border)] h-8 text-xs md:ml-auto md:max-w-[220px]"
        />
      </div>

      {loading && !data ? (
        <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="jarvis-panel h-20 animate-pulse" />)}</div>
      ) : filtered.length ? (
        <div className="space-y-2 max-h-[32rem] overflow-y-auto jarvis-scroll pr-1">
          {filtered.map((t, i) => {
            const statusColor = TICKET_STATUS_COLOR[t.status] ?? JARVIS.colors.textDim;
            const priorityColor = TICKET_PRIORITY_COLOR[t.priority] ?? JARVIS.colors.textMute;
            const ChannelIcon = CHANNEL_ICON[t.channel] ?? MessageSquare;
            return (
              <motion.div
                key={t.id}
                initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.02 }}
                className="jarvis-panel p-3 group"
              >
                <div className="flex items-start justify-between gap-3 mb-1.5">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Pill color={priorityColor}>{t.priority}</Pill>
                      <Pill color={statusColor}>{t.status.replace('_', ' ')}</Pill>
                      <span className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)] flex items-center gap-1">
                        <ChannelIcon className="h-3 w-3" /> {t.channel}
                      </span>
                    </div>
                    <div className="text-sm text-[var(--j-text)] mt-1.5 truncate">{t.subject}</div>
                    <div className="text-[10px] text-[var(--j-text-mute)] mt-0.5">
                      from <span className="text-[var(--j-text-dim)]">{t.clientName}</span>
                      {t.assignee && <> · assigned to <span className="text-[var(--j-cyan)]">{t.assignee}</span></>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {t.status !== 'closed' && (
                      <button
                        onClick={() => advance(t)}
                        className="p-1.5 rounded-md hover:bg-[var(--j-green)]/10 text-[var(--j-green)] transition-colors"
                        title={`Advance → ${nextTicketStatus(t.status) ?? 'done'}`}
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                    <button
                      onClick={() => setAssigning(t)}
                      className="p-1.5 rounded-md hover:bg-[var(--j-cyan)]/10 text-[var(--j-cyan)] transition-colors"
                      title="Assign"
                    >
                      <Users className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => remove(t)}
                      className="p-1.5 rounded-md hover:bg-[var(--j-red)]/10 text-[var(--j-red)] transition-colors"
                      title="Delete"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                <p className="text-xs text-[var(--j-text-dim)] line-clamp-2">{t.body}</p>
                {t.resolution && (
                  <div className="mt-2 pt-2 border-t border-[var(--j-border-soft)] text-[10px] text-[var(--j-green)] flex items-start gap-1">
                    <CheckCircle2 className="h-3 w-3 shrink-0 mt-0.5" /> {t.resolution}
                  </div>
                )}
              </motion.div>
            );
          })}
        </div>
      ) : (
        <EmptyState
          icon={Headphones}
          message="No support tickets"
          hint="Tickets from chat, email, phone, or telegram will appear here. Assign them to agents for resolution."
          accent={JARVIS.colors.amber}
          action={{ label: 'New Ticket', onClick: () => setOpen(true) }}
        />
      )}

      {open && <TicketModal onClose={() => setOpen(false)} onDone={() => { setOpen(false); refresh(); }} />}
      {assigning && (
        <AssignModal
          ticket={assigning}
          onClose={() => setAssigning(null)}
          onDone={() => { setAssigning(null); refresh(); }}
        />
      )}
    </div>
  );
}

/* ---------- New Ticket Modal ---------- */

function TicketModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { toast } = useToast();
  const [clientName, setClientName] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [priority, setPriority] = useState('medium');
  const [channel, setChannel] = useState('chat');
  const [assignee, setAssignee] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!clientName.trim() || !subject.trim() || !body.trim()) {
      toast({ title: 'Client name, subject, and body are required', variant: 'destructive' });
      return;
    }
    setBusy(true);
    try {
      await postJson('/api/support', {
        clientName: clientName.trim(),
        subject: subject.trim(),
        body: body.trim(),
        priority,
        channel,
        assignee: assignee.trim() || undefined,
      });
      toast({ title: 'Ticket created' });
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
      <motion.div initial={{ scale: 0.96, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="relative w-full max-w-md jarvis-panel p-5 max-h-[90vh] overflow-y-auto jarvis-scroll">
        <div className="flex items-center justify-between mb-4">
          <h3 className="jarvis-mono text-sm uppercase text-[var(--j-amber)]">New Support Ticket</h3>
          <button onClick={onClose} className="text-[var(--j-text-mute)] hover:text-[var(--j-text)]"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">Client Name *</label>
            <Input value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="Jane Doe" className="bg-[var(--j-panel-soft)] border-[var(--j-border)]" />
          </div>
          <div>
            <label className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">Subject *</label>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Can't login to my account" className="bg-[var(--j-panel-soft)] border-[var(--j-border)]" />
          </div>
          <div>
            <label className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">Body *</label>
            <Textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Describe the issue in detail…" className="bg-[var(--j-panel-soft)] border-[var(--j-border)] min-h-[90px]" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">Priority</label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger className="bg-[var(--j-panel-soft)] border-[var(--j-border)]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TICKET_PRIORITIES.map((p) => <SelectItem key={p} value={p} className="capitalize">{p}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">Channel</label>
              <Select value={channel} onValueChange={setChannel}>
                <SelectTrigger className="bg-[var(--j-panel-soft)] border-[var(--j-border)]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TICKET_CHANNELS.map((c) => <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <label className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">Assignee (optional)</label>
            <Input value={assignee} onChange={(e) => setAssignee(e.target.value)} placeholder="vega / support-agent" className="bg-[var(--j-panel-soft)] border-[var(--j-border)]" />
          </div>
          <Button onClick={submit} disabled={busy} className="w-full jarvis-btn-accent border-0">
            {busy ? 'Creating…' : 'Create Ticket'}
          </Button>
        </div>
      </motion.div>
    </motion.div>
  );
}

/* ---------- Assign + Resolve Modal ---------- */

function AssignModal({
  ticket,
  onClose,
  onDone,
}: {
  ticket: SupportTicket;
  onClose: () => void;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [assignee, setAssignee] = useState(ticket.assignee ?? '');
  const [status, setStatus] = useState(ticket.status);
  const [resolution, setResolution] = useState(ticket.resolution ?? '');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      await patchJson(`/api/support/${ticket.id}`, {
        assignee: assignee.trim() || null,
        status,
        resolution: resolution.trim() || null,
      });
      toast({ title: 'Ticket updated' });
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
          <div>
            <h3 className="jarvis-mono text-sm uppercase text-[var(--j-amber)]">Manage Ticket</h3>
            <div className="text-[10px] text-[var(--j-text-mute)] mt-0.5 truncate max-w-[280px]">{ticket.subject}</div>
          </div>
          <button onClick={onClose} className="text-[var(--j-text-mute)] hover:text-[var(--j-text)]"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">Assignee</label>
            <Input value={assignee} onChange={(e) => setAssignee(e.target.value)} placeholder="vega / support-agent" className="bg-[var(--j-panel-soft)] border-[var(--j-border)]" />
          </div>
          <div>
            <label className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">Status</label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="bg-[var(--j-panel-soft)] border-[var(--j-border)]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {TICKET_STATUSES.map((s) => <SelectItem key={s} value={s} className="capitalize">{s.replace('_', ' ')}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">Resolution</label>
            <Textarea value={resolution} onChange={(e) => setResolution(e.target.value)} placeholder="What was done to resolve this ticket?" className="bg-[var(--j-panel-soft)] border-[var(--j-border)] min-h-[80px]" />
          </div>
          <Button onClick={submit} disabled={busy} className="w-full jarvis-btn-accent border-0">
            {busy ? 'Saving…' : 'Save Changes'}
          </Button>
        </div>
      </motion.div>
    </motion.div>
  );
}

/* ---------- helpers ---------- */

function nextTicketStatus(current: string): string | null {
  const order = ['open', 'in_progress', 'resolved', 'closed'];
  const i = order.indexOf(current);
  if (i < 0 || i >= order.length - 1) return null;
  return order[i + 1];
}
