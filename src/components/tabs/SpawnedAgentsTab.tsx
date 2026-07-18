'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Users, Bot, Copy, Clock, Trash2, RefreshCw, Plus, DollarSign, Zap,
  Loader2, Skull, History,
} from 'lucide-react';
import { useApi, postJson, deleteJson } from '@/lib/hooks/use-api';
import { JARVIS, timeAgo } from '@/lib/config';
import { SectionTitle, StatCard, Pill, EmptyState } from '@/components/jarvis/shared';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';

interface SpawnedAgent {
  id: string;
  agentId: string;
  codename: string;
  name: string;
  parentId: string;
  parentAgentId?: string | null;
  role: string;
  skills: string[];
  model: string;
  status: string;
  taskCount: number;
  earnings: number;
  spawnedReason?: string | null;
  lastUsed: string;
  expiresAt?: string | null;
  createdAt: string;
}

interface SpawnedLog {
  id: string;
  logId: string;
  codename: string;
  name: string;
  parentId: string;
  role: string;
  skills: string[];
  model: string;
  totalEarnings: number;
  totalTasks: number;
  spawnCount: number;
  firstSpawnedAt: string;
  lastActiveAt: string;
}

interface SpawnData {
  active: SpawnedAgent[];
  logs: SpawnedLog[];
  stats: {
    active: number;
    retired: number;
    respawnable: number;
    totalEarnings: number;
    totalTasks: number;
  };
}

interface AgentRosterItem { codename: string; name: string; role: string; }

const PARENT_OPTIONS: AgentRosterItem[] = [
  { codename: 'ORION', name: 'Orion', role: 'Lead Orchestrator' },
  { codename: 'VEGA', name: 'Vega', role: 'Research Analyst' },
  { codename: 'ATLAS', name: 'Atlas', role: 'Code Engineer' },
  { codename: 'NOVA', name: 'Nova', role: 'Data Scientist' },
  { codename: 'ECHO', name: 'Echo', role: 'Communications' },
  { codename: 'SAGE', name: 'Sage', role: 'Knowledge Keeper' },
  { codename: 'FORGE', name: 'Forge', role: 'Build & Deploy' },
  { codename: 'PULSE', name: 'Pulse', role: 'Monitoring' },
];

const ROLE_PRESETS = [
  'Research Sub-Agent', 'Code Sub-Agent', 'Data Sub-Agent', 'Comms Sub-Agent',
  'Memory Sub-Agent', 'Build Sub-Agent', 'Monitor Sub-Agent', 'Custom',
];

const STATUS_COLOR: Record<string, string> = {
  active: JARVIS.colors.green,
  retired: JARVIS.colors.textMute,
  expired: JARVIS.colors.red,
};

export default function SpawnedAgentsTab() {
  const { toast } = useToast();
  const { data, loading, refresh } = useApi<SpawnData>('/api/agents/spawn', 10000);
  const [spawnOpen, setSpawnOpen] = useState(false);
  const [spawning, setSpawning] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [parent, setParent] = useState('ORION');
  const [role, setRole] = useState('Research Sub-Agent');
  const [skills, setSkills] = useState('');
  const [reason, setReason] = useState('');
  const [model, setModel] = useState('glm-4.6');

  const doSpawn = async (respawnLogId?: string) => {
    setSpawning(true);
    try {
      const payload: Record<string, unknown> = { model };
      if (respawnLogId) {
        payload.respawnFromLogId = respawnLogId;
        payload.parentCodename = '';
      } else {
        payload.parentCodename = parent;
        payload.role = role === 'Custom' ? 'Sub Agent' : role;
        payload.skills = skills.split(',').map((s) => s.trim()).filter(Boolean);
        payload.reason = reason.trim() || undefined;
      }
      const res = await postJson<{ spawned?: SpawnedAgent; error?: string }>(
        '/api/agents/spawn',
        payload,
      );
      if (res.error || !res.spawned) {
        throw new Error(res.error || 'spawn failed');
      }
      toast({
        title: respawnLogId ? 'Sub-agent respawned' : 'Sub-agent spawned',
        description: res.spawned.codename,
      });
      setSpawnOpen(false);
      setSkills('');
      setReason('');
      refresh();
    } catch (e) {
      toast({
        title: 'Spawn failed',
        description: e instanceof Error ? e.message : '',
        variant: 'destructive',
      });
    } finally {
      setSpawning(false);
    }
  };

  const doAction = async (a: SpawnedAgent, action: 'touch' | 'retire' | 'record-earnings') => {
    let amount: number | undefined;
    if (action === 'record-earnings') {
      const raw = window.prompt(`Record earnings for ${a.codename} (₹):`, '100');
      if (raw === null) return;
      amount = Number(raw);
      if (!Number.isFinite(amount) || amount <= 0) {
        toast({ title: 'Invalid amount', variant: 'destructive' });
        return;
      }
    }
    try {
      const body: Record<string, unknown> = { action };
      if (amount !== undefined) body.amount = amount;
      await postJson(`/api/agents/spawn/${a.id}`, body);
      toast({
        title:
          action === 'touch' ? 'Heartbeat sent' :
          action === 'retire' ? 'Sub-agent retired' :
          `Earnings recorded (₹${amount})`,
        description: a.codename,
      });
      refresh();
    } catch (e) {
      toast({
        title: 'Action failed',
        description: e instanceof Error ? e.message : '',
        variant: 'destructive',
      });
    }
  };

  const doDelete = async (a: SpawnedAgent) => {
    if (!window.confirm(`Delete ${a.codename}? Log entry will be preserved.`)) return;
    try {
      await deleteJson(`/api/agents/spawn/${a.id}`);
      toast({ title: 'Sub-agent deleted', description: a.codename });
      refresh();
    } catch (e) {
      toast({
        title: 'Delete failed',
        description: e instanceof Error ? e.message : '',
        variant: 'destructive',
      });
    }
  };

  const doCleanup = async () => {
    setCleaning(true);
    try {
      const res = await postJson<{ deleted: number; preservedLogs: number; message?: string }>(
        '/api/agents/spawn/cleanup',
        {},
      );
      toast({
        title: 'Cleanup complete',
        description: `Deleted ${res.deleted}, preserved ${res.preservedLogs} logs`,
      });
      refresh();
    } catch (e) {
      toast({
        title: 'Cleanup failed',
        description: e instanceof Error ? e.message : '',
        variant: 'destructive',
      });
    } finally {
      setCleaning(false);
    }
  };

  const stats = data?.stats;

  return (
    <div className="space-y-4">
      <SectionTitle
        title="Spawned Agents"
        icon={Copy}
        accent={JARVIS.colors.cyan}
        action={
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={doCleanup}
              disabled={cleaning}
              className="jarvis-mono text-[10px] uppercase border-[var(--j-border)] text-[var(--j-text-dim)] hover:text-[var(--j-amber)]"
            >
              {cleaning ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Trash2 className="h-3 w-3 mr-1" />}
              Cleanup
            </Button>
            <Button
              size="sm"
              onClick={() => setSpawnOpen(true)}
              className="jarvis-btn-accent border-0"
            >
              <Plus className="h-3 w-3 mr-1" />
              Spawn New
            </Button>
          </div>
        }
      />

      {/* Stats cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <StatCard label="Active" value={stats?.active ?? 0} icon={Bot} accent={JARVIS.colors.green} />
        <StatCard label="Retired" value={stats?.retired ?? 0} icon={Skull} accent={JARVIS.colors.textMute} />
        <StatCard label="Respawnable Logs" value={stats?.respawnable ?? 0} icon={History} accent={JARVIS.colors.violet} />
        <StatCard label="Total Earnings" value={`₹${(stats?.totalEarnings ?? 0).toLocaleString()}`} icon={DollarSign} accent={JARVIS.colors.amber} />
        <StatCard label="Total Tasks" value={stats?.totalTasks ?? 0} icon={Zap} accent={JARVIS.colors.cyan} />
      </div>

      {/* Two-column layout: active vs respawnable */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Active agents column */}
        <div className="jarvis-panel p-4">
          <SectionTitle
            title="Active Sub-Agents"
            icon={Users}
            accent={JARVIS.colors.green}
            action={<Pill color={JARVIS.colors.green}>{data?.active.length ?? 0}</Pill>}
          />
          {loading && !data ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-6 w-6 animate-spin text-[var(--j-cyan)]" />
            </div>
          ) : (data?.active?.length ?? 0) === 0 ? (
            <EmptyState icon={Bot} message="No active sub-agents" />
          ) : (
            <div className="space-y-2 max-h-[560px] overflow-y-auto jarvis-scroll pr-1">
              {data?.active.map((a) => {
                const color = STATUS_COLOR[a.status] || JARVIS.colors.cyan;
                return (
                  <motion.div
                    key={a.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="jarvis-panel p-3"
                    style={{ borderColor: `${color}33` }}
                  >
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span
                            className="inline-block h-2 w-2 rounded-full shrink-0"
                            style={{ background: color, boxShadow: `0 0 6px ${color}` }}
                          />
                          <span className="jarvis-mono text-xs text-[var(--j-text)] truncate">{a.codename}</span>
                        </div>
                        <div className="text-xs text-[var(--j-text-dim)] mt-0.5 truncate">{a.name}</div>
                      </div>
                      <span
                        className="jarvis-mono text-[9px] uppercase px-1.5 py-0.5 rounded shrink-0"
                        style={{ color, background: `${color}1a`, border: `1px solid ${color}33` }}
                      >
                        {a.status}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-2 mb-2">
                      <Pill color={JARVIS.colors.cyan}>{a.role}</Pill>
                      <Pill color={JARVIS.colors.violet}>parent: {a.parentId}</Pill>
                      <Pill color={JARVIS.colors.amber}>₹{a.earnings.toLocaleString()}</Pill>
                      <Pill color={JARVIS.colors.green}>{a.taskCount} tasks</Pill>
                    </div>
                    {a.spawnedReason && (
                      <div className="text-[10px] text-[var(--j-text-mute)] mb-2 italic truncate">
                        &ldquo;{a.spawnedReason}&rdquo;
                      </div>
                    )}
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-[10px] jarvis-mono text-[var(--j-text-mute)] flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {timeAgo(a.lastUsed)}
                      </div>
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => doAction(a, 'touch')}
                          className="h-6 px-2 text-[10px] jarvis-mono uppercase border-[var(--j-border)]"
                        >
                          <Zap className="h-3 w-3 mr-1" />
                          Touch
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => doAction(a, 'record-earnings')}
                          className="h-6 px-2 text-[10px] jarvis-mono uppercase border-[var(--j-border)]"
                        >
                          <DollarSign className="h-3 w-3 mr-1" />
                          Earn
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => doAction(a, 'retire')}
                          className="h-6 px-2 text-[10px] jarvis-mono uppercase border-[var(--j-border)] hover:text-[var(--j-amber)]"
                        >
                          <Skull className="h-3 w-3 mr-1" />
                          Retire
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => doDelete(a)}
                          className="h-6 px-2 text-[10px] jarvis-mono uppercase border-[var(--j-border)] hover:text-[var(--j-red)]"
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

        {/* Respawnable logs column */}
        <div className="jarvis-panel p-4">
          <SectionTitle
            title="Respawnable Logs"
            icon={History}
            accent={JARVIS.colors.violet}
            action={<Pill color={JARVIS.colors.violet}>{data?.logs.length ?? 0}</Pill>}
          />
          {loading && !data ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-6 w-6 animate-spin text-[var(--j-violet)]" />
            </div>
          ) : (data?.logs?.length ?? 0) === 0 ? (
            <EmptyState icon={History} message="No respawnable logs yet" />
          ) : (
            <div className="space-y-2 max-h-[560px] overflow-y-auto jarvis-scroll pr-1">
              {data?.logs.map((log) => (
                <motion.div
                  key={log.id}
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="jarvis-panel p-3"
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="min-w-0 flex-1">
                      <div className="jarvis-mono text-xs text-[var(--j-text)] truncate">{log.codename}</div>
                      <div className="text-xs text-[var(--j-text-dim)] mt-0.5 truncate">{log.name}</div>
                    </div>
                    <Pill color={JARVIS.colors.violet}>×{log.spawnCount}</Pill>
                  </div>
                  <div className="flex flex-wrap gap-2 mb-2">
                    <Pill color={JARVIS.colors.cyan}>{log.role}</Pill>
                    <Pill color={JARVIS.colors.amber}>₹{log.totalEarnings.toLocaleString()}</Pill>
                    <Pill color={JARVIS.colors.green}>{log.totalTasks} tasks</Pill>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-[10px] jarvis-mono text-[var(--j-text-mute)] flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      last: {timeAgo(log.lastActiveAt)}
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => doSpawn(log.logId)}
                      disabled={spawning}
                      className="h-6 px-2 text-[10px] jarvis-mono uppercase border-[var(--j-border)] hover:text-[var(--j-violet)]"
                    >
                      <RefreshCw className="h-3 w-3 mr-1" />
                      Respawn
                    </Button>
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Spawn dialog */}
      <Dialog open={spawnOpen} onOpenChange={setSpawnOpen}>
        <DialogContent className="bg-[var(--j-panel)] border-[var(--j-border)] text-[var(--j-text)]">
          <DialogHeader>
            <DialogTitle className="jarvis-mono text-sm uppercase tracking-widest text-[var(--j-cyan)]">
              Spawn Sub-Agent
            </DialogTitle>
            <DialogDescription className="text-[var(--j-text-dim)] text-xs">
              Heavy-load agents can spawn sub-agents. Auto-expires after 30 days; logs preserved for respawn.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-[10px] uppercase jarvis-mono text-[var(--j-text-mute)]">Parent</Label>
                <Select value={parent} onValueChange={setParent}>
                  <SelectTrigger className="bg-[var(--j-bg)] border-[var(--j-border)] text-[var(--j-text)] text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-[var(--j-panel)] border-[var(--j-border)] text-[var(--j-text)]">
                    {PARENT_OPTIONS.map((p) => (
                      <SelectItem key={p.codename} value={p.codename} className="text-xs">
                        {p.codename} · {p.role}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-[10px] uppercase jarvis-mono text-[var(--j-text-mute)]">Role</Label>
                <Select value={role} onValueChange={setRole}>
                  <SelectTrigger className="bg-[var(--j-bg)] border-[var(--j-border)] text-[var(--j-text)] text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-[var(--j-panel)] border-[var(--j-border)] text-[var(--j-text)]">
                    {ROLE_PRESETS.map((r) => (
                      <SelectItem key={r} value={r} className="text-xs">{r}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label className="text-[10px] uppercase jarvis-mono text-[var(--j-text-mute)]">Skills (comma-separated)</Label>
              <Input
                value={skills}
                onChange={(e) => setSkills(e.target.value)}
                placeholder="web-search, summarize, code-gen"
                className="bg-[var(--j-bg)] border-[var(--j-border)] text-[var(--j-text)] text-xs"
              />
            </div>

            <div>
              <Label className="text-[10px] uppercase jarvis-mono text-[var(--j-text-mute)]">Spawn Reason</Label>
              <Input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="High load on parent — offload research"
                className="bg-[var(--j-bg)] border-[var(--j-border)] text-[var(--j-text)] text-xs"
              />
            </div>

            <div>
              <Label className="text-[10px] uppercase jarvis-mono text-[var(--j-text-mute)]">Model</Label>
              <Input
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="glm-4.6"
                className="bg-[var(--j-bg)] border-[var(--j-border)] text-[var(--j-text)] text-xs"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setSpawnOpen(false)} className="border-[var(--j-border)] text-[var(--j-text-dim)]">
              Cancel
            </Button>
            <Button onClick={() => doSpawn()} disabled={spawning} className="jarvis-btn-accent border-0">
              {spawning ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Plus className="h-3 w-3 mr-1" />}
              Spawn
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
            <RefreshCw className="h-3 w-3 animate-spin text-[var(--j-cyan)]" />
            <span className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">syncing…</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
