'use client';

import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Cpu,
  Boxes,
  Zap,
  Eye,
  Microscope,
  Brain,
  RefreshCw,
  HardDrive,
  Stethoscope,
  Trash2,
  Key,
  CheckCircle2,
  XCircle,
  Clock,
  Activity,
  Sparkles,
  Server,
  AlertTriangle,
  Loader2,
} from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RTooltip } from 'recharts';
import { useApi, postJson, patchJson, deleteJson } from '@/lib/hooks/use-api';
import { JARVIS, timeAgo } from '@/lib/config';
import { SectionTitle, StatCard, EmptyState, Pill } from '@/components/jarvis/shared';
import { useToast } from '@/hooks/use-toast';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

// ─── Types ────────────────────────────────────────────────────────────

interface ModelEntry {
  id: string;
  providerKey: string;
  modelId: string;
  contextWindow: number;
  capabilities: string;
  tier: string;
  enabled: boolean;
  source?: string;
  status?: string;
  lastChecked?: string | null;
  pricingPer1k?: number | null;
  latencyMs?: number | null;
  updatedAt?: string;
}

interface ProviderEntry {
  id: string;
  key: string;
  name: string;
  model: string;
  enabled: boolean;
  latency: number;
  tokens: number;
  hasKey: boolean;
  createdAt: string;
  updatedAt: string;
}

interface StatusSummary {
  total: number;
  active: number;
  broken: number;
  rateLimited: number;
  unknown: number;
  local: number;
  providerSourced: number;
  seed: number;
  byProvider: Array<{
    providerKey: string;
    total: number;
    active: number;
    broken: number;
    rateLimited: number;
    lastChecked: string | null;
    hasKey: boolean;
  }>;
  lastSyncAt: string | null;
}

interface ActivityEvent {
  id: string;
  ts: string;
  kind: 'sync' | 'health-check' | 'purge' | 'local' | 'sync-all';
  target?: string;
  message: string;
  severity: 'info' | 'success' | 'warn' | 'error';
}

// ─── Design tokens ────────────────────────────────────────────────────

const TIER_COLOR: Record<string, string> = {
  local: JARVIS.colors.textMute,
  fast: JARVIS.colors.cyan,
  strong: JARVIS.colors.violet,
  vision: JARVIS.colors.amber,
  giant: JARVIS.colors.green,
};

const TIER_ICON: Record<string, typeof Cpu> = {
  local: HardDrive,
  fast: Zap,
  strong: Brain,
  vision: Eye,
  giant: Microscope,
};

const STATUS_COLOR: Record<string, string> = {
  active: JARVIS.colors.green,
  broken: JARVIS.colors.red,
  'rate-limited': JARVIS.colors.amber,
  unknown: JARVIS.colors.textMute,
};

const STATUS_LABEL: Record<string, string> = {
  active: 'ACTIVE',
  broken: 'BROKEN',
  'rate-limited': 'RATE-LIMITED',
  unknown: 'UNKNOWN',
};

const SOURCE_COLOR: Record<string, string> = {
  seed: JARVIS.colors.textMute,
  provider: JARVIS.colors.cyan,
  local: JARVIS.colors.violet,
};

const PROVIDER_ACCENT: Record<string, string> = {
  openai: JARVIS.colors.green,
  anthropic: JARVIS.colors.violet,
  groq: JARVIS.colors.amber,
  mistral: JARVIS.colors.cyan,
  cohere: JARVIS.colors.red,
  together: JARVIS.colors.green,
  openrouter: JARVIS.colors.amber,
  deepseek: JARVIS.colors.violet,
  zai: JARVIS.colors.cyan,
  google: JARVIS.colors.red,
  local: JARVIS.colors.textMute,
};

const TIERS = ['all', 'fast', 'strong', 'vision', 'giant', 'local'] as const;
const STATUS_FILTERS = ['all', 'active', 'broken', 'rate-limited', 'local', 'provider-sourced'] as const;

type StatusFilter = (typeof STATUS_FILTERS)[number];
type TierFilter = (typeof TIERS)[number];

// ─── Main component ───────────────────────────────────────────────────

export default function ModelsTab() {
  const { toast } = useToast();
  const [tier, setTier] = useState<TierFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [busy, setBusy] = useState<string | null>(null);
  const [detailModel, setDetailModel] = useState<ModelEntry | null>(null);
  const [purgeOpen, setPurgeOpen] = useState(false);
  const [keyDialogProvider, setKeyDialogProvider] = useState<ProviderEntry | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState('');

  // ─── Data: models + providers + status summary + activity ───
  const modelsApi = useApi<{ models: ModelEntry[]; byProvider: Record<string, ModelEntry[]>; providers: string[] }>(
    `/api/models?tier=${tier === 'all' ? '' : tier}`,
    30000,
  );
  const providersApi = useApi<{ providers: ProviderEntry[] }>(`/api/providers`, 30000);
  const statusApi = useApi<{ ok: boolean; summary: StatusSummary; activity: ActivityEvent[] }>(
    `/api/models/sync`,
    30000,
  );

  const models = modelsApi.data?.models ?? [];
  const byProvider = modelsApi.data?.byProvider ?? {};
  const providerKeys = modelsApi.data?.providers ?? [];
  const providers = providersApi.data?.providers ?? [];
  const summary = statusApi.data?.summary;
  const activity = statusApi.data?.activity ?? [];

  const providerMap = useMemo(() => {
    const m = new Map<string, ProviderEntry>();
    for (const p of providers) m.set(p.key, p);
    return m;
  }, [providers]);

  // ─── Apply status filter to model list ───
  const filteredModels = useMemo(() => {
    if (statusFilter === 'all') return models;
    return models.filter((m) => {
      if (statusFilter === 'active') return m.status === 'active';
      if (statusFilter === 'broken') return m.status === 'broken';
      if (statusFilter === 'rate-limited') return m.status === 'rate-limited';
      if (statusFilter === 'local') return m.source === 'local';
      if (statusFilter === 'provider-sourced') return m.source === 'provider';
      return true;
    });
  }, [models, statusFilter]);

  const filteredByProvider = useMemo(() => {
    const m: Record<string, ModelEntry[]> = {};
    for (const mod of filteredModels) {
      if (!m[mod.providerKey]) m[mod.providerKey] = [];
      m[mod.providerKey].push(mod);
    }
    return m;
  }, [filteredModels]);

  // ─── Pie chart data ───
  const pieData = useMemo(() => {
    if (!summary) return [];
    return [
      { name: 'Active', value: summary.active, color: STATUS_COLOR.active },
      { name: 'Broken', value: summary.broken, color: STATUS_COLOR.broken },
      { name: 'Rate-Limited', value: summary.rateLimited, color: STATUS_COLOR['rate-limited'] },
      { name: 'Unknown', value: summary.unknown, color: STATUS_COLOR.unknown },
    ].filter((d) => d.value > 0);
  }, [summary]);

  // ─── Actions ───
  async function runSyncAll() {
    setBusy('sync-all');
    try {
      const r = await postJson<{ ok: boolean; report?: { totalAdded: number; totalBroken: number; durationMs: number }; error?: string }>(
        `/api/models/sync`,
        {},
      );
      toast({
        title: r.ok ? 'Sync Complete' : 'Sync Failed',
        description: r.ok
          ? `Added ${r.report?.totalAdded ?? 0}, marked broken ${r.report?.totalBroken ?? 0} (${r.report?.durationMs ?? 0}ms)`
          : r.error ?? 'Unknown error',
      });
      modelsApi.refresh();
      providersApi.refresh();
      statusApi.refresh();
    } catch (e) {
      toast({ title: 'Sync Error', description: e instanceof Error ? e.message : String(e), variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  }

  async function runLocalDetect() {
    setBusy('local');
    try {
      const r = await postJson<{ ok: boolean; local?: { added: { modelId: string }[]; updated: { modelId: string }[]; error?: string }; error?: string }>(
        `/api/models/sync`,
        { providerKey: 'local' },
      );
      toast({
        title: r.ok ? 'Local Detect Complete' : 'Local Detect Issue',
        description: r.ok
          ? `Ollama: added ${r.local?.added.length ?? 0}, refreshed ${r.local?.updated.length ?? 0}${r.local?.error ? ` — ${r.local.error}` : ''}`
          : r.local?.error ?? r.error ?? 'Unknown error',
      });
      modelsApi.refresh();
      statusApi.refresh();
    } catch (e) {
      toast({ title: 'Local Detect Error', description: e instanceof Error ? e.message : String(e), variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  }

  async function runHealthCheckSample() {
    setBusy('health');
    try {
      const r = await postJson<{ ok: boolean; results?: { status: string }[]; error?: string }>(`/api/models/health-check`, {});
      const stats = (r.results ?? []).reduce<Record<string, number>>((acc, x) => {
        acc[x.status] = (acc[x.status] ?? 0) + 1;
        return acc;
      }, {});
      toast({
        title: r.ok ? 'Health Check Complete' : 'Health Check Failed',
        description: r.ok
          ? `Sampled ${r.results?.length ?? 0}: ${stats.active ?? 0} active, ${stats['rate-limited'] ?? 0} rate-limited, ${stats.broken ?? 0} broken`
          : r.error ?? 'Unknown error',
      });
      modelsApi.refresh();
      statusApi.refresh();
    } catch (e) {
      toast({ title: 'Health Check Error', description: e instanceof Error ? e.message : String(e), variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  }

  async function runPurge() {
    setBusy('purge');
    setPurgeOpen(false);
    try {
      const r = await postJson<{ ok: boolean; deleted: number; remaining: number; error?: string }>(`/api/models/purge`, {});
      toast({
        title: r.ok ? 'Purge Complete' : 'Purge Failed',
        description: r.ok ? `Deleted ${r.deleted} broken models; ${r.remaining} remain` : r.error ?? 'Unknown error',
      });
      modelsApi.refresh();
      statusApi.refresh();
    } catch (e) {
      toast({ title: 'Purge Error', description: e instanceof Error ? e.message : String(e), variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  }

  async function syncOneProvider(providerKey: string) {
    setBusy(`sync-${providerKey}`);
    try {
      const r = await postJson<{ ok: boolean; result?: { added: { modelId: string }[]; broken: { modelId: string }[]; error?: string }; error?: string }>(
        `/api/models/sync`,
        { providerKey },
      );
      toast({
        title: r.ok ? `${providerKey} Synced` : `${providerKey} Sync Issue`,
        description: r.ok
          ? `Added ${r.result?.added.length ?? 0}, marked broken ${r.result?.broken.length ?? 0}${r.result?.error ? ` — ${r.result.error}` : ''}`
          : r.result?.error ?? r.error ?? 'Unknown error',
      });
      modelsApi.refresh();
      statusApi.refresh();
    } catch (e) {
      toast({ title: 'Sync Error', description: e instanceof Error ? e.message : String(e), variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  }

  async function testProviderKey(provider: ProviderEntry) {
    setBusy(`test-${provider.key}`);
    try {
      const r = await postJson<{ ok: boolean; modelCount?: number; error?: string; note?: string }>(
        `/api/providers/${provider.id}/test`,
        {},
      );
      toast({
        title: r.ok ? `${provider.name} Key OK` : `${provider.name} Key Test Failed`,
        description: r.ok
          ? `Connected — ${r.modelCount ?? 0} models reachable${r.note ? ` (${r.note})` : ''}`
          : r.error ?? 'Unknown error',
        variant: r.ok ? 'default' : 'destructive',
      });
    } catch (e) {
      toast({ title: 'Test Error', description: e instanceof Error ? e.message : String(e), variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  }

  async function toggleProviderEnabled(provider: ProviderEntry, next: boolean) {
    try {
      await patchJson(`/api/providers/${provider.id}`, { enabled: next });
      toast({ title: `${provider.name} ${next ? 'enabled' : 'disabled'}` });
      providersApi.refresh();
    } catch (e) {
      toast({ title: 'Toggle Failed', description: e instanceof Error ? e.message : String(e), variant: 'destructive' });
    }
  }

  async function saveApiKey() {
    if (!keyDialogProvider) return;
    if (!apiKeyInput.trim()) {
      toast({ title: 'API key cannot be empty', variant: 'destructive' });
      return;
    }
    setBusy('save-key');
    try {
      await patchJson(`/api/providers/${keyDialogProvider.id}`, { apiKey: apiKeyInput.trim() });
      toast({ title: `${keyDialogProvider.name} API key stored (encrypted)` });
      setKeyDialogProvider(null);
      setApiKeyInput('');
      providersApi.refresh();
    } catch (e) {
      toast({ title: 'Save Failed', description: e instanceof Error ? e.message : String(e), variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  }

  async function clearApiKey(provider: ProviderEntry) {
    try {
      await patchJson(`/api/providers/${provider.id}`, { apiKey: null });
      toast({ title: `${provider.name} API key cleared` });
      providersApi.refresh();
    } catch (e) {
      toast({ title: 'Clear Failed', description: e instanceof Error ? e.message : String(e), variant: 'destructive' });
    }
  }

  async function toggleModelEnabled(model: ModelEntry, next: boolean) {
    try {
      await patchJson(`/api/models/${model.id}`, { enabled: next });
      toast({ title: `${model.modelId} ${next ? 'enabled' : 'disabled'}` });
      modelsApi.refresh();
      setDetailModel((m) => (m && m.id === model.id ? { ...m, enabled: next } : m));
    } catch (e) {
      toast({ title: 'Toggle Failed', description: e instanceof Error ? e.message : String(e), variant: 'destructive' });
    }
  }

  async function runHealthCheckOne(model: ModelEntry) {
    setBusy(`hc-${model.id}`);
    try {
      const r = await postJson<{ ok: boolean; results?: { status: string; latencyMs: number | null; error?: string }[]; error?: string }>(
        `/api/models/health-check`,
        { modelId: model.modelId, providerKey: model.providerKey },
      );
      const res = r.results?.[0];
      toast({
        title: r.ok ? `${model.modelId}: ${res?.status?.toUpperCase()}` : 'Health Check Failed',
        description: r.ok
          ? `${res?.latencyMs != null ? `${res.latencyMs}ms` : 'no latency'}${res?.error ? ` — ${res.error}` : ''}`
          : r.error ?? 'Unknown error',
        variant: res?.status === 'broken' ? 'destructive' : 'default',
      });
      modelsApi.refresh();
      statusApi.refresh();
      setDetailModel((m) => (m && m.id === model.id ? { ...m, status: res?.status, latencyMs: res?.latencyMs, lastChecked: new Date().toISOString() } : m));
    } catch (e) {
      toast({ title: 'Health Check Error', description: e instanceof Error ? e.message : String(e), variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  }

  async function deleteModel(model: ModelEntry) {
    try {
      await deleteJson(`/api/models/${model.id}`);
      toast({ title: `${model.modelId} deleted` });
      setDetailModel(null);
      modelsApi.refresh();
      statusApi.refresh();
    } catch (e) {
      toast({ title: 'Delete Failed', description: e instanceof Error ? e.message : String(e), variant: 'destructive' });
    }
  }

  // ─── Render ───
  const enabledCount = models.filter((m) => m.enabled).length;
  const lastSyncText = summary?.lastSyncAt ? timeAgo(summary.lastSyncAt) : 'never';

  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <SectionTitle title="Model Catalog" icon={Cpu} accent={JARVIS.colors.cyan} />
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            onClick={runSyncAll}
            disabled={busy !== null}
            className="jarvis-btn-accent gap-1.5"
          >
            {busy === 'sync-all' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Sync All Providers
          </Button>
          <Button
            size="sm"
            onClick={runLocalDetect}
            disabled={busy !== null}
            variant="outline"
            className="gap-1.5 border-[var(--j-border)] bg-[var(--j-panel)] hover:bg-[var(--j-panel-soft)]"
          >
            {busy === 'local' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <HardDrive className="h-3.5 w-3.5" />}
            Detect Local (Ollama)
          </Button>
          <Button
            size="sm"
            onClick={runHealthCheckSample}
            disabled={busy !== null}
            variant="outline"
            className="gap-1.5 border-[var(--j-border)] bg-[var(--j-panel)] hover:bg-[var(--j-panel-soft)]"
          >
            {busy === 'health' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Stethoscope className="h-3.5 w-3.5" />}
            Health Check Sample
          </Button>
          <Button
            size="sm"
            onClick={() => setPurgeOpen(true)}
            disabled={busy !== null || (summary?.broken ?? 0) === 0}
            variant="outline"
            className="gap-1.5 border-[var(--j-red)]/40 text-[var(--j-red)] hover:bg-[var(--j-red)]/10"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Purge Broken ({summary?.broken ?? 0})
          </Button>
        </div>
      </div>

      {/* ─── Sync status banner ─── */}
      <div className="jarvis-panel p-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs">
        <div className="flex items-center gap-2">
          <Clock className="h-3.5 w-3.5 text-[var(--j-text-mute)]" />
          <span className="text-[var(--j-text-mute)]">Last sync:</span>
          <span className="jarvis-mono text-[var(--j-text)]">{lastSyncText}</span>
        </div>
        <div className="flex items-center gap-2">
          <Sparkles className="h-3.5 w-3.5" style={{ color: JARVIS.colors.green }} />
          <span className="text-[var(--j-text-mute)]">Active:</span>
          <span className="jarvis-mono" style={{ color: JARVIS.colors.green }}>{summary?.active ?? 0}</span>
        </div>
        <div className="flex items-center gap-2">
          <XCircle className="h-3.5 w-3.5" style={{ color: JARVIS.colors.red }} />
          <span className="text-[var(--j-text-mute)]">Broken:</span>
          <span className="jarvis-mono" style={{ color: JARVIS.colors.red }}>{summary?.broken ?? 0}</span>
        </div>
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-3.5 w-3.5" style={{ color: JARVIS.colors.amber }} />
          <span className="text-[var(--j-text-mute)]">Rate-limited (kept):</span>
          <span className="jarvis-mono" style={{ color: JARVIS.colors.amber }}>{summary?.rateLimited ?? 0}</span>
        </div>
        <div className="flex items-center gap-2 ml-auto">
          <Activity className="h-3.5 w-3.5 text-[var(--j-text-mute)]" />
          <span className="text-[var(--j-text-mute)]">Auto-refresh 30s</span>
        </div>
      </div>

      {/* ─── Stat cards row ─── */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <FilterStatCard
          label="Total"
          value={summary?.total ?? models.length}
          color={JARVIS.colors.cyan}
          icon={Cpu}
          active={statusFilter === 'all'}
          onClick={() => setStatusFilter('all')}
        />
        <FilterStatCard
          label="Active"
          value={summary?.active ?? 0}
          color={JARVIS.colors.green}
          icon={CheckCircle2}
          active={statusFilter === 'active'}
          onClick={() => setStatusFilter('active')}
        />
        <FilterStatCard
          label="Broken"
          value={summary?.broken ?? 0}
          color={JARVIS.colors.red}
          icon={XCircle}
          active={statusFilter === 'broken'}
          onClick={() => setStatusFilter('broken')}
        />
        <FilterStatCard
          label="Rate-Limited"
          value={summary?.rateLimited ?? 0}
          color={JARVIS.colors.amber}
          icon={AlertTriangle}
          active={statusFilter === 'rate-limited'}
          onClick={() => setStatusFilter('rate-limited')}
        />
        <FilterStatCard
          label="Local (Ollama)"
          value={summary?.local ?? 0}
          color={JARVIS.colors.violet}
          icon={HardDrive}
          active={statusFilter === 'local'}
          onClick={() => setStatusFilter('local')}
        />
        <FilterStatCard
          label="Provider-Sourced"
          value={summary?.providerSourced ?? 0}
          color={JARVIS.colors.cyan}
          icon={Server}
          active={statusFilter === 'provider-sourced'}
          onClick={() => setStatusFilter('provider-sourced')}
        />
      </div>

      {/* ─── Status pie + filter chips ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="jarvis-panel p-4 lg:col-span-1">
          <div className="flex items-center justify-between mb-3">
            <span className="jarvis-mono text-xs uppercase tracking-widest text-[var(--j-text)]">Status Distribution</span>
            <span className="jarvis-mono text-[10px] text-[var(--j-text-mute)]">{summary?.total ?? 0} total</span>
          </div>
          {pieData.length === 0 ? (
            <div className="h-[180px] flex items-center justify-center text-xs text-[var(--j-text-mute)]">No data</div>
          ) : (
            <div className="h-[180px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={42} outerRadius={72} paddingAngle={2}>
                    {pieData.map((d) => (
                      <Cell key={d.name} fill={d.color} stroke="transparent" />
                    ))}
                  </Pie>
                  <RTooltip
                    contentStyle={{
                      background: 'var(--j-panel)',
                      border: '1px solid var(--j-border)',
                      borderRadius: 6,
                      fontSize: 11,
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
          <div className="flex flex-wrap gap-2 mt-2">
            {pieData.map((d) => (
              <div key={d.name} className="flex items-center gap-1.5 text-[10px] jarvis-mono">
                <span className="h-2 w-2 rounded-sm" style={{ background: d.color }} />
                <span className="text-[var(--j-text-mute)]">{d.name}</span>
                <span className="text-[var(--j-text)]">{d.value}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="jarvis-panel p-4 lg:col-span-2 space-y-3">
          <div>
            <div className="jarvis-mono text-[10px] uppercase tracking-widest text-[var(--j-text-mute)] mb-2">Status Filter</div>
            <div className="flex flex-wrap gap-2">
              {STATUS_FILTERS.map((s) => (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  className={`jarvis-mono text-[10px] uppercase px-3 py-1.5 rounded-md border transition-colors ${statusFilter === s ? 'jarvis-btn-accent border-0' : 'border-[var(--j-border)] text-[var(--j-text-dim)] hover:text-[var(--j-text)]'}`}
                >
                  {s.replace('-', ' ')}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="jarvis-mono text-[10px] uppercase tracking-widest text-[var(--j-text-mute)] mb-2">Tier Filter</div>
            <div className="flex flex-wrap gap-2">
              {TIERS.map((t) => (
                <button
                  key={t}
                  onClick={() => setTier(t)}
                  className={`jarvis-mono text-[10px] uppercase px-3 py-1.5 rounded-md border transition-colors ${tier === t ? 'jarvis-btn-accent border-0' : 'border-[var(--j-border)] text-[var(--j-text-dim)] hover:text-[var(--j-text)]'}`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-between pt-2 border-t border-[var(--j-border-soft)]">
            <span className="text-[10px] text-[var(--j-text-mute)]">
              Showing <span className="jarvis-mono text-[var(--j-text)]">{filteredModels.length}</span> of <span className="jarvis-mono text-[var(--j-text)]">{models.length}</span> models
            </span>
            <span className="text-[10px] text-[var(--j-text-mute)]">
              <span className="jarvis-mono text-[var(--j-green)]">{enabledCount}</span> enabled
            </span>
          </div>
        </div>
      </div>

      {/* ─── Provider accordion + model grid ─── */}
      {modelsApi.loading && !modelsApi.data ? (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="jarvis-panel h-40 animate-pulse" />
          ))}
        </div>
      ) : providerKeys.length === 0 ? (
        <EmptyState icon={Cpu} message="No models found — run a sync or seed providers." />
      ) : (
        <Accordion type="multiple" defaultValue={[providerKeys[0]]} className="space-y-3">
          {providerKeys.map((provider, pIdx) => {
            const accent = PROVIDER_ACCENT[provider] ?? JARVIS.colors.cyan;
            const list = filteredByProvider[provider] ?? [];
            const prov = providerMap.get(provider);
            const providerStat = summary?.byProvider.find((p) => p.providerKey === provider);
            if (list.length === 0 && statusFilter !== 'all') return null;
            return (
              <AccordionItem
                key={provider}
                value={provider}
                className="jarvis-panel !border-0 overflow-hidden"
              >
                <AccordionTrigger className="px-4 py-3 hover:no-underline hover:bg-[var(--j-panel-soft)]">
                  <div className="flex items-center justify-between w-full gap-3 pr-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="h-2.5 w-2.5 rounded-sm shrink-0" style={{ background: accent }} />
                      <span className="jarvis-mono text-xs uppercase tracking-widest text-[var(--j-text)] truncate">
                        {provider}
                      </span>
                      {prov?.hasKey ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Key className="h-3 w-3" style={{ color: JARVIS.colors.green }} />
                          </TooltipTrigger>
                          <TooltipContent>API key set (encrypted)</TooltipContent>
                        </Tooltip>
                      ) : provider !== 'local' ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Key className="h-3 w-3 text-[var(--j-text-mute)]" />
                          </TooltipTrigger>
                          <TooltipContent>No API key — set one to enable sync</TooltipContent>
                        </Tooltip>
                      ) : null}
                      {providerStat && providerStat.broken > 0 && (
                        <Badge variant="outline" className="text-[9px] !py-0 !px-1 !border-[var(--j-red)]/50 text-[var(--j-red)]">
                          {providerStat.broken} broken
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-3 shrink-0" onClick={(e) => e.stopPropagation()}>
                      <span className="jarvis-mono text-[10px] text-[var(--j-text-mute)]">
                        {list.length} models{providerStat?.lastChecked ? ` · synced ${timeAgo(providerStat.lastChecked)}` : ''}
                      </span>
                      {provider !== 'local' && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 !px-2 !py-0 text-[10px] gap-1 border-[var(--j-border)] bg-[var(--j-panel)]"
                          onClick={() => syncOneProvider(provider)}
                          disabled={busy !== null}
                        >
                          {busy === `sync-${provider}` ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <RefreshCw className="h-2.5 w-2.5" />}
                          Sync
                        </Button>
                      )}
                      {provider !== 'local' && prov && (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6 !px-2 !py-0 text-[10px] gap-1 border-[var(--j-border)] bg-[var(--j-panel)]"
                            onClick={() => testProviderKey(prov)}
                            disabled={busy !== null || !prov.hasKey}
                          >
                            {busy === `test-${provider}` ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Stethoscope className="h-2.5 w-2.5" />}
                            Test
                          </Button>
                          {prov && (
                            <Switch
                              checked={prov.enabled}
                              onCheckedChange={(v) => toggleProviderEnabled(prov, v)}
                              aria-label={`Toggle ${provider}`}
                            />
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 !px-2 !py-0 text-[10px] gap-1 hover:bg-[var(--j-panel)]"
                            onClick={() => {
                              setKeyDialogProvider(prov);
                              setApiKeyInput('');
                            }}
                          >
                            <Key className="h-2.5 w-2.5" />
                            {prov.hasKey ? 'Replace Key' : 'Set Key'}
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-4 pb-4 pt-1">
                  {list.length === 0 ? (
                    <div className="text-xs text-[var(--j-text-mute)] py-4 text-center">No models match the current filter.</div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                      {list.map((m, i) => {
                        const tierColor = TIER_COLOR[m.tier] ?? JARVIS.colors.textDim;
                        const TierIcon = TIER_ICON[m.tier] ?? Cpu;
                        const status = m.status ?? 'unknown';
                        const statusColor = STATUS_COLOR[status] ?? JARVIS.colors.textMute;
                        const source = m.source ?? 'seed';
                        const sourceColor = SOURCE_COLOR[source] ?? JARVIS.colors.textMute;
                        let caps: string[] = [];
                        try {
                          caps = JSON.parse(m.capabilities || '[]');
                        } catch {
                          /* ignore */
                        }
                        return (
                          <motion.button
                            key={m.id}
                            initial={{ opacity: 0, scale: 0.97 }}
                            animate={{ opacity: 1, scale: 1 }}
                            transition={{ delay: Math.min(i * 0.015, 0.3) }}
                            onClick={() => setDetailModel(m)}
                            className={`text-left p-3 rounded-md border border-[var(--j-border-soft)] bg-[var(--j-panel-soft)] hover:border-[var(--j-border)] transition-colors ${m.enabled ? '' : 'opacity-50'}`}
                          >
                            <div className="flex items-start justify-between mb-2 gap-2">
                              <div className="flex items-center gap-2 min-w-0">
                                <div
                                  className="flex h-8 w-8 items-center justify-center rounded-md shrink-0"
                                  style={{ background: `${tierColor}1a`, border: `1px solid ${tierColor}33`, color: tierColor }}
                                >
                                  <TierIcon className="h-4 w-4" />
                                </div>
                                <div className="min-w-0">
                                  <div className="jarvis-mono text-xs text-[var(--j-text)] truncate max-w-[160px]">{m.modelId}</div>
                                  <div className="text-[10px] text-[var(--j-text-mute)] mt-0.5">
                                    {(m.contextWindow / 1000).toFixed(0)}K ctx
                                    {m.latencyMs != null ? ` · ${m.latencyMs}ms` : ''}
                                  </div>
                                </div>
                              </div>
                              <div className="flex flex-col items-end gap-1 shrink-0">
                                <Pill color={tierColor}>{m.tier}</Pill>
                              </div>
                            </div>
                            <div className="flex flex-wrap gap-1 mb-2">
                              <span
                                className="jarvis-mono text-[9px] px-1.5 py-0.5 rounded uppercase"
                                style={{ background: `${statusColor}1a`, color: statusColor, border: `1px solid ${statusColor}33` }}
                              >
                                {STATUS_LABEL[status] ?? status}
                              </span>
                              <span
                                className="jarvis-mono text-[9px] px-1.5 py-0.5 rounded uppercase"
                                style={{ background: `${sourceColor}1a`, color: sourceColor, border: `1px solid ${sourceColor}33` }}
                              >
                                {source}
                              </span>
                              {m.enabled ? null : (
                                <span className="jarvis-mono text-[9px] px-1.5 py-0.5 rounded uppercase bg-[var(--j-panel)] text-[var(--j-text-mute)] border border-[var(--j-border-soft)]">
                                  disabled
                                </span>
                              )}
                            </div>
                            {caps.length > 0 && (
                              <div className="flex flex-wrap gap-1">
                                {caps.slice(0, 4).map((c) => (
                                  <span
                                    key={c}
                                    className="jarvis-mono text-[9px] px-1.5 py-0.5 rounded bg-[var(--j-panel)] text-[var(--j-text-mute)] border border-[var(--j-border-soft)]"
                                  >
                                    {c}
                                  </span>
                                ))}
                              </div>
                            )}
                            {m.lastChecked && (
                              <div className="mt-2 pt-2 border-t border-[var(--j-border-soft)] text-[9px] text-[var(--j-text-mute)]">
                                checked {timeAgo(m.lastChecked)}
                              </div>
                            )}
                          </motion.button>
                        );
                      })}
                    </div>
                  )}
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
      )}

      {/* ─── Activity log panel ─── */}
      <div className="jarvis-panel p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4" style={{ color: JARVIS.colors.cyan }} />
            <span className="jarvis-mono text-xs uppercase tracking-widest text-[var(--j-text)]">Activity Log</span>
          </div>
          <span className="jarvis-mono text-[10px] text-[var(--j-text-mute)]">last {activity.length} events</span>
        </div>
        {activity.length === 0 ? (
          <div className="text-xs text-[var(--j-text-mute)] py-4 text-center">No sync activity yet. Run a sync to populate.</div>
        ) : (
          <div className="max-h-72 overflow-y-auto space-y-1.5 pr-1 j-scroll">
            {activity.map((ev) => {
              const sevColor =
                ev.severity === 'success'
                  ? JARVIS.colors.green
                  : ev.severity === 'warn'
                    ? JARVIS.colors.amber
                    : ev.severity === 'error'
                      ? JARVIS.colors.red
                      : JARVIS.colors.cyan;
              return (
                <div
                  key={ev.id}
                  className="flex items-start gap-2 text-[11px] py-1.5 px-2 rounded bg-[var(--j-panel-soft)] border border-[var(--j-border-soft)]"
                >
                  <span className="h-1.5 w-1.5 rounded-full mt-1.5 shrink-0" style={{ background: sevColor }} />
                  <span className="jarvis-mono text-[9px] text-[var(--j-text-mute)] uppercase shrink-0 w-16">
                    {ev.kind}
                  </span>
                  <span className="jarvis-mono text-[9px] text-[var(--j-text-mute)] shrink-0 w-12">
                    {new Date(ev.ts).toLocaleTimeString('en-US', { hour12: false }).slice(0, 8)}
                  </span>
                  <span className="text-[var(--j-text)] flex-1 min-w-0">
                    {ev.target ? <span className="jarvis-mono text-[var(--j-text-mute)]">{ev.target} → </span> : null}
                    {ev.message}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ─── Model detail dialog ─── */}
      <Dialog open={!!detailModel} onOpenChange={(o) => !o && setDetailModel(null)}>
        <DialogContent className="max-w-lg bg-[var(--j-panel)] border-[var(--j-border)]">
          <DialogHeader>
            <DialogTitle className="jarvis-mono text-sm text-[var(--j-text)]">
              {detailModel?.modelId}
            </DialogTitle>
          </DialogHeader>
          {detailModel && (
            <div className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-2">
                <DetailRow label="Provider" value={detailModel.providerKey} />
                <DetailRow label="Tier" value={detailModel.tier} />
                <DetailRow label="Context Window" value={`${(detailModel.contextWindow / 1000).toFixed(0)}K`} />
                <DetailRow label="Status" value={STATUS_LABEL[detailModel.status ?? 'unknown'] ?? detailModel.status ?? '-'} />
                <DetailRow label="Source" value={detailModel.source ?? '-'} />
                <DetailRow label="Latency" value={detailModel.latencyMs != null ? `${detailModel.latencyMs}ms` : '-'} />
                <DetailRow label="Pricing/1K" value={detailModel.pricingPer1k != null ? `$${detailModel.pricingPer1k.toFixed(4)}` : '-'} />
                <DetailRow label="Last Checked" value={detailModel.lastChecked ? timeAgo(detailModel.lastChecked) : 'never'} />
              </div>
              <div>
                <div className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)] mb-1">Capabilities</div>
                <div className="flex flex-wrap gap-1">
                  {(() => {
                    try {
                      const caps = JSON.parse(detailModel.capabilities || '[]') as string[];
                      return caps.length ? (
                        caps.map((c) => (
                          <span
                            key={c}
                            className="jarvis-mono text-[10px] px-1.5 py-0.5 rounded bg-[var(--j-panel-soft)] text-[var(--j-text)] border border-[var(--j-border-soft)]"
                          >
                            {c}
                          </span>
                        ))
                      ) : (
                        <span className="text-[var(--j-text-mute)]">none</span>
                      );
                    } catch {
                      return <span className="text-[var(--j-text-mute)]">invalid JSON</span>;
                    }
                  })()}
                </div>
              </div>
              <div className="flex items-center justify-between pt-2 border-t border-[var(--j-border-soft)]">
                <div className="flex items-center gap-2">
                  <Switch
                    checked={detailModel.enabled}
                    onCheckedChange={(v) => toggleModelEnabled(detailModel, v)}
                  />
                  <span className="text-[var(--j-text-mute)]">{detailModel.enabled ? 'Enabled' : 'Disabled'}</span>
                </div>
              </div>
            </div>
          )}
          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 border-[var(--j-border)] bg-[var(--j-panel)]"
              onClick={() => runHealthCheckOne(detailModel!)}
              disabled={busy !== null}
            >
              {busy === `hc-${detailModel?.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Stethoscope className="h-3.5 w-3.5" />}
              Run Health Check
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="sm" variant="outline" className="gap-1.5 border-[var(--j-red)]/40 text-[var(--j-red)] hover:bg-[var(--j-red)]/10">
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent className="bg-[var(--j-panel)] border-[var(--j-border)]">
                <AlertDialogHeader>
                  <AlertDialogTitle className="text-[var(--j-text)]">Delete {detailModel?.modelId}?</AlertDialogTitle>
                  <AlertDialogDescription className="text-[var(--j-text-mute)]">
                    This permanently removes the model row from the catalog. The provider can re-add it on the next sync.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel className="bg-[var(--j-panel-soft)] border-[var(--j-border)]">Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-[var(--j-red)] text-white hover:bg-[var(--j-red)]/80"
                    onClick={() => detailModel && deleteModel(detailModel)}
                  >
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── API key dialog ─── */}
      <Dialog open={!!keyDialogProvider} onOpenChange={(o) => !o && setKeyDialogProvider(null)}>
        <DialogContent className="max-w-md bg-[var(--j-panel)] border-[var(--j-border)]">
          <DialogHeader>
            <DialogTitle className="jarvis-mono text-sm text-[var(--j-text)]">
              {keyDialogProvider?.hasKey ? 'Replace' : 'Set'} API Key — {keyDialogProvider?.name}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-xs">
            <p className="text-[var(--j-text-mute)]">
              The key is AES-256-GCM encrypted via the credential vault and stored as ciphertext in the Provider row.
              It is NEVER returned in any GET response — only a boolean <span className="jarvis-mono text-[var(--j-text)]">hasKey</span> flag.
            </p>
            <Input
              type="password"
              placeholder="Paste API key…"
              value={apiKeyInput}
              onChange={(e) => setApiKeyInput(e.target.value)}
              className="bg-[var(--j-panel-soft)] border-[var(--j-border)] text-[var(--j-text)]"
            />
            {keyDialogProvider?.hasKey && (
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5 border-[var(--j-red)]/40 text-[var(--j-red)] hover:bg-[var(--j-red)]/10"
                onClick={() => {
                  if (keyDialogProvider) clearApiKey(keyDialogProvider);
                  setKeyDialogProvider(null);
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Clear stored key
              </Button>
            )}
          </div>
          <DialogFooter>
            <Button size="sm" variant="outline" onClick={() => setKeyDialogProvider(null)} className="bg-[var(--j-panel-soft)] border-[var(--j-border)]">
              Cancel
            </Button>
            <Button size="sm" onClick={saveApiKey} disabled={busy !== null || !apiKeyInput.trim()} className="jarvis-btn-accent gap-1.5">
              {busy === 'save-key' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Key className="h-3.5 w-3.5" />}
              Encrypt & Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Purge confirmation ─── */}
      <AlertDialog open={purgeOpen} onOpenChange={setPurgeOpen}>
        <AlertDialogContent className="bg-[var(--j-panel)] border-[var(--j-border)]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-[var(--j-text)]">Purge broken models?</AlertDialogTitle>
            <AlertDialogDescription className="text-[var(--j-text-mute)]">
              This will permanently delete <span className="jarvis-mono text-[var(--j-red)]">{summary?.broken ?? 0}</span> model(s) flagged as broken.
              Rate-limited models are PRESERVED — they still work, just throttled.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-[var(--j-panel-soft)] border-[var(--j-border)]">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-[var(--j-red)] text-white hover:bg-[var(--j-red)]/80"
              onClick={runPurge}
              disabled={busy !== null}
            >
              {busy === 'purge' ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
              Purge {summary?.broken ?? 0} broken
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────

function FilterStatCard({
  label,
  value,
  color,
  icon: Icon,
  active,
  onClick,
}: {
  label: string;
  value: number;
  color: string;
  icon: typeof Cpu;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`text-left p-3 rounded-md border transition-all ${active ? 'border-[var(--j-border)] bg-[var(--j-panel)]' : 'border-[var(--j-border-soft)] bg-[var(--j-panel-soft)] hover:border-[var(--j-border)]'}`}
      style={active ? { boxShadow: `inset 0 0 0 1px ${color}33` } : undefined}
    >
      <div className="flex items-center justify-between mb-1">
        <span className="jarvis-mono text-[9px] uppercase tracking-widest text-[var(--j-text-mute)]">{label}</span>
        <Icon className="h-3 w-3" style={{ color }} />
      </div>
      <div className="text-2xl font-bold jarvis-mono" style={{ color }}>
        {value}
      </div>
    </button>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-1 px-2 rounded bg-[var(--j-panel-soft)] border border-[var(--j-border-soft)]">
      <span className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">{label}</span>
      <span className="jarvis-mono text-[11px] text-[var(--j-text)]">{value}</span>
    </div>
  );
}
