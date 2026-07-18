'use client';

import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Building2, Search, Users, X, ChevronRight, Crown, User,
} from 'lucide-react';
import { useApi, patchJson } from '@/lib/hooks/use-api';
import { JARVIS } from '@/lib/config';
import { SectionTitle, StatCard, EmptyState, Pill } from '@/components/jarvis/shared';
import { useToast } from '@/hooks/use-toast';

interface Department {
  id: string; key: string; name: string; mission: string;
  headAgent: string | null; accent: string;
}
interface WorkforceAgent {
  id: string; codename: string; name: string; title: string;
  departmentKey: string; seniority: string; modelTier: string;
  skills: string; personality: string; status: string; reportsTo: string | null;
}

const SENIORITY_RANK: Record<string, number> = {
  'c-suite': 7, vp: 6, director: 5, lead: 4, senior: 3, mid: 2, junior: 1, intern: 0, specialist: 2,
};

const SENIORITY_COLOR: Record<string, string> = {
  'c-suite': JARVIS.colors.amber,
  vp: JARVIS.colors.violet,
  director: JARVIS.colors.cyan,
  lead: JARVIS.colors.green,
  senior: JARVIS.colors.cyan,
  mid: JARVIS.colors.textDim,
  junior: JARVIS.colors.textMute,
  intern: JARVIS.colors.textMute,
  specialist: JARVIS.colors.textDim,
};

export default function WorkforceTab() {
  const { data, loading, refresh } = useApi<{ departments: Department[]; agents: WorkforceAgent[] }>('/api/workforce', 15000);
  const { toast } = useToast();
  const [q, setQ] = useState('');
  const [selectedDept, setSelectedDept] = useState<string>('all');
  const [openAgent, setOpenAgent] = useState<WorkforceAgent | null>(null);

  const departments = data?.departments ?? [];
  const agents = data?.agents ?? [];

  // Build a lookup of departmentKey → department.
  const deptMap = useMemo(() => {
    const m = new Map<string, Department>();
    for (const d of departments) m.set(d.key, d);
    return m;
  }, [departments]);

  // Filter agents.
  const filtered = useMemo(() => {
    let list = agents.slice();
    if (selectedDept !== 'all') list = list.filter((a) => a.departmentKey === selectedDept);
    if (q.trim()) {
      const lc = q.toLowerCase();
      list = list.filter(
        (a) =>
          a.codename.toLowerCase().includes(lc) ||
          a.name.toLowerCase().includes(lc) ||
          a.title.toLowerCase().includes(lc),
      );
    }
    return list;
  }, [agents, q, selectedDept]);

  // Group agents by department.
  const grouped = useMemo(() => {
    const m = new Map<string, WorkforceAgent[]>();
    for (const a of filtered) {
      const list = m.get(a.departmentKey) ?? [];
      list.push(a);
      m.set(a.departmentKey, list);
    }
    // Sort each department's agents by seniority desc.
    for (const [k, list] of m.entries()) {
      list.sort((a, b) => (SENIORITY_RANK[b.seniority] ?? 0) - (SENIORITY_RANK[a.seniority] ?? 0));
      m.set(k, list);
    }
    return m;
  }, [filtered]);

  const cycleStatus = async (a: WorkforceAgent) => {
    const order = ['active', 'onboarding', 'pto', 'terminated'];
    const next = order[(order.indexOf(a.status) + 1) % order.length];
    try {
      await patchJson(`/api/workforce/${a.id}`, { status: next });
      toast({ title: `${a.codename} → ${next}` });
      refresh();
    } catch (e) {
      toast({ title: 'Failed', description: e instanceof Error ? e.message : '', variant: 'destructive' });
    }
  };

  const activeCount = agents.filter((a) => a.status === 'active').length;
  const deptCount = departments.length;
  const seniorCount = agents.filter((a) => ['c-suite', 'vp', 'director', 'lead', 'senior'].includes(a.seniority)).length;

  return (
    <div className="space-y-4">
      <SectionTitle
        title="Workforce Org Chart"
        icon={Building2}
        accent={JARVIS.colors.cyan}
        action={
          <div className="relative w-48 sm:w-64">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--j-text-mute)]" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search agents…"
              className="jarvis-mono text-xs pl-8 pr-3 py-1.5 rounded-md border border-[var(--j-border)] bg-[var(--j-panel-soft)] text-[var(--j-text)] placeholder:text-[var(--j-text-mute)] outline-none focus:border-[var(--j-cyan)] w-full"
            />
          </div>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Departments" value={deptCount} icon={Building2} accent={JARVIS.colors.cyan} />
        <StatCard label="Headcount" value={agents.length} icon={Users} accent={JARVIS.colors.violet} />
        <StatCard label="Active" value={activeCount} icon={StatusDotLed} accent={JARVIS.colors.green} />
        <StatCard label="Senior+" value={seniorCount} icon={Crown} accent={JARVIS.colors.amber} />
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setSelectedDept('all')}
          className={`jarvis-mono text-[10px] uppercase px-3 py-1.5 rounded-md border transition-colors ${selectedDept === 'all' ? 'jarvis-btn-accent border-0' : 'border-[var(--j-border)] text-[var(--j-text-dim)] hover:text-[var(--j-text)]'}`}
        >
          All
        </button>
        {departments.map((d) => (
          <button
            key={d.key}
            onClick={() => setSelectedDept(d.key)}
            className={`jarvis-mono text-[10px] uppercase px-3 py-1.5 rounded-md border transition-colors ${selectedDept === d.key ? 'jarvis-btn-accent border-0' : 'border-[var(--j-border)] text-[var(--j-text-dim)] hover:text-[var(--j-text)]'}`}
            style={selectedDept === d.key ? {} : { borderColor: `${d.accent}33` }}
          >
            {d.name}
          </button>
        ))}
        {departments.length === 0 && (
          <span className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)] px-2 py-1.5">
            No departments seeded — run seed-agents.ts
          </span>
        )}
      </div>

      {loading && !data ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className="jarvis-panel h-40 animate-pulse" />)}
        </div>
      ) : grouped.size === 0 ? (
        <EmptyState icon={Building2} message="No workforce agents yet" />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from(grouped.entries()).map(([deptKey, list]) => {
            const dept = deptMap.get(deptKey);
            const accent = dept?.accent ?? JARVIS.colors.cyan;
            return (
              <div key={deptKey} className="jarvis-panel p-4">
                <div className="flex items-center justify-between mb-3 pb-2 border-b border-[var(--j-border-soft)]">
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-sm" style={{ background: accent }} />
                    <span className="jarvis-mono text-xs uppercase tracking-widest text-[var(--j-text)]">
                      {dept?.name ?? deptKey}
                    </span>
                  </div>
                  <span className="jarvis-mono text-[10px] text-[var(--j-text-mute)]">{list.length}</span>
                </div>
                <div className="space-y-2">
                  {list.map((a, i) => {
                    const color = SENIORITY_COLOR[a.seniority] ?? JARVIS.colors.textDim;
                    const skills: string[] = (() => {
                      try { return JSON.parse(a.skills || '[]'); } catch { return []; }
                    })();
                    return (
                      <motion.button
                        key={a.id}
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: i * 0.03 }}
                        onClick={() => setOpenAgent(a)}
                        className="w-full text-left p-3 rounded-md border border-[var(--j-border-soft)] bg-[var(--j-panel-soft)] hover:border-[var(--j-cyan)]/40 transition-colors"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="jarvis-mono text-xs font-semibold" style={{ color: accent }}>
                              {a.codename}
                            </span>
                            <span className="text-xs text-[var(--j-text)] truncate">{a.name}</span>
                          </div>
                          <ChevronRight className="h-3 w-3 text-[var(--j-text-mute)] shrink-0" />
                        </div>
                        <div className="mt-1 text-[11px] text-[var(--j-text-dim)] truncate">{a.title}</div>
                        <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
                          <span
                            className="jarvis-mono text-[9px] uppercase px-1.5 py-0.5 rounded"
                            style={{ color, background: `${color}1a`, border: `1px solid ${color}33` }}
                          >
                            {a.seniority}
                          </span>
                          <StatusIndicator status={a.status} />
                          {skills.slice(0, 2).map((s) => (
                            <span key={s} className="jarvis-mono text-[9px] px-1.5 py-0.5 rounded bg-[var(--j-panel)] text-[var(--j-text-mute)] border border-[var(--j-border-soft)]">
                              {s}
                            </span>
                          ))}
                        </div>
                      </motion.button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <AnimatePresence>
        {openAgent && (
          <AgentDetail
            agent={openAgent}
            department={deptMap.get(openAgent.departmentKey)}
            onClose={() => setOpenAgent(null)}
            onCycleStatus={() => cycleStatus(openAgent)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function StatusDotLed() {
  return <span className="inline-block h-2 w-2 rounded-full bg-[var(--j-green)]" />;
}

function StatusIndicator({ status }: { status: string }) {
  const colors: Record<string, string> = {
    active: JARVIS.colors.green,
    onboarding: JARVIS.colors.cyan,
    pto: JARVIS.colors.amber,
    terminated: JARVIS.colors.red,
  };
  const color = colors[status] ?? JARVIS.colors.textMute;
  return (
    <span className="flex items-center gap-1">
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: color, boxShadow: `0 0 4px ${color}` }} />
      <span className="jarvis-mono text-[9px] uppercase" style={{ color }}>{status}</span>
    </span>
  );
}

function AgentDetail({
  agent,
  department,
  onClose,
  onCycleStatus,
}: {
  agent: WorkforceAgent;
  department?: Department;
  onClose: () => void;
  onCycleStatus: () => void;
}) {
  const skills: string[] = (() => {
    try { return JSON.parse(agent.skills || '[]'); } catch { return []; }
  })();
  let personality: Record<string, unknown> = {};
  try { personality = JSON.parse(agent.personality || '{}'); } catch { /* ignore */ }
  const accent = department?.accent ?? JARVIS.colors.cyan;
  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
    >
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        initial={{ scale: 0.96, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        className="relative w-full max-w-lg jarvis-panel p-5"
      >
        <div className="flex items-start justify-between mb-4 pb-3 border-b border-[var(--j-border-soft)]">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="jarvis-mono text-lg font-semibold" style={{ color: accent }}>{agent.codename}</span>
              <Pill color={accent}>{department?.name ?? agent.departmentKey}</Pill>
            </div>
            <div className="text-sm text-[var(--j-text)]">{agent.name}</div>
            <div className="text-xs text-[var(--j-text-dim)]">{agent.title}</div>
          </div>
          <button onClick={onClose} className="text-[var(--j-text-mute)] hover:text-[var(--j-text)]"><X className="h-4 w-4" /></button>
        </div>

        <div className="grid grid-cols-2 gap-3 mb-4">
          <Detail icon={Crown} label="Seniority" value={agent.seniority} color={SENIORITY_COLOR[agent.seniority] ?? JARVIS.colors.textDim} />
          <Detail icon={User} label="Model tier" value={agent.modelTier} color={JARVIS.colors.violet} />
          <Detail icon={Building2} label="Department" value={department?.name ?? agent.departmentKey} color={accent} />
          <Detail icon={StatusDotLed} label="Status" value={agent.status} color={JARVIS.colors.green} />
        </div>

        {agent.reportsTo && (
          <div className="mb-3 text-xs text-[var(--j-text-dim)]">
            Reports to: <span className="jarvis-mono text-[var(--j-cyan)]">{agent.reportsTo}</span>
          </div>
        )}

        <div className="mb-4">
          <div className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)] mb-2">Skills</div>
          {skills.length ? (
            <div className="flex flex-wrap gap-1.5">
              {skills.map((s) => (
                <span key={s} className="jarvis-mono text-[10px] px-2 py-1 rounded bg-[var(--j-panel-soft)] text-[var(--j-text-dim)] border border-[var(--j-border-soft)]">
                  {s}
                </span>
              ))}
            </div>
          ) : (
            <div className="text-xs text-[var(--j-text-mute)]">No skills recorded.</div>
          )}
        </div>

        {department?.mission && (
          <div className="mb-4">
            <div className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)] mb-1">Department Mission</div>
            <p className="text-xs text-[var(--j-text-dim)]">{department.mission}</p>
          </div>
        )}

        {Object.keys(personality).length > 0 && (
          <div className="mb-4">
            <div className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)] mb-1">Personality</div>
            <pre className="text-[11px] text-[var(--j-text-dim)] bg-[var(--j-panel-soft)] p-2 rounded border border-[var(--j-border-soft)] overflow-auto max-h-32 jarvis-scroll">
              {JSON.stringify(personality, null, 2)}
            </pre>
          </div>
        )}

        <button
          onClick={onCycleStatus}
          className="w-full jarvis-btn-accent border-0 py-2 text-xs rounded-md"
        >
          Cycle Status →
        </button>
      </motion.div>
    </motion.div>
  );
}

function Detail({ icon: Icon, label, value, color }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string; color: string }) {
  return (
    <div className="p-3 rounded-md border border-[var(--j-border-soft)] bg-[var(--j-panel-soft)]">
      <div className="flex items-center gap-1.5 mb-1">
        <Icon className="h-3 w-3" style={{ color }} />
        <span className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)]">{label}</span>
      </div>
      <div className="text-sm capitalize" style={{ color }}>{value}</div>
    </div>
  );
}
