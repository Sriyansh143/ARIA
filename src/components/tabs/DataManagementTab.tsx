'use client';

// =====================================================================
// DataManagementTab — in-app Demo Data Management panel.
// =====================================================================
// Shows a live inventory of every demo-able table, lets the operator seed
// any of 7 catalogs (or all of them at once), and clear demo data in 7
// scopes (transactions / logs / comms / telemetry / notifications /
// spawned / all). Every destructive action opens a confirmation dialog;
// the "Reset ALL" action requires typing "RESET" to confirm.
//
// API surface:
//   GET    /api/admin/data              → { counts, seedScripts, ts }
//   GET    /api/admin/data/counts       → { counts, ts }  (lightweight polling)
//   POST   /api/admin/data              → { ok, message, counts, elapsed }
//   DELETE /api/admin/data              → { ok, deleted, total, message, counts }
// =====================================================================

import { useCallback, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Database, AlertTriangle, Loader2, RefreshCw, Sparkles, Trash2,
  CheckCircle2, XCircle, Wand2, History, Bell, Radio, Bot, Cpu,
  GraduationCap, Boxes, ScrollText, Layers, ShoppingCart, MessagesSquare,
  FileText, Target, Brain, Clock, Server, Workflow, KeyRound, ShieldCheck,
  DatabaseBackup, Download, Save,
  type LucideIcon,
} from 'lucide-react';
import { useApi, postJson } from '@/lib/hooks/use-api';
import { JARVIS } from '@/lib/config';
import { SectionTitle, Pill } from '@/components/jarvis/shared';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';

// ─── Types ───────────────────────────────────────────────────────────
type Counts = Record<string, number>;

interface SeedScriptMeta {
  key: string;
  label: string;
  description: string;
  tableCount: number;
}

interface DataStatus {
  counts: Counts;
  seedScripts: SeedScriptMeta[];
  ts: number;
}

interface PostResponse {
  ok: boolean;
  message?: string;
  error?: string;
  counts?: Counts;
  elapsed?: number;
}

interface DeleteResponse {
  ok: boolean;
  deleted?: Counts;
  total?: number;
  message?: string;
  error?: string;
  counts?: Counts;
  elapsed?: number;
}

// ─── Static table metadata (so the inventory grid renders even before
// the API responds; the API just supplies the counts).
interface TableMeta {
  key: string;
  label: string;
  icon: LucideIcon;
  hint: string;
  // Tab to deep-link to when clicked (omitted if there's no dedicated tab).
  href?: string;
}

const TABLES: TableMeta[] = [
  { key: 'agents',          label: 'Agents',          icon: Bot,            hint: 'Active agent fleet roster' },
  { key: 'workforceAgents', label: 'Workforce',       icon: Bot,            hint: 'Org-chart workforce agents' },
  { key: 'spawnedAgents',   label: 'Spawned',         icon: Bot,            hint: 'On-demand sub-agents' },
  { key: 'skills',          label: 'Skills',          icon: Sparkles,       hint: 'Skill catalog entries' },
  { key: 'plugins',         label: 'Plugins',         icon: Boxes,          hint: 'Installed plugins' },
  { key: 'cronJobs',        label: 'Cron Jobs',       icon: Clock,          hint: 'Scheduled dispatchers' },
  { key: 'providers',       label: 'Providers',       icon: Server,         hint: 'AI provider connections' },
  { key: 'models',          label: 'Models',          icon: Cpu,            hint: 'Catalog models per provider' },
  { key: 'rules',           label: 'Rules',           icon: ShieldCheck,    hint: 'Operator governance rules' },
  { key: 'earningMethods',  label: 'Earning Methods', icon: ShoppingCart,   hint: 'Approved earning methods' },
  { key: 'learningItems',   label: 'Learning',        icon: GraduationCap,  hint: 'Skill proficiency records' },
  { key: 'memoryItems',     label: 'Memory',          icon: Brain,          hint: 'Stored memory items' },
  { key: 'goals',           label: 'Goals',           icon: Target,         hint: 'MemoryItem(scope=goal)' },
  { key: 'tasks',           label: 'Tasks',           icon: ScrollText,     hint: 'Task queue entries' },
  { key: 'artifacts',       label: 'Artifacts',       icon: FileText,       hint: 'Generated artifacts' },
  { key: 'comms',           label: 'Comms',           icon: MessagesSquare, hint: 'Agent-to-agent messages' },
  { key: 'payments',        label: 'Payments',        icon: ShoppingCart,   hint: 'Historical payment rows' },
  { key: 'notifications',   label: 'Notifications',   icon: Bell,           hint: 'Operator notifications' },
  { key: 'telemetry',       label: 'Telemetry',       icon: Radio,          hint: 'Live system telemetry' },
  { key: 'agentLogs',       label: 'Agent Logs',      icon: History,        hint: 'Per-agent log lines' },
  { key: 'blackboxLogs',    label: 'Blackbox',        icon: Layers,         hint: 'In-memory audit buffer' },
  { key: 'credentials',     label: 'Credentials',     icon: KeyRound,       hint: 'Encrypted platform creds' },
  { key: 'scheduledAutonomy', label: 'Scheduled Auto', icon: Workflow,      hint: 'Recurring autonomy loops' },
  { key: 'autonomyTemplates', label: 'Auto Templates', icon: Workflow,     hint: 'Reusable autonomy templates' },
  { key: 'pipelines',       label: 'Pipelines',       icon: Workflow,       hint: 'Saved skill pipelines' },
];

// ─── Seed button definitions ─────────────────────────────────────────
interface SeedButton {
  key: 'all' | 'agents' | 'cron' | 'providers-models' | 'rules' | 'earning-methods' | 'comms-payments' | 'learning';
  label: string;
  description: string;
  targetTables: string;
  estimate: string;
  icon: LucideIcon;
  variant: 'primary' | 'default';
}

const SEED_BUTTONS: SeedButton[] = [
  {
    key: 'all',
    label: 'Seed Everything',
    description: 'Runs every seed script in sequence — agents, cron, providers+models, rules, earning methods, comms+payments, learning.',
    targetTables: '14 tables',
    estimate: '~5–10s · providers-models is the heaviest',
    icon: Wand2,
    variant: 'primary',
  },
  {
    key: 'agents',
    label: 'Seed Agents',
    description: 'Upserts the 64-agent roster + 16 departments + 25 workforce agents from AGENT_ROSTER.',
    targetTables: 'agent, department, workforceAgent',
    estimate: '64 agents · 16 depts · 25 workforce',
    icon: Bot,
    variant: 'default',
  },
  {
    key: 'cron',
    label: 'Seed Cron Jobs',
    description: 'Upserts all 27 cron jobs from CRON_ROSTER with their schedules + dispatchers.',
    targetTables: 'cronJob',
    estimate: '27 jobs',
    icon: Clock,
    variant: 'default',
  },
  {
    key: 'providers-models',
    label: 'Seed Providers + Models',
    description: 'Upserts 23 AI providers + 453 models from the catalog (PROVIDER_SEEDS + MODEL_CATALOG).',
    targetTables: 'provider, model',
    estimate: '23 providers · 453 models',
    icon: Server,
    variant: 'default',
  },
  {
    key: 'rules',
    label: 'Seed Rules',
    description: 'Upserts 33 operator rules across 5 categories (financial, operational, safety, legal, intelligence).',
    targetTables: 'rule',
    estimate: '33 rules',
    icon: ShieldCheck,
    variant: 'default',
  },
  {
    key: 'earning-methods',
    label: 'Seed Earning Methods',
    description: 'Seeds 15 earning methods across 9 categories. Existing keys are skipped.',
    targetTables: 'earningMethod',
    estimate: '15 methods',
    icon: ShoppingCart,
    variant: 'default',
  },
  {
    key: 'comms-payments',
    label: 'Seed Comms + Payments',
    description: 'Seeds 10 agent comms messages + 14 days of varied historical payment records.',
    targetTables: 'agentMessage, payment',
    estimate: '10 messages · ~17 payments',
    icon: MessagesSquare,
    variant: 'default',
  },
  {
    key: 'learning',
    label: 'Seed Learning Items',
    description: 'Upserts 15 SkillLearning records (agent × skill proficiency + earnings) for the Learn & Earn tab.',
    targetTables: 'skillLearning',
    estimate: '15 records',
    icon: GraduationCap,
    variant: 'default',
  },
];

// ─── Remove button definitions ───────────────────────────────────────
interface RemoveButton {
  key: 'all' | 'transactions' | 'logs' | 'comms' | 'telemetry' | 'notifications' | 'spawned';
  label: string;
  description: string;
  countKey: keyof Counts;     // which counts entry to show as "current"
  deletes: string;
  icon: LucideIcon;
  variant: 'danger' | 'default';
  requireTypedConfirm?: string;  // if set, user must type this string to confirm
}

const REMOVE_BUTTONS: RemoveButton[] = [
  {
    key: 'transactions',
    label: 'Clear Transactions',
    description: 'Delete all Payment rows from the database. Useful for resetting the revenue chart.',
    countKey: 'payments',
    deletes: 'payment',
    icon: ShoppingCart,
    variant: 'default',
  },
  {
    key: 'logs',
    label: 'Clear Logs',
    description: 'Delete all AgentLog rows older than 1 hour. Recent logs are preserved so in-flight issues stay visible.',
    countKey: 'agentLogs',
    deletes: 'agentLog (age > 1h)',
    icon: History,
    variant: 'default',
  },
  {
    key: 'comms',
    label: 'Clear Comms',
    description: 'Delete all AgentMessage rows. The agent-to-agent comms timeline will be empty after this.',
    countKey: 'comms',
    deletes: 'agentMessage',
    icon: MessagesSquare,
    variant: 'default',
  },
  {
    key: 'telemetry',
    label: 'Clear Telemetry',
    description: 'Delete all Telemetry rows. The telemetry chart will start fresh on the next sample.',
    countKey: 'telemetry',
    deletes: 'telemetry',
    icon: Radio,
    variant: 'default',
  },
  {
    key: 'notifications',
    label: 'Clear Notifications',
    description: 'Delete all Notification rows. The bell-icon unread counter will reset to zero.',
    countKey: 'notifications',
    deletes: 'notification',
    icon: Bell,
    variant: 'default',
  },
  {
    key: 'spawned',
    label: 'Clear Spawned Agents',
    description: 'Delete all SpawnedAgent rows. SpawnedAgentLog entries are preserved (permanent record).',
    countKey: 'spawnedAgents',
    deletes: 'spawnedAgent',
    icon: Bot,
    variant: 'default',
  },
  {
    key: 'all',
    label: 'Reset ALL Demo Data',
    description: 'Deletes payments, comms, telemetry, notifications, spawned agents, and agent logs (>1h) in one shot. Reference data (providers, models, rules, earning methods, agents, plugins, skills) is preserved.',
    countKey: 'agentLogs',
    deletes: 'payment + agentMessage + telemetry + notification + spawnedAgent + agentLog(>1h)',
    icon: AlertTriangle,
    variant: 'danger',
    requireTypedConfirm: 'RESET',
  },
];

// ─── Component ───────────────────────────────────────────────────────
export default function DataManagementTab() {
  const { toast } = useToast();
  // We use the lightweight /counts endpoint for polling (every 20s) and
  // only hit the full /api/admin/data once on mount to fetch the seed
  // script catalog (which is static, but cheap to grab once).
  const { data: fullData, error: fullError, refresh: refreshFull } = useApi<DataStatus>('/api/admin/data', -1);
  const { data: countsData, error: countsError, refresh: refreshCounts } = useApi<{ counts: Counts; ts: number }>('/api/admin/data/counts', 20000);

  const counts = countsData?.counts ?? fullData?.counts ?? {};

  // Track which seed/clear action is currently in-flight (so we can
  // disable the matching button + show a spinner).
  const [busy, setBusy] = useState<string | null>(null);
  // The seed/clear action awaiting confirmation.
  const [pendingSeed, setPendingSeed] = useState<SeedButton | null>(null);
  const [pendingRemove, setPendingRemove] = useState<RemoveButton | null>(null);
  // Typed-confirmation state for the "Reset ALL" action.
  const [typedConfirm, setTypedConfirm] = useState('');

  // ─── Handlers ─────────────────────────────────────────────────────
  const handleSeed = useCallback(async (btn: SeedButton) => {
    setPendingSeed(null);
    setBusy(btn.key);
    toast({ title: `${btn.label}…`, description: 'Running seed. This may take a few seconds.' });
    try {
      const res = await postJson<PostResponse>('/api/admin/data', { script: btn.key });
      if (res.ok) {
        toast({ title: `${btn.label} complete`, description: res.message ?? 'Done' });
      } else {
        toast({ title: `${btn.label} failed`, description: res.error ?? 'Unknown error' });
      }
      refreshCounts();
    } catch (e) {
      toast({ title: `${btn.label} failed`, description: e instanceof Error ? e.message : 'Network error' });
    } finally {
      setBusy(null);
    }
  }, [refreshCounts, toast]);

  const handleRemove = useCallback(async (btn: RemoveButton) => {
    setPendingRemove(null);
    setBusy(btn.key);
    setTypedConfirm('');
    toast({ title: `${btn.label}…`, description: 'Clearing demo data.' });
    try {
      const res = await fetch('/api/admin/data', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope: btn.key }),
      }).then((r) => r.json() as Promise<DeleteResponse>);
      if (res.ok) {
        toast({ title: `${btn.label} complete`, description: res.message ?? 'Done' });
      } else {
        toast({ title: `${btn.label} failed`, description: res.error ?? 'Unknown error' });
      }
      refreshCounts();
    } catch (e) {
      toast({ title: `${btn.label} failed`, description: e instanceof Error ? e.message : 'Network error' });
    } finally {
      setBusy(null);
    }
  }, [refreshCounts, toast]);

  // ─── Render ───────────────────────────────────────────────────────
  const totalRows = useMemo(
    () => Object.values(counts).reduce((a, b) => a + (typeof b === 'number' ? b : 0), 0),
    [counts],
  );
  const populatedTables = TABLES.filter((t) => (counts[t.key] ?? 0) > 0).length;
  const isLoading = !fullData && !countsData;

  return (
    <div className="space-y-6">
      <SectionTitle
        title="Data Management"
        icon={Database}
        accent={JARVIS.colors.amber}
        action={
          <Button
            size="sm"
            variant="outline"
            className="jarvis-btn-accent border-0"
            onClick={() => { refreshFull(); refreshCounts(); }}
            disabled={busy !== null}
          >
            <RefreshCw className={cn('h-3.5 w-3.5 mr-1', isLoading && 'animate-spin')} />
            Refresh
          </Button>
        }
      />

      {/* Warning banner */}
      <motion.div
        initial={{ opacity: 0, y: -5 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-lg border p-3 flex items-start gap-3"
        style={{
          borderColor: `${JARVIS.colors.amber}40`,
          background: `${JARVIS.colors.amber}0d`,
        }}
      >
        <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" style={{ color: JARVIS.colors.amber }} />
        <div className="text-xs leading-relaxed">
          <span className="font-semibold" style={{ color: JARVIS.colors.amber }}>
            Caution:
          </span>{' '}
          <span className="text-[var(--j-text-dim)]">
            These actions modify the database directly. Use with caution in production.
            Seeding is idempotent (safe to re-run); clearing is destructive and
            cannot be undone.
          </span>
        </div>
      </motion.div>

      {/* Errors */}
      {(fullError || countsError) && (
        <div className="rounded-lg border border-[var(--j-red)]/40 bg-[var(--j-red)]/10 p-3 text-xs text-[var(--j-red)]">
          Failed to load data status: {fullError ?? countsError}. Showing cached counts.
        </div>
      )}

      {/* Stats strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatTile label="Tables Tracked" value={TABLES.length} icon={Database} accent={JARVIS.colors.cyan} />
        <StatTile label="Populated" value={populatedTables} icon={CheckCircle2} accent={JARVIS.colors.green} />
        <StatTile label="Empty" value={TABLES.length - populatedTables} icon={XCircle} accent={JARVIS.colors.textMute} />
        <StatTile label="Total Rows" value={totalRows.toLocaleString()} icon={Layers} accent={JARVIS.colors.amber} />
      </div>

      {/* Current Data Inventory */}
      <div>
        <h3 className="jarvis-mono text-xs uppercase tracking-widest text-[var(--j-text-dim)] mb-2">
          Current Data Inventory
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2.5">
          {TABLES.map((t, i) => {
            const count = counts[t.key] ?? 0;
            const hasData = count > 0;
            const accent = hasData ? JARVIS.colors.green : JARVIS.colors.textMute;
            const Icon = t.icon;
            return (
              <motion.div
                key={t.key}
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25, delay: i * 0.012 }}
                className="jarvis-panel p-3 relative overflow-hidden"
                style={{ borderColor: hasData ? `${accent}40` : 'var(--j-border)' }}
              >
                <div className="flex items-start justify-between mb-1.5">
                  <div
                    className="flex h-7 w-7 items-center justify-center rounded-md shrink-0"
                    style={{ background: `${accent}1a`, border: `1px solid ${accent}33`, color: accent }}
                  >
                    <Icon className="h-3.5 w-3.5" />
                  </div>
                  <span
                    className="jarvis-mono text-lg font-semibold tabular-nums"
                    style={{ color: accent }}
                  >
                    {count.toLocaleString()}
                  </span>
                </div>
                <div className="text-xs font-medium text-[var(--j-text)] truncate">{t.label}</div>
                <div className="text-[10px] text-[var(--j-text-mute)] mt-0.5 truncate" title={t.hint}>
                  {t.hint}
                </div>
                {hasData && (
                  <div
                    className="absolute bottom-0 left-0 h-[2px]"
                    style={{ width: '60%', background: `linear-gradient(90deg, ${accent}, transparent)` }}
                  />
                )}
              </motion.div>
            );
          })}
        </div>
      </div>

      {/* Seed Demo Data */}
      <div>
        <h3 className="jarvis-mono text-xs uppercase tracking-widest text-[var(--j-text-dim)] mb-2 flex items-center gap-2">
          <Sparkles className="h-3.5 w-3.5" style={{ color: JARVIS.colors.green }} />
          Seed Demo Data
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {SEED_BUTTONS.map((btn, i) => {
            const Icon = btn.icon;
            const isBusy = busy === btn.key;
            const isPrimary = btn.variant === 'primary';
            const accent = isPrimary ? JARVIS.colors.amber : JARVIS.colors.green;
            return (
              <motion.div
                key={btn.key}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: i * 0.025 }}
                className={cn(
                  'jarvis-panel p-4 flex flex-col gap-2 relative overflow-hidden',
                  isPrimary && 'ring-1',
                )}
                style={isPrimary ? { borderColor: `${accent}66`, boxShadow: `0 0 20px ${accent}10` } : undefined}
              >
                <div className="flex items-center gap-2">
                  <div
                    className="flex h-8 w-8 items-center justify-center rounded-md shrink-0"
                    style={{ background: `${accent}1a`, border: `1px solid ${accent}33`, color: accent }}
                  >
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-[var(--j-text)] truncate">{btn.label}</div>
                    <div className="text-[10px] text-[var(--j-text-mute)]">{btn.targetTables}</div>
                  </div>
                  {isPrimary && (
                    <Pill color={JARVIS.colors.amber}>PRIMARY</Pill>
                  )}
                </div>
                <p className="text-xs text-[var(--j-text-dim)] leading-relaxed flex-1">
                  {btn.description}
                </p>
                <div className="flex items-center justify-between gap-2 mt-1">
                  <span className="text-[10px] text-[var(--j-text-mute)] jarvis-mono">{btn.estimate}</span>
                  <Button
                    size="sm"
                    disabled={isBusy || (busy !== null && busy !== btn.key)}
                    onClick={() => setPendingSeed(btn)}
                    className={cn(
                      'h-7 text-xs gap-1',
                      isPrimary
                        ? 'bg-[var(--j-amber)] text-black hover:bg-[var(--j-amber)]/90'
                        : 'jarvis-btn-accent border-0',
                    )}
                  >
                    {isBusy ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Wand2 className="h-3 w-3" />
                    )}
                    {isBusy ? 'Running…' : 'Seed'}
                  </Button>
                </div>
                {isPrimary && (
                  <div
                    className="absolute bottom-0 left-0 h-[2px]"
                    style={{ width: '80%', background: `linear-gradient(90deg, ${accent}, transparent)` }}
                  />
                )}
              </motion.div>
            );
          })}
        </div>
      </div>

      {/* Remove Demo Data */}
      <div>
        <h3 className="jarvis-mono text-xs uppercase tracking-widest text-[var(--j-text-dim)] mb-2 flex items-center gap-2">
          <Trash2 className="h-3.5 w-3.5" style={{ color: JARVIS.colors.red }} />
          Remove Demo Data
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {REMOVE_BUTTONS.map((btn, i) => {
            const Icon = btn.icon;
            const isBusy = busy === btn.key;
            const isDanger = btn.variant === 'danger';
            const currentCount = counts[btn.countKey] ?? 0;
            const accent = isDanger ? JARVIS.colors.red : JARVIS.colors.amber;
            return (
              <motion.div
                key={btn.key}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: i * 0.025 }}
                className={cn(
                  'jarvis-panel p-4 flex flex-col gap-2 relative overflow-hidden',
                  isDanger && 'ring-1',
                )}
                style={isDanger ? { borderColor: `${accent}66`, boxShadow: `0 0 20px ${accent}10` } : undefined}
              >
                <div className="flex items-center gap-2">
                  <div
                    className="flex h-8 w-8 items-center justify-center rounded-md shrink-0"
                    style={{ background: `${accent}1a`, border: `1px solid ${accent}33`, color: accent }}
                  >
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-[var(--j-text)] truncate">{btn.label}</div>
                    <div className="text-[10px] text-[var(--j-text-mute)]">
                      Current: <span className="jarvis-mono tabular-nums" style={{ color: currentCount > 0 ? accent : 'var(--j-text-mute)' }}>{currentCount.toLocaleString()}</span>
                    </div>
                  </div>
                  {isDanger && (
                    <Pill color={JARVIS.colors.red}>DANGER</Pill>
                  )}
                </div>
                <p className="text-xs text-[var(--j-text-dim)] leading-relaxed flex-1">
                  {btn.description}
                </p>
                <div className="flex items-center justify-between gap-2 mt-1">
                  <span className="text-[10px] text-[var(--j-text-mute)] jarvis-mono truncate" title={btn.deletes}>
                    deletes: {btn.deletes}
                  </span>
                  <Button
                    size="sm"
                    disabled={isBusy || (busy !== null && busy !== btn.key) || (currentCount === 0 && !isDanger)}
                    onClick={() => setPendingRemove(btn)}
                    className={cn(
                      'h-7 text-xs gap-1',
                      isDanger
                        ? 'bg-[var(--j-red)] text-white hover:bg-[var(--j-red)]/90'
                        : 'bg-transparent border border-[var(--j-amber)]/50 text-[var(--j-amber)] hover:bg-[var(--j-amber)]/10',
                    )}
                  >
                    {isBusy ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Trash2 className="h-3 w-3" />
                    )}
                    {isBusy ? 'Clearing…' : 'Clear'}
                  </Button>
                </div>
                {isDanger && (
                  <div
                    className="absolute bottom-0 left-0 h-[2px]"
                    style={{ width: '80%', background: `linear-gradient(90deg, ${accent}, transparent)` }}
                  />
                )}
              </motion.div>
            );
          })}
        </div>
      </div>

      {/* ─── Task ID 4 (PARALLEL-C): Backups section ─────────────────── */}
      <BackupsSection />

      {/* Footer note */}
      <div className="text-[10px] text-[var(--j-text-mute)] text-center pt-2">
        Counts auto-refresh every 20 seconds. Last refresh: {countsData?.ts ? new Date(countsData.ts).toLocaleTimeString() : '—'}
      </div>

      {/* ─── Seed confirmation dialog ────────────────────────────────── */}
      <Dialog open={pendingSeed !== null} onOpenChange={(o) => !o && setPendingSeed(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Wand2 className="h-4 w-4" style={{ color: JARVIS.colors.green }} />
              {pendingSeed?.label}
            </DialogTitle>
            <DialogDescription>
              This will ADD demo data to the database. The action is idempotent —
              existing rows will be upserted (updated), not duplicated.
            </DialogDescription>
          </DialogHeader>
          {pendingSeed && (
            <div className="space-y-3 text-sm">
              <p className="text-[var(--j-text-dim)]">{pendingSeed.description}</p>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-md border border-[var(--j-border)] p-2">
                  <div className="text-[10px] uppercase text-[var(--j-text-mute)] jarvis-mono">Target tables</div>
                  <div className="text-xs text-[var(--j-text)] mt-0.5">{pendingSeed.targetTables}</div>
                </div>
                <div className="rounded-md border border-[var(--j-border)] p-2">
                  <div className="text-[10px] uppercase text-[var(--j-text-mute)] jarvis-mono">Estimate</div>
                  <div className="text-xs text-[var(--j-text)] mt-0.5">{pendingSeed.estimate}</div>
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setPendingSeed(null)}>Cancel</Button>
            <Button
              size="sm"
              className="bg-[var(--j-green)] text-black hover:bg-[var(--j-green)]/90 gap-1.5"
              onClick={() => pendingSeed && handleSeed(pendingSeed)}
            >
              <Wand2 className="h-3.5 w-3.5" /> Confirm Seed
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Remove confirmation dialog (default scope) ──────────────── */}
      <Dialog open={pendingRemove !== null && pendingRemove.requireTypedConfirm === undefined} onOpenChange={(o) => !o && setPendingRemove(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Trash2 className="h-4 w-4" style={{ color: JARVIS.colors.red }} />
              {pendingRemove?.label}
            </DialogTitle>
            <DialogDescription>
              This will permanently delete the demo data in scope. This action
              cannot be undone.
            </DialogDescription>
          </DialogHeader>
          {pendingRemove && (
            <div className="space-y-3 text-sm">
              <p className="text-[var(--j-text-dim)]">{pendingRemove.description}</p>
              <div className="rounded-md border border-[var(--j-red)]/40 bg-[var(--j-red)]/10 p-2">
                <div className="text-[10px] uppercase text-[var(--j-red)] jarvis-mono">Will delete from</div>
                <div className="text-xs text-[var(--j-text)] mt-0.5 font-mono">{pendingRemove.deletes}</div>
              </div>
              <div className="rounded-md border border-[var(--j-border)] p-2">
                <div className="text-[10px] uppercase text-[var(--j-text-mute)] jarvis-mono">Current row count</div>
                <div className="text-xs text-[var(--j-text)] mt-0.5 jarvis-mono tabular-nums">
                  {(counts[pendingRemove.countKey] ?? 0).toLocaleString()}
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setPendingRemove(null)}>Cancel</Button>
            <Button
              size="sm"
              className="bg-[var(--j-red)] text-white hover:bg-[var(--j-red)]/90 gap-1.5"
              onClick={() => pendingRemove && handleRemove(pendingRemove)}
            >
              <Trash2 className="h-3.5 w-3.5" /> Confirm Clear
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Reset ALL — typed confirmation dialog ───────────────────── */}
      <AlertDialog
        open={pendingRemove !== null && pendingRemove.requireTypedConfirm !== undefined}
        onOpenChange={(o) => { if (!o) { setPendingRemove(null); setTypedConfirm(''); } }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-[var(--j-red)]">
              <AlertTriangle className="h-5 w-5" />
              {pendingRemove?.label}
            </AlertDialogTitle>
            <AlertDialogDescription>
              This is a DESTRUCTIVE bulk operation that wipes payments, comms,
              telemetry, notifications, spawned agents, and agent logs older
              than 1 hour. Reference data (providers, models, rules, earning
              methods, agents, plugins, skills) is preserved.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {pendingRemove && (
            <div className="space-y-3 text-sm">
              <p className="text-[var(--j-text-dim)]">{pendingRemove.description}</p>
              <div className="rounded-md border border-[var(--j-red)]/40 bg-[var(--j-red)]/10 p-2">
                <div className="text-[10px] uppercase text-[var(--j-red)] jarvis-mono">Will delete from</div>
                <div className="text-xs text-[var(--j-text)] mt-0.5 font-mono">{pendingRemove.deletes}</div>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-[var(--j-text-dim)] block">
                  Type <span className="jarvis-mono font-bold text-[var(--j-red)]">{pendingRemove.requireTypedConfirm}</span> to confirm:
                </label>
                <Input
                  value={typedConfirm}
                  onChange={(e) => setTypedConfirm(e.target.value)}
                  placeholder={pendingRemove.requireTypedConfirm}
                  autoComplete="off"
                  autoFocus
                  className="font-mono"
                />
              </div>
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => { setPendingRemove(null); setTypedConfirm(''); }}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-[var(--j-red)] text-white hover:bg-[var(--j-red)]/90 gap-1.5"
              disabled={typedConfirm !== (pendingRemove?.requireTypedConfirm ?? '')}
              onClick={() => pendingRemove && handleRemove(pendingRemove)}
            >
              <Trash2 className="h-3.5 w-3.5" /> Reset Everything
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── BackupsSection (Task ID 4 / PARALLEL-C) ────────────────────────
// Inline sub-component: lists /api/admin/backup entries and exposes
// Create / Download / Restore / Delete actions. Self-contained — no
// parent state is touched.
interface BackupMeta {
  filename: string;
  path: string;
  sizeBytes: number;
  createdAt: string;
  ageDays: number;
}
interface BackupsResponse {
  backups: BackupMeta[];
  count: number;
  totalBytes?: number;
  maxBackups?: number;
  maxAgeDays?: number;
  error?: string;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function BackupsSection() {
  const { toast } = useToast();
  const { data, loading, refresh } = useApi<BackupsResponse>('/api/admin/backup', 30000);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<BackupMeta | null>(null);

  const backups = data?.backups ?? [];
  const totalBytes = data?.totalBytes ?? backups.reduce((a, b) => a + b.sizeBytes, 0);

  const createBackup = async () => {
    setBusyAction('create');
    toast({ title: 'Creating backup…', description: 'Exporting key DB tables as gzip JSON.' });
    try {
      const res = await postJson<{ ok: boolean; backup?: BackupMeta; message?: string; error?: string }>(
        '/api/admin/backup',
        { label: 'manual' },
      );
      if (res.ok) {
        toast({ title: 'Backup created', description: res.message ?? res.backup?.filename });
      } else {
        toast({ title: 'Backup failed', description: res.error ?? 'Unknown error', variant: 'destructive' });
      }
      refresh();
    } catch (e) {
      toast({ title: 'Backup failed', description: e instanceof Error ? e.message : 'Network error', variant: 'destructive' });
    } finally {
      setBusyAction(null);
    }
  };

  const downloadBackup = (b: BackupMeta) => {
    // Direct browser download — the API streams the .gz file.
    const a = document.createElement('a');
    a.href = `/api/admin/backup?download=${encodeURIComponent(b.filename)}`;
    a.download = b.filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    toast({ title: 'Downloading backup', description: b.filename });
  };

  const restoreBackup = async (b: BackupMeta) => {
    setBusyAction(`restore-${b.filename}`);
    toast({ title: 'Loading backup payload…', description: b.filename });
    try {
      const res = await fetch(`/api/admin/backup?restore=${encodeURIComponent(b.filename)}`);
      const json = await res.json() as { ok: boolean; payload?: unknown; error?: string };
      if (json.ok) {
        // For safety, we DON'T auto-restore — just preview the snapshot in
        // a downloadable JSON file so the operator can inspect it. A full
        // automated restore would wipe the current DB and is too dangerous
        // to wire up without a typed confirmation flow.
        const blob = new Blob([JSON.stringify(json.payload, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = b.filename.replace('.json.gz', '.preview.json');
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        toast({
          title: 'Backup preview downloaded',
          description: 'Inspect the JSON; for full restore, contact your DB administrator.',
        });
      } else {
        toast({ title: 'Restore failed', description: json.error ?? 'Unknown error', variant: 'destructive' });
      }
    } catch (e) {
      toast({ title: 'Restore failed', description: e instanceof Error ? e.message : 'Network error', variant: 'destructive' });
    } finally {
      setBusyAction(null);
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    const b = pendingDelete;
    setPendingDelete(null);
    setBusyAction(`delete-${b.filename}`);
    try {
      const res = await fetch('/api/admin/backup', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: b.filename }),
      }).then((r) => r.json() as Promise<{ ok: boolean; error?: string }>);
      if (res.ok) {
        toast({ title: 'Backup deleted', description: b.filename });
      } else {
        toast({ title: 'Delete failed', description: res.error ?? 'Unknown error', variant: 'destructive' });
      }
      refresh();
    } catch (e) {
      toast({ title: 'Delete failed', description: e instanceof Error ? e.message : 'Network error', variant: 'destructive' });
    } finally {
      setBusyAction(null);
    }
  };

  const accent = JARVIS.colors.violet;

  return (
    <div>
      <h3 className="jarvis-mono text-xs uppercase tracking-widest text-[var(--j-text-dim)] mb-2 flex items-center gap-2">
        <DatabaseBackup className="h-3.5 w-3.5" style={{ color: accent }} />
        Backups
        <span className="jarvis-mono text-[10px] text-[var(--j-text-mute)] normal-case font-normal ml-1">
          · {backups.length} file(s) · {formatBytes(totalBytes)}
          {data?.maxBackups ? ` · cap ${data.maxBackups}/${data.maxAgeDays}d` : ''}
        </span>
        <Button
          size="sm"
          className="ml-auto h-7 text-xs gap-1 jarvis-btn-accent border-0"
          disabled={busyAction !== null}
          onClick={createBackup}
        >
          {busyAction === 'create' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
          {busyAction === 'create' ? 'Creating…' : 'Create Backup'}
        </Button>
      </h3>

      <p className="text-[10px] text-[var(--j-text-mute)] mb-2">
        Snapshots of the key DB tables (agents, tasks, skills, providers, models, rules,
        payments, comms, etc.) saved as gzip-compressed JSON. Auto-rotates to keep at most
        {data?.maxBackups ?? 20} backups, deleting anything older than {data?.maxAgeDays ?? 90} days.
      </p>

      <div className="jarvis-panel p-0 overflow-hidden">
        <div className="max-h-72 overflow-y-auto jarvis-scroll">
          {loading && !data ? (
            <div className="p-4 flex items-center gap-2 text-[var(--j-text-mute)] text-xs">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> loading backups…
            </div>
          ) : backups.length ? (
            <div className="font-mono text-xs">
              {backups.map((b, i) => {
                const isBusy = busyAction === `restore-${b.filename}` || busyAction === `delete-${b.filename}`;
                return (
                  <motion.div
                    key={b.filename}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: Math.min(i * 0.02, 0.3) }}
                    className="grid grid-cols-[1fr_90px_70px_140px] gap-2 px-4 py-2 border-b border-[var(--j-border-soft)] hover:bg-[var(--j-panel-soft)]/40 items-center"
                  >
                    <div className="min-w-0 flex flex-col gap-0.5">
                      <span className="text-[var(--j-text)] truncate">{b.filename}</span>
                      <span className="text-[10px] text-[var(--j-text-mute)]">
                        {new Date(b.createdAt).toLocaleString()} · {b.ageDays.toFixed(1)}d old
                      </span>
                    </div>
                    <span className="text-[var(--j-cyan)] tabular-nums text-[11px]">{formatBytes(b.sizeBytes)}</span>
                    <span className="text-[10px]">
                      <Pill color={b.ageDays > (data?.maxAgeDays ?? 90) * 0.8 ? JARVIS.colors.amber : JARVIS.colors.green}>
                        {b.ageDays < 1 ? 'today' : `${Math.floor(b.ageDays)}d`}
                      </Pill>
                    </span>
                    <div className="flex items-center gap-1 justify-end">
                      <button
                        onClick={() => downloadBackup(b)}
                        disabled={isBusy}
                        className="h-7 w-7 flex items-center justify-center rounded-md border border-[var(--j-border)] text-[var(--j-text-dim)] hover:text-[var(--j-cyan)] hover:border-[var(--j-cyan)]/40 disabled:opacity-40"
                        title="Download .gz"
                        aria-label={`Download ${b.filename}`}
                      >
                        <Download className="h-3 w-3" />
                      </button>
                      <button
                        onClick={() => restoreBackup(b)}
                        disabled={isBusy}
                        className="h-7 w-7 flex items-center justify-center rounded-md border border-[var(--j-border)] text-[var(--j-text-dim)] hover:text-[var(--j-violet)] hover:border-[var(--j-violet)]/40 disabled:opacity-40"
                        title="Preview (restore JSON)"
                        aria-label={`Preview ${b.filename}`}
                      >
                        {busyAction === `restore-${b.filename}` ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileText className="h-3 w-3" />}
                      </button>
                      <button
                        onClick={() => setPendingDelete(b)}
                        disabled={isBusy}
                        className="h-7 w-7 flex items-center justify-center rounded-md border border-[var(--j-border)] text-[var(--j-text-dim)] hover:text-[var(--j-red)] hover:border-[var(--j-red)]/40 disabled:opacity-40"
                        title="Delete"
                        aria-label={`Delete ${b.filename}`}
                      >
                        {busyAction === `delete-${b.filename}` ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                      </button>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          ) : (
            <div className="p-6 flex flex-col items-center justify-center text-center">
              <DatabaseBackup className="h-8 w-8 text-[var(--j-text-mute)] mb-2" />
              <div className="jarvis-mono text-[10px] uppercase text-[var(--j-text-dim)]">no backups yet</div>
              <div className="text-[10px] text-[var(--j-text-mute)] mt-1">Click &ldquo;Create Backup&rdquo; to snapshot the DB.</div>
            </div>
          )}
        </div>
      </div>

      {/* Delete-confirmation dialog */}
      <Dialog open={pendingDelete !== null} onOpenChange={(o) => !o && setPendingDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Trash2 className="h-4 w-4" style={{ color: JARVIS.colors.red }} />
              Delete backup
            </DialogTitle>
            <DialogDescription>
              This permanently deletes the backup file. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          {pendingDelete && (
            <div className="rounded-md border border-[var(--j-red)]/40 bg-[var(--j-red)]/10 p-2 font-mono text-xs">
              {pendingDelete.filename}
              <div className="text-[10px] text-[var(--j-text-mute)] mt-1">
                {formatBytes(pendingDelete.sizeBytes)} · created {new Date(pendingDelete.createdAt).toLocaleString()}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setPendingDelete(null)}>Cancel</Button>
            <Button
              size="sm"
              className="bg-[var(--j-red)] text-white hover:bg-[var(--j-red)]/90 gap-1.5"
              onClick={confirmDelete}
            >
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Stat tile (local helper) ────────────────────────────────────────
function StatTile({
  label, value, icon: Icon, accent,
}: {
  label: string;
  value: React.ReactNode;
  icon: LucideIcon;
  accent: string;
}) {
  return (
    <div className="jarvis-panel p-3 relative overflow-hidden">
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <div className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">{label}</div>
          <div className="mt-1 text-xl font-semibold tabular-nums" style={{ color: accent }}>
            {value}
          </div>
        </div>
        <div
          className="flex h-8 w-8 items-center justify-center rounded-md shrink-0"
          style={{ background: `${accent}1a`, border: `1px solid ${accent}33`, color: accent }}
        >
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <div
        className="absolute bottom-0 left-0 h-[2px]"
        style={{ width: '40%', background: `linear-gradient(90deg, ${accent}, transparent)` }}
      />
    </div>
  );
}
