'use client';

import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  DollarSign, TrendingUp, Search, RefreshCw, CheckCircle2, XCircle, Loader2,
  Zap, Lightbulb, Target, Trash2, Workflow, Brain, Activity, BarChart3,
  AlertTriangle, Clock, KeyRound, Eye, EyeOff, Copy, ExternalLink, Plus,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid, Cell,
} from 'recharts';
import { useApi, postJson, patchJson, deleteJson } from '@/lib/hooks/use-api';
import { JARVIS, timeAgo } from '@/lib/config';
import { SectionTitle, StatCard, Pill, EmptyState } from '@/components/jarvis/shared';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from '@/components/ui/accordion';

/* ============ Types ============ */
interface EarningMethod {
  id: string;
  key: string;
  name: string;
  description: string;
  category: string;
  earningPotential: string;
  riskLevel: string;
  skillsRequired: string[];
  method: string;
  approved: boolean;
  enabled: boolean;
  autoExecute: boolean;
  estimatedMonthly: number;
  lastResearched: string | null;
  lastExecuted: string | null;
  executionCount: number;
  totalEarnings: number;
  feedback: FeedbackEntry[];
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

interface FeedbackEntry {
  id: string;
  feedback: string;
  improvement?: string;
  createdAt: string;
}

interface Credential {
  id: string;
  platform: string;
  platformUrl: string | null;
  username: string;
  passwordMasked: string;
  passwordRevealed?: string;
  notes: string | null;
  methodKey: string | null;
  status: string;
  registeredAt: string;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface MethodsData {
  methods: EarningMethod[];
  stats: { total: number; approved: number; active: number; estMonthly: number };
}

interface CredsData {
  credentials: Credential[];
  productionKey: boolean;
  count: number;
}

/* ============ Constants ============ */
const CATEGORIES = [
  'all', 'freelance', 'content', 'saas', 'consulting', 'automation',
  'data', 'creative', 'support', 'affiliate', 'general',
];

const POTENTIAL_COLOR: Record<string, string> = {
  low: JARVIS.colors.cyan,
  medium: JARVIS.colors.amber,
  high: JARVIS.colors.green,
};

const RISK_COLOR: Record<string, string> = {
  none: JARVIS.colors.green,
  low: JARVIS.colors.cyan,
  medium: JARVIS.colors.amber,
  high: JARVIS.colors.red,
};

/* ============ Tab ============ */
export default function EarningMethodsTab() {
  const { toast } = useToast();
  const { data, loading, refresh } = useApi<MethodsData>('/api/earning-methods', 15000);
  const { data: credsData, refresh: refreshCreds } = useApi<CredsData>('/api/credentials', 0);

  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [feedbackOpenId, setFeedbackOpenId] = useState<string | null>(null);
  const [feedbackText, setFeedbackText] = useState('');
  const [improvementText, setImprovementText] = useState('');
  const [credDialogOpen, setCredDialogOpen] = useState(false);
  const [revealedCreds, setRevealedCreds] = useState<Record<string, string>>({});
  const [credForm, setCredForm] = useState({
    platform: '', platformUrl: '', username: '', password: '', notes: '', methodKey: '',
  });
  const [busy, setBusy] = useState(false);
  const [researching, setResearching] = useState(false);

  /* ---------- Derived ---------- */
  const filtered = useMemo(() => {
    if (!data?.methods) return [];
    return data.methods.filter((m) => {
      if (category !== 'all' && m.category !== category) return false;
      if (search) {
        const q = search.toLowerCase();
        if (
          !m.name.toLowerCase().includes(q) &&
          !m.description.toLowerCase().includes(q) &&
          !m.skillsRequired.some((s) => s.toLowerCase().includes(q)) &&
          !m.tags.some((t) => t.toLowerCase().includes(q))
        ) return false;
      }
      return true;
    });
  }, [data, search, category]);

  /* ---------- Actions ---------- */
  const toggleField = async (m: EarningMethod, field: 'approved' | 'enabled' | 'autoExecute') => {
    try {
      await patchJson(`/api/earning-methods/${m.id}`, { [field]: !m[field] });
      toast({
        title: `${field} ${!m[field] ? 'enabled' : 'disabled'}`,
        description: m.name,
      });
      refresh();
    } catch (e) {
      toast({
        title: 'Update failed',
        description: e instanceof Error ? e.message : '',
        variant: 'destructive',
      });
    }
  };

  const doDelete = async (m: EarningMethod) => {
    if (!window.confirm(`Delete "${m.name}"? This cannot be undone.`)) return;
    try {
      await deleteJson(`/api/earning-methods/${m.id}`);
      toast({ title: 'Method deleted', description: m.name });
      refresh();
    } catch (e) {
      toast({
        title: 'Delete failed',
        description: e instanceof Error ? e.message : '',
        variant: 'destructive',
      });
    }
  };

  const submitFeedback = async (m: EarningMethod) => {
    if (!feedbackText.trim()) return;
    setBusy(true);
    try {
      await postJson(`/api/earning-methods/${m.id}/feedback`, {
        feedback: feedbackText.trim(),
        improvement: improvementText.trim() || undefined,
      });
      toast({ title: 'Feedback recorded', description: m.name });
      setFeedbackText('');
      setImprovementText('');
      setFeedbackOpenId(null);
      refresh();
    } catch (e) {
      toast({
        title: 'Submit failed',
        description: e instanceof Error ? e.message : '',
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
    }
  };

  const revealCred = async (c: Credential) => {
    if (revealedCreds[c.id]) {
      const next = { ...revealedCreds };
      delete next[c.id];
      setRevealedCreds(next);
      return;
    }
    try {
      const res = await fetch(`/api/credentials/${c.id}?reveal=1`, { cache: 'no-store' });
      const json = await res.json();
      if (json?.credential?.passwordRevealed) {
        setRevealedCreds((s) => ({ ...s, [c.id]: json.credential.passwordRevealed }));
      }
    } catch (e) {
      toast({
        title: 'Reveal failed',
        description: e instanceof Error ? e.message : '',
        variant: 'destructive',
      });
    }
  };

  const copyCred = async (c: Credential) => {
    const pw = revealedCreds[c.id];
    if (!pw) {
      toast({ title: 'Reveal the password first', variant: 'destructive' });
      return;
    }
    try {
      await navigator.clipboard.writeText(pw);
      toast({ title: 'Password copied', description: c.platform });
    } catch {
      toast({ title: 'Clipboard blocked', variant: 'destructive' });
    }
  };

  const touchCred = async (c: Credential) => {
    try {
      await postJson(`/api/credentials/${c.id}`, { action: 'touch' });
      toast({ title: 'Marked as used', description: c.platform });
      refreshCreds();
    } catch (e) {
      toast({
        title: 'Touch failed',
        description: e instanceof Error ? e.message : '',
        variant: 'destructive',
      });
    }
  };

  const deleteCred = async (c: Credential) => {
    if (!window.confirm(`Delete credential for ${c.platform}?`)) return;
    try {
      await deleteJson(`/api/credentials/${c.id}`);
      toast({ title: 'Credential deleted', description: c.platform });
      refreshCreds();
    } catch (e) {
      toast({
        title: 'Delete failed',
        description: e instanceof Error ? e.message : '',
        variant: 'destructive',
      });
    }
  };

  const addCredential = async () => {
    if (!credForm.platform || !credForm.username || !credForm.password) {
      toast({ title: 'Platform, username, password required', variant: 'destructive' });
      return;
    }
    setBusy(true);
    try {
      await postJson('/api/credentials', credForm);
      toast({ title: 'Credential added', description: credForm.platform });
      setCredForm({
        platform: '', platformUrl: '', username: '', password: '', notes: '', methodKey: '',
      });
      setCredDialogOpen(false);
      refreshCreds();
    } catch (e) {
      toast({
        title: 'Add failed',
        description: e instanceof Error ? e.message : '',
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
    }
  };

  /* ---------- Research New (LLM-powered) ---------- */
  const doResearch = async () => {
    setResearching(true);
    try {
      const res = await fetch('/api/earning-methods/research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
      });
      const json = await res.json();
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || `HTTP ${res.status}`);
      }
      const n = Number(json.discovered ?? 0);
      toast({
        title: n > 0 ? `Discovered ${n} new method${n === 1 ? '' : 's'}` : 'No new methods discovered',
        description:
          n > 0
            ? `${(json.methods ?? []).map((m: { name: string }) => m.name).join(' · ')}`
            : `Rejected ${(json.rejected ?? []).length} candidate(s); skipped ${json.skipped ?? 0} duplicate(s).`,
      });
      refresh();
    } catch (e) {
      toast({
        title: 'Research failed',
        description: e instanceof Error ? e.message : '',
        variant: 'destructive',
      });
    } finally {
      setResearching(false);
    }
  };

  /* ---------- Render ---------- */
  const stats = data?.stats;

  return (
    <div className="space-y-4">
      <SectionTitle
        title="Earning Methods"
        icon={DollarSign}
        accent={JARVIS.colors.green}
        action={
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={researching}
              onClick={doResearch}
              className="jarvis-mono text-[10px] uppercase border-[var(--j-border)] text-[var(--j-text-dim)] hover:text-[var(--j-green)]"
              title="Run the LLM research engine to discover 3-5 new earning methods"
            >
              {researching ? (
                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
              ) : (
                <Lightbulb className="h-3 w-3 mr-1" />
              )}
              {researching ? 'Researching…' : 'Research New'}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => { refresh(); refreshCreds(); }}
              className="jarvis-mono text-[10px] uppercase border-[var(--j-border)] text-[var(--j-text-dim)] hover:text-[var(--j-green)]"
            >
              <RefreshCw className="h-3 w-3 mr-1" />
              Refresh
            </Button>
          </div>
        }
      />

      {/* Non-investment notice */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        className="jarvis-panel p-3 flex items-start gap-3"
        style={{ borderColor: `${JARVIS.colors.amber}33`, background: `${JARVIS.colors.amber}0d` }}
      >
        <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" style={{ color: JARVIS.colors.amber }} />
        <div className="text-xs text-[var(--j-text-dim)]">
          <span className="jarvis-mono uppercase text-[var(--j-amber)]">No investment schemes.</span>{' '}
          All methods below are service-based, skill-based, or automation-based revenue streams. No stocks, crypto, forex, or get-rich-quick schemes.
        </div>
      </motion.div>

      {/* Stats cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Total Methods" value={stats?.total ?? 0} icon={Lightbulb} accent={JARVIS.colors.cyan} />
        <StatCard label="Approved" value={stats?.approved ?? 0} icon={CheckCircle2} accent={JARVIS.colors.green} />
        <StatCard label="Active" value={stats?.active ?? 0} icon={Zap} accent={JARVIS.colors.amber} />
        <StatCard
          label="Est. Monthly"
          value={`₹${(stats?.estMonthly ?? 0).toLocaleString()}`}
          icon={TrendingUp}
          accent={JARVIS.colors.violet}
        />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--j-text-mute)]" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search methods, skills, tags…"
            className="pl-8 bg-[var(--j-bg)] border-[var(--j-border)] text-[var(--j-text)] text-xs h-9"
          />
        </div>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="w-[160px] bg-[var(--j-bg)] border-[var(--j-border)] text-[var(--j-text)] text-xs h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-[var(--j-panel)] border-[var(--j-border)] text-[var(--j-text)]">
            {CATEGORIES.map((c) => (
              <SelectItem key={c} value={c} className="text-xs capitalize">{c}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Method cards */}
      {loading && !data ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-[var(--j-green)]" />
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState icon={Lightbulb} message="No earning methods match your filters" />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filtered.map((m) => {
            const isExpanded = expandedId === m.id;
            const steps = m.method.split('\n').filter(Boolean).filter((s) => s.trim().length > 0);
            const potentialColor = POTENTIAL_COLOR[m.earningPotential] || JARVIS.colors.textDim;
            const riskColor = RISK_COLOR[m.riskLevel] || JARVIS.colors.textDim;
            const riskPct = m.riskLevel === 'none' ? 0 : m.riskLevel === 'low' ? 25 : m.riskLevel === 'medium' ? 60 : 95;

            return (
              <motion.div
                key={m.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="jarvis-panel p-4 flex flex-col"
              >
                {/* Header */}
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <DollarSign className="h-3.5 w-3.5 shrink-0" style={{ color: JARVIS.colors.green }} />
                      <h3 className="text-sm font-medium text-[var(--j-text)] truncate">{m.name}</h3>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <Pill color={JARVIS.colors.cyan}>{m.category}</Pill>
                      <Pill color={potentialColor}>{m.earningPotential} potential</Pill>
                      <Pill color={riskColor}>risk: {m.riskLevel}</Pill>
                      <Pill color={JARVIS.colors.violet}>₹{m.estimatedMonthly.toLocaleString()}/mo</Pill>
                    </div>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => toggleField(m, 'approved')}
                      className="h-7 w-7 p-0 border-[var(--j-border)]"
                      title={m.approved ? 'Unapprove' : 'Approve'}
                    >
                      {m.approved ? (
                        <CheckCircle2 className="h-3.5 w-3.5" style={{ color: JARVIS.colors.green }} />
                      ) : (
                        <XCircle className="h-3.5 w-3.5 text-[var(--j-text-mute)]" />
                      )}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => toggleField(m, 'enabled')}
                      className="h-7 w-7 p-0 border-[var(--j-border)]"
                      title={m.enabled ? 'Disable' : 'Enable'}
                    >
                      <Zap className="h-3.5 w-3.5" style={{ color: m.enabled ? JARVIS.colors.amber : JARVIS.colors.textMute }} />
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => doDelete(m)}
                      className="h-7 w-7 p-0 border-[var(--j-border)] hover:text-[var(--j-red)]"
                      title="Delete"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>

                {/* Description */}
                <p className="text-xs text-[var(--j-text-dim)] mb-3 line-clamp-2">{m.description}</p>

                {/* Skills */}
                {m.skillsRequired.length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-3">
                    {m.skillsRequired.map((s) => (
                      <span
                        key={s}
                        className="jarvis-mono text-[9px] uppercase px-1.5 py-0.5 rounded"
                        style={{ color: JARVIS.colors.cyan, background: `${JARVIS.colors.cyan}1a`, border: `1px solid ${JARVIS.colors.cyan}33` }}
                      >
                        {s}
                      </span>
                    ))}
                  </div>
                )}

                {/* Expandable details */}
                <Accordion type="single" collapsible className="flex-1">
                  <AccordionItem value="details" className="border-0">
                    <AccordionTrigger
                      className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)] py-2 hover:no-underline"
                      onClick={() => setExpandedId(isExpanded ? null : m.id)}
                    >
                      <span className="flex items-center gap-1.5">
                        <Workflow className="h-3 w-3" />
                        Workflow & Intelligence
                      </span>
                    </AccordionTrigger>
                    <AccordionContent className="pt-2 space-y-3">
                      {/* Workflow timeline */}
                      {steps.length > 0 && (
                        <div>
                          <div className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)] mb-2 flex items-center gap-1">
                            <Workflow className="h-3 w-3" />
                            Workflow
                          </div>
                          <ol className="space-y-1.5">
                            {steps.map((step, i) => (
                              <li key={i} className="flex gap-2 text-xs">
                                <span
                                  className="jarvis-mono text-[9px] shrink-0 w-5 h-5 rounded flex items-center justify-center"
                                  style={{
                                    color: JARVIS.colors.cyan,
                                    background: `${JARVIS.colors.cyan}1a`,
                                    border: `1px solid ${JARVIS.colors.cyan}33`,
                                  }}
                                >
                                  {i + 1}
                                </span>
                                <span className="text-[var(--j-text-dim)]">{step.replace(/^\d+\.\s*/, '').replace(/^-\s*/, '')}</span>
                              </li>
                            ))}
                          </ol>
                        </div>
                      )}

                      {/* Intelligence bar chart */}
                      <div>
                        <div className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)] mb-2 flex items-center gap-1">
                          <BarChart3 className="h-3 w-3" />
                          Intelligence
                        </div>
                        <div className="h-[120px]">
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart
                              data={[
                                { name: 'Est ₹/mo', value: m.estimatedMonthly, color: JARVIS.colors.green },
                                { name: 'Earned', value: Math.round(m.totalEarnings), color: JARVIS.colors.amber },
                                { name: 'Runs', value: m.executionCount, color: JARVIS.colors.violet },
                              ]}
                              margin={{ top: 4, right: 4, bottom: 0, left: -20 }}
                            >
                              <CartesianGrid strokeDasharray="3 3" stroke="#1B2330" />
                              <XAxis dataKey="name" tick={{ fill: '#94A3B8', fontSize: 9 }} axisLine={{ stroke: '#1B2330' }} tickLine={false} />
                              <YAxis tick={{ fill: '#94A3B8', fontSize: 9 }} axisLine={{ stroke: '#1B2330' }} tickLine={false} />
                              <Tooltip
                                contentStyle={{
                                  background: '#0E1218',
                                  border: '1px solid #1B2330',
                                  borderRadius: 6,
                                  fontSize: 11,
                                }}
                                labelStyle={{ color: '#E2E8F0' }}
                              />
                              <Bar dataKey="value" radius={[3, 3, 0, 0]}>
                                {[
                                  { name: 'Est ₹/mo', value: m.estimatedMonthly, color: JARVIS.colors.green },
                                  { name: 'Earned', value: Math.round(m.totalEarnings), color: JARVIS.colors.amber },
                                  { name: 'Runs', value: m.executionCount, color: JARVIS.colors.violet },
                                ].map((entry, idx) => (
                                  <Cell key={idx} fill={entry.color} />
                                ))}
                              </Bar>
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      </div>

                      {/* Risk meter */}
                      <div>
                        <div className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)] mb-1 flex items-center gap-1">
                          <AlertTriangle className="h-3 w-3" />
                          Risk Meter
                        </div>
                        <div className="h-2 rounded-full bg-[var(--j-bg)] overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all"
                            style={{
                              width: `${riskPct}%`,
                              background: `linear-gradient(90deg, ${JARVIS.colors.green}, ${riskColor})`,
                            }}
                          />
                        </div>
                        <div className="text-[10px] text-[var(--j-text-mute)] mt-1">
                          {m.riskLevel === 'none' ? 'No risk identified' : `${m.riskLevel} risk — proceed with due diligence`}
                        </div>
                      </div>

                      {/* Memory feedback */}
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <div className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)] flex items-center gap-1">
                            <Brain className="h-3 w-3" />
                            Memory Feedback
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setFeedbackOpenId(feedbackOpenId === m.id ? null : m.id);
                              setFeedbackText('');
                              setImprovementText('');
                            }}
                            className="h-6 px-2 text-[10px] jarvis-mono uppercase border-[var(--j-border)]"
                          >
                            <Plus className="h-3 w-3 mr-1" />
                            Add
                          </Button>
                        </div>
                        {feedbackOpenId === m.id && (
                          <div className="space-y-2 mb-2 p-2 rounded border border-[var(--j-border)] bg-[var(--j-bg)]">
                            <Textarea
                              value={feedbackText}
                              onChange={(e) => setFeedbackText(e.target.value)}
                              placeholder="What worked? What didn't?"
                              className="bg-[var(--j-panel)] border-[var(--j-border)] text-[var(--j-text)] text-xs min-h-[60px]"
                            />
                            <Input
                              value={improvementText}
                              onChange={(e) => setImprovementText(e.target.value)}
                              placeholder="Suggested improvement (optional)"
                              className="bg-[var(--j-panel)] border-[var(--j-border)] text-[var(--j-text)] text-xs"
                            />
                            <Button
                              size="sm"
                              onClick={() => submitFeedback(m)}
                              disabled={busy || !feedbackText.trim()}
                              className="jarvis-btn-accent border-0 h-7 text-xs"
                            >
                              {busy ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : null}
                              Submit
                            </Button>
                          </div>
                        )}
                        {m.feedback.length === 0 ? (
                          <div className="text-[10px] text-[var(--j-text-mute)] italic">No feedback recorded yet.</div>
                        ) : (
                          <div className="space-y-1.5 max-h-32 overflow-y-auto jarvis-scroll">
                            {m.feedback.slice(0, 5).map((f) => (
                              <div
                                key={f.id}
                                className="p-2 rounded border border-[var(--j-border)] bg-[var(--j-bg)]"
                              >
                                <div className="text-xs text-[var(--j-text)]">{f.feedback}</div>
                                {f.improvement && (
                                  <div className="text-[10px] text-[var(--j-green)] mt-1">
                                    → {f.improvement}
                                  </div>
                                )}
                                <div className="text-[9px] jarvis-mono text-[var(--j-text-mute)] mt-1">
                                  {timeAgo(f.createdAt)}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Stats footer */}
                      <div className="flex flex-wrap gap-3 pt-2 border-t border-[var(--j-border)]">
                        <div className="text-[10px] jarvis-mono text-[var(--j-text-mute)] flex items-center gap-1">
                          <Activity className="h-3 w-3" />
                          {m.executionCount} runs
                        </div>
                        <div className="text-[10px] jarvis-mono text-[var(--j-text-mute)] flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {m.lastExecuted ? `last: ${timeAgo(m.lastExecuted)}` : 'never run'}
                        </div>
                        <div className="text-[10px] jarvis-mono text-[var(--j-text-mute)] flex items-center gap-1">
                          <Target className="h-3 w-3" />
                          ₹{m.totalEarnings.toLocaleString()} earned
                        </div>
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* ============ Credential Vault ============ */}
      <div className="jarvis-panel p-4 mt-6">
        <SectionTitle
          title="Platform Credentials"
          icon={KeyRound}
          accent={JARVIS.colors.amber}
          action={
            <Button
              size="sm"
              onClick={() => setCredDialogOpen(true)}
              className="jarvis-btn-accent border-0"
            >
              <Plus className="h-3 w-3 mr-1" />
              Add Credential
            </Button>
          }
        />

        <div className="flex items-center gap-2 mb-3">
          <Pill color={credsData?.productionKey ? JARVIS.colors.green : JARVIS.colors.amber}>
            {credsData?.productionKey ? 'AES-256-GCM · prod key' : 'AES-256-GCM · dev fallback'}
          </Pill>
          <Pill color={JARVIS.colors.cyan}>{credsData?.count ?? 0} stored</Pill>
        </div>

        {!credsData || credsData.credentials.length === 0 ? (
          <EmptyState icon={KeyRound} message="No credentials stored yet" />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[480px] overflow-y-auto jarvis-scroll pr-1">
            {credsData.credentials.map((c) => {
              const revealed = revealedCreds[c.id];
              return (
                <motion.div
                  key={c.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="jarvis-panel p-3"
                  style={{ borderColor: `${JARVIS.colors.amber}33` }}
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <KeyRound className="h-3 w-3 shrink-0" style={{ color: JARVIS.colors.amber }} />
                        <span className="text-sm font-medium text-[var(--j-text)] truncate">{c.platform}</span>
                      </div>
                      <div className="text-xs text-[var(--j-text-dim)] mt-0.5 truncate">
                        {c.username}
                        {c.platformUrl && (
                          <a
                            href={c.platformUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="ml-1.5 inline-flex items-center gap-0.5 text-[var(--j-cyan)] hover:underline"
                          >
                            <ExternalLink className="h-2.5 w-2.5" />
                          </a>
                        )}
                      </div>
                    </div>
                    <Pill color={c.status === 'active' ? JARVIS.colors.green : JARVIS.colors.textMute}>
                      {c.status}
                    </Pill>
                  </div>

                  <div className="flex items-center gap-2 mb-2">
                    <code className="text-xs jarvis-mono px-2 py-1 rounded bg-[var(--j-bg)] border border-[var(--j-border)] text-[var(--j-text-dim)] flex-1 truncate">
                      {revealed ? revealed : c.passwordMasked}
                    </code>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => revealCred(c)}
                      className="h-7 w-7 p-0 border-[var(--j-border)]"
                      title={revealed ? 'Hide' : 'Reveal'}
                    >
                      {revealed ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => copyCred(c)}
                      className="h-7 w-7 p-0 border-[var(--j-border)]"
                      title="Copy"
                    >
                      <Copy className="h-3 w-3" />
                    </Button>
                  </div>

                  {c.notes && (
                    <div className="text-[10px] text-[var(--j-text-mute)] italic mb-2 line-clamp-2">
                      {c.notes}
                    </div>
                  )}

                  <div className="flex items-center justify-between">
                    <div className="text-[9px] jarvis-mono text-[var(--j-text-mute)]">
                      {c.lastUsedAt ? `used: ${timeAgo(c.lastUsedAt)}` : 'never used'}
                    </div>
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => touchCred(c)}
                        className="h-6 px-2 text-[10px] jarvis-mono uppercase border-[var(--j-border)]"
                      >
                        <Clock className="h-3 w-3 mr-1" />
                        Touch
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => deleteCred(c)}
                        className="h-6 w-6 p-0 border-[var(--j-border)] hover:text-[var(--j-red)]"
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>

      {/* Credential dialog */}
      <Dialog open={credDialogOpen} onOpenChange={setCredDialogOpen}>
        <DialogContent className="bg-[var(--j-panel)] border-[var(--j-border)] text-[var(--j-text)]">
          <DialogHeader>
            <DialogTitle className="jarvis-mono text-sm uppercase tracking-widest text-[var(--j-amber)]">
              Add Platform Credential
            </DialogTitle>
            <DialogDescription className="text-[var(--j-text-dim)] text-xs">
              Password is encrypted with AES-256-GCM before storage. Never stored in plaintext.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-[10px] uppercase jarvis-mono text-[var(--j-text-mute)]">Platform *</Label>
                <Input
                  value={credForm.platform}
                  onChange={(e) => setCredForm({ ...credForm, platform: e.target.value })}
                  placeholder="Upwork, Fiverr, AWS…"
                  className="bg-[var(--j-bg)] border-[var(--j-border)] text-[var(--j-text)] text-xs"
                />
              </div>
              <div>
                <Label className="text-[10px] uppercase jarvis-mono text-[var(--j-text-mute)]">Method Key</Label>
                <Input
                  value={credForm.methodKey}
                  onChange={(e) => setCredForm({ ...credForm, methodKey: e.target.value })}
                  placeholder="link to earning method"
                  className="bg-[var(--j-bg)] border-[var(--j-border)] text-[var(--j-text)] text-xs"
                />
              </div>
            </div>
            <div>
              <Label className="text-[10px] uppercase jarvis-mono text-[var(--j-text-mute)]">Platform URL</Label>
              <Input
                value={credForm.platformUrl}
                onChange={(e) => setCredForm({ ...credForm, platformUrl: e.target.value })}
                placeholder="https://…"
                className="bg-[var(--j-bg)] border-[var(--j-border)] text-[var(--j-text)] text-xs"
              />
            </div>
            <div>
              <Label className="text-[10px] uppercase jarvis-mono text-[var(--j-text-mute)]">Username *</Label>
              <Input
                value={credForm.username}
                onChange={(e) => setCredForm({ ...credForm, username: e.target.value })}
                placeholder="email or handle"
                className="bg-[var(--j-bg)] border-[var(--j-border)] text-[var(--j-text)] text-xs"
              />
            </div>
            <div>
              <Label className="text-[10px] uppercase jarvis-mono text-[var(--j-text-mute)]">Password *</Label>
              <Input
                type="password"
                value={credForm.password}
                onChange={(e) => setCredForm({ ...credForm, password: e.target.value })}
                placeholder="will be encrypted on save"
                className="bg-[var(--j-bg)] border-[var(--j-border)] text-[var(--j-text)] text-xs"
              />
            </div>
            <div>
              <Label className="text-[10px] uppercase jarvis-mono text-[var(--j-text-mute)]">Notes</Label>
              <Textarea
                value={credForm.notes}
                onChange={(e) => setCredForm({ ...credForm, notes: e.target.value })}
                placeholder="2FA backup, recovery codes, etc."
                className="bg-[var(--j-bg)] border-[var(--j-border)] text-[var(--j-text)] text-xs min-h-[50px]"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCredDialogOpen(false)} className="border-[var(--j-border)] text-[var(--j-text-dim)]">
              Cancel
            </Button>
            <Button onClick={addCredential} disabled={busy} className="jarvis-btn-accent border-0">
              {busy ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <KeyRound className="h-3 w-3 mr-1" />}
              Encrypt & Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AnimatePresence>
        {loading && data && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed bottom-4 right-4 jarvis-panel px-3 py-2 flex items-center gap-2 z-40"
          >
            <RefreshCw className="h-3 w-3 animate-spin text-[var(--j-green)]" />
            <span className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">syncing…</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
