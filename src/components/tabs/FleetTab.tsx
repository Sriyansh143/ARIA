'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bot, Plus, X, RefreshCw, Power } from 'lucide-react';
import { useApi, postJson, patchJson } from '@/lib/hooks/use-api';
import { JARVIS, STATUS_COLORS } from '@/lib/config';
import { SectionTitle, StatusDot, Pill, EmptyState } from '@/components/jarvis/shared';
import { useToast } from '@/hooks/use-toast';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';

interface Agent {
  id: string; name: string; codename: string; role: string; status: string;
  skills: string; model: string; taskCount: number; logCount: number;
  successRate: number; load: number; lastActive: string;
  logs?: Array<{ id: string; level: string; message: string; createdAt: string }>;
}

const STATUS_CYCLE = ['idle', 'thinking', 'working', 'error', 'offline'] as const;

export default function FleetTab() {
  const { data, loading, refresh } = useApi<{ agents: Agent[] }>('/api/agents', 8000);
  const { toast } = useToast();
  const [selected, setSelected] = useState<Agent | null>(null);
  const [spawnOpen, setSpawnOpen] = useState(false);

  const cycleStatus = async (a: Agent) => {
    const idx = STATUS_CYCLE.indexOf(a.status as never);
    const next = STATUS_CYCLE[(idx + 1) % STATUS_CYCLE.length];
    await patchJson(`/api/agents/${a.id}`, { status: next });
    toast({ title: `${a.codename} → ${next}` });
    refresh();
  };

  return (
    <div className="space-y-4">
      <SectionTitle
        title="Agent Fleet"
        icon={Bot}
        accent={JARVIS.colors.cyan}
        action={
          <div className="flex gap-2">
            <Button size="sm" variant="outline" className="jarvis-btn-accent border-0" onClick={() => setSpawnOpen(true)}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Spawn Agent
            </Button>
            <Button size="sm" variant="outline" onClick={refresh} className="border-[var(--j-border)] bg-transparent hover:bg-[var(--j-panel-soft)]">
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          </div>
        }
      />

      {loading && !data ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="jarvis-panel h-40 animate-pulse" />)}</div>
      ) : data?.agents?.length ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {data.agents.map((a, i) => {
            const skills: string[] = JSON.parse(a.skills || '[]');
            const color = STATUS_COLORS[a.status as keyof typeof STATUS_COLORS] ?? JARVIS.colors.textDim;
            return (
              <motion.div
                key={a.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.03 }}
                className="jarvis-panel jarvis-card-hover p-4 cursor-pointer"
                onClick={() => openDetail(a, setSelected)}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2.5">
                    <StatusDot status={a.status as never} size={10} />
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="jarvis-mono text-sm font-bold" style={{ color }}>{a.codename}</span>
                      </div>
                      <div className="text-[11px] text-[var(--j-text-mute)]">{a.name}</div>
                    </div>
                  </div>
                  <Pill color={color}>{a.status}</Pill>
                </div>

                <div className="text-xs text-[var(--j-text-dim)] mb-3">{a.role}</div>

                <div className="grid grid-cols-3 gap-2 mb-3">
                  <MiniStat label="Load" value={`${Math.round(a.load)}%`} color={JARVIS.colors.cyan} />
                  <MiniStat label="Success" value={`${a.successRate}%`} color={JARVIS.colors.green} />
                  <MiniStat label="Tasks" value={String(a.taskCount)} color={JARVIS.colors.amber} />
                </div>

                <div className="flex flex-wrap gap-1">
                  {skills.slice(0, 4).map((s) => (
                    <span key={s} className="jarvis-mono text-[9px] uppercase px-1.5 py-0.5 rounded bg-[var(--j-panel-soft)] text-[var(--j-text-dim)] border border-[var(--j-border-soft)]">{s}</span>
                  ))}
                  {skills.length > 4 && <span className="jarvis-mono text-[9px] text-[var(--j-text-mute)]">+{skills.length - 4}</span>}
                </div>

                <div className="flex items-center justify-between mt-3 pt-3 border-t border-[var(--j-border-soft)]">
                  <span className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)]">{a.model}</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); cycleStatus(a); }}
                    className="jarvis-mono text-[9px] uppercase text-[var(--j-cyan)] hover:underline flex items-center gap-1"
                  >
                    <Power className="h-3 w-3" /> cycle
                  </button>
                </div>
              </motion.div>
            );
          })}
        </div>
      ) : (
        <EmptyState icon={Bot} message="No agents deployed" />
      )}

      {/* Detail modal */}
      <AnimatePresence>
        {selected && (
          <DetailModal agent={selected} onClose={() => setSelected(null)} onCycle={cycleStatus} />
        )}
      </AnimatePresence>

      {/* Spawn modal */}
      <AnimatePresence>
        {spawnOpen && <SpawnModal onClose={() => setSpawnOpen(false)} onDone={() => { setSpawnOpen(false); refresh(); }} />}
      </AnimatePresence>
    </div>
  );
}

async function openDetail(a: Agent, set: (a: Agent | null) => void) {
  try {
    const res = await fetch(`/api/agents/${a.id}`, { cache: 'no-store' });
    const json = await res.json();
    set(json.agent);
  } catch {
    set(a);
  }
}

function MiniStat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="text-center py-1.5 rounded bg-[var(--j-panel-soft)]/50 border border-[var(--j-border-soft)]">
      <div className="text-sm font-semibold" style={{ color }}>{value}</div>
      <div className="jarvis-mono text-[8px] uppercase text-[var(--j-text-mute)]">{label}</div>
    </div>
  );
}

function DetailModal({ agent, onClose, onCycle }: { agent: Agent; onClose: () => void; onCycle: (a: Agent) => void }) {
  const skills: string[] = JSON.parse(agent.skills || '[]');
  const color = STATUS_COLORS[agent.status as keyof typeof STATUS_COLORS] ?? JARVIS.colors.textDim;
  return (
    <motion.div className="fixed inset-0 z-50 flex items-center justify-center p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <motion.div initial={{ scale: 0.96, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.96, opacity: 0 }} className="relative w-full max-w-lg jarvis-panel p-0 overflow-hidden max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-[var(--j-border)]">
          <div className="flex items-center gap-3">
            <StatusDot status={agent.status as never} size={12} />
            <div>
              <div className="jarvis-mono text-lg font-bold" style={{ color }}>{agent.codename}</div>
              <div className="text-xs text-[var(--j-text-dim)]">{agent.role}</div>
            </div>
          </div>
          <button onClick={onClose} className="text-[var(--j-text-mute)] hover:text-[var(--j-text)]"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-4 overflow-y-auto jarvis-scroll space-y-4">
          <div className="grid grid-cols-4 gap-2">
            <MiniStat label="Load" value={`${Math.round(agent.load)}%`} color={JARVIS.colors.cyan} />
            <MiniStat label="Success" value={`${agent.successRate}%`} color={JARVIS.colors.green} />
            <MiniStat label="Tasks" value={String(agent.taskCount)} color={JARVIS.colors.amber} />
            <MiniStat label="Logs" value={String(agent.logCount)} color={JARVIS.colors.violet} />
          </div>
          <div>
            <div className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)] mb-1.5">Skills</div>
            <div className="flex flex-wrap gap-1.5">
              {skills.map((s) => <span key={s} className="jarvis-mono text-[10px] uppercase px-2 py-1 rounded bg-[var(--j-panel-soft)] text-[var(--j-cyan)] border border-[var(--j-border)]">{s}</span>)}
            </div>
          </div>
          <div>
            <div className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)] mb-1.5">Recent Logs</div>
            <div className="space-y-1.5 max-h-48 overflow-y-auto jarvis-scroll">
              {agent.logs?.length ? agent.logs.map((l) => (
                <div key={l.id} className="flex items-start gap-2 text-xs">
                  <span className="jarvis-mono text-[9px] uppercase px-1 py-0.5 rounded shrink-0" style={{ color: levelColor(l.level), background: `${levelColor(l.level)}1a`, border: `1px solid ${levelColor(l.level)}33` }}>{l.level}</span>
                  <span className="text-[var(--j-text-dim)]">{l.message}</span>
                </div>
              )) : <div className="text-xs text-[var(--j-text-mute)]">No recent logs</div>}
            </div>
          </div>
          <div className="flex gap-2">
            <Button size="sm" className="flex-1 jarvis-btn-accent border-0" onClick={() => onCycle(agent)}>
              <Power className="h-3.5 w-3.5 mr-1" /> Cycle Status
            </Button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

function levelColor(l: string): string {
  switch (l) {
    case 'success': return JARVIS.colors.green;
    case 'warn': return JARVIS.colors.amber;
    case 'error': return JARVIS.colors.red;
    case 'debug': return JARVIS.colors.textMute;
    default: return JARVIS.colors.cyan;
  }
}

function SpawnModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { toast } = useToast();
  const [name, setName] = useState('');
  const [codename, setCodename] = useState('');
  const [role, setRole] = useState('');
  const [skills, setSkills] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!name || !codename) { toast({ title: 'Name and codename required', variant: 'destructive' }); return; }
    setBusy(true);
    try {
      await postJson('/api/agents', {
        name, codename, role: role || 'Generalist',
        skills: skills.split(',').map((s) => s.trim()).filter(Boolean),
      });
      toast({ title: `${codename.toUpperCase()} spawned` });
      onDone();
    } catch (e) {
      toast({ title: 'Spawn failed', description: e instanceof Error ? e.message : '', variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <motion.div className="fixed inset-0 z-50 flex items-center justify-center p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <motion.div initial={{ scale: 0.96, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.96, opacity: 0 }} className="relative w-full max-w-md jarvis-panel p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="jarvis-mono text-sm uppercase text-[var(--j-cyan)]">Spawn New Agent</h3>
          <button onClick={onClose} className="text-[var(--j-text-mute)] hover:text-[var(--j-text)]"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">Name</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Quantum" className="bg-[var(--j-panel-soft)] border-[var(--j-border)]" />
          </div>
          <div>
            <label className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">Codename</label>
            <Input value={codename} onChange={(e) => setCodename(e.target.value.toUpperCase())} placeholder="e.g. QUANTUM" className="bg-[var(--j-panel-soft)] border-[var(--j-border)] jarvis-mono" />
          </div>
          <div>
            <label className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">Role</label>
            <Input value={role} onChange={(e) => setRole(e.target.value)} placeholder="e.g. Security Analyst" className="bg-[var(--j-panel-soft)] border-[var(--j-border)]" />
          </div>
          <div>
            <label className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">Skills (comma-separated)</label>
            <Textarea value={skills} onChange={(e) => setSkills(e.target.value)} placeholder="research, summarize, alerts" className="bg-[var(--j-panel-soft)] border-[var(--j-border)] min-h-[60px]" />
          </div>
          <Button onClick={submit} disabled={busy} className="w-full jarvis-btn-accent border-0">
            {busy ? 'Spawning…' : 'Deploy Agent'}
          </Button>
        </div>
      </motion.div>
    </motion.div>
  );
}
