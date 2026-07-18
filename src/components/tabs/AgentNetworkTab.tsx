'use client';

/**
 * AgentNetworkTab — Full-screen animated visualization of the 17-agent
 * hierarchy. CEO at top → C-Suite row → Specialists. SVG edges with flowing
 * data-packet dots, framer-motion entrance + status pulse, click-to-inspect
 * detail panel, live status polling every 10s, mobile-responsive grid fallback.
 */

import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Share2, Eye, Cog, Shield, X, Layers, Zap, Users, Clock,
  ChevronRight, RefreshCw, type LucideIcon,
} from 'lucide-react';
import { useApi } from '@/lib/hooks/use-api';
import { JARVIS } from '@/lib/config';
import { cn } from '@/lib/utils';
import {
  ALL_AGENT_PERSONAS,
  type AgentPersona,
  type Department,
  type AgentType,
} from '@/lib/agent-registry';
import { SectionTitle, Pill } from '@/components/jarvis/shared';

/* ----------------------------- Visual constants ---------------------------- */

const VIEW_W = 1280;
const VIEW_H = 680;

/** Department → accent color (per task spec). */
const DEPT_COLORS: Record<Department, string> = {
  engineering: '#22D3EE', // cyan
  marketing: '#C4B5FD', // violet
  operations: '#34D399', // green
  finance: '#FBBF24', // amber
  testing: '#F87171', // red
  security: '#F87171', // red
  design: '#F472B6', // pink
  product: '#22D3EE', // cyan
};

const DEPT_LABELS: Record<Department, string> = {
  engineering: 'Engineering',
  marketing: 'Marketing',
  operations: 'Operations',
  finance: 'Finance',
  testing: 'Testing',
  security: 'Security',
  design: 'Design',
  product: 'Product',
};

/** Live status → color (per task spec: working=cyan, idle=gray, error=red, thinking=violet). */
const STATUS_COLORS: Record<string, string> = {
  working: '#22D3EE',
  thinking: '#C4B5FD',
  idle: '#64748B',
  error: '#F87171',
  offline: '#475569',
};

const TYPE_LABELS: Record<AgentType, string> = {
  monitor: 'Monitoring',
  exec: 'Executing',
  'error-handler': 'Error Handler',
};

/* --------------------------- Layout (codename→xy) -------------------------- */
/**
 * Fixed virtual coordinate system inside an SVG viewBox 1280×680.
 *   Row 0 (y=70):  ORION (CEO, center)
 *   Row 1 (y=220): 4 C-Suite directors — ATLAS / ECHO / APEX / PULSE
 *   Row 2 (y=380+): specialists stacked under each supervisor
 * HERMES + SAGE report directly to ORION and sit in the central column
 * below the CEO (the gap between ECHO and APEX).
 */
const LAYOUT: Record<string, { x: number; y: number }> = {
  ORION: { x: VIEW_W / 2, y: 70 },

  ATLAS: { x: VIEW_W * 0.13, y: 220 },
  ECHO: { x: VIEW_W * 0.38, y: 220 },
  APEX: { x: VIEW_W * 0.62, y: 220 },
  PULSE: { x: VIEW_W * 0.87, y: 220 },

  // Engineering (reports to ATLAS)
  FORGE: { x: VIEW_W * 0.13, y: 380 },
  CRONOS: { x: VIEW_W * 0.13, y: 445 },
  DAEDALUS: { x: VIEW_W * 0.13, y: 510 },
  VEGA: { x: VIEW_W * 0.13, y: 575 },

  // Marketing (reports to ECHO)
  ANDROMEDA: { x: VIEW_W * 0.38, y: 380 },
  ANTARES: { x: VIEW_W * 0.38, y: 445 },
  CALLIOPE: { x: VIEW_W * 0.38, y: 510 },

  // Operations (reports to ORION, central column)
  HERMES: { x: VIEW_W * 0.5, y: 380 },
  SAGE: { x: VIEW_W * 0.5, y: 445 },

  // Finance (reports to APEX)
  HALCYON: { x: VIEW_W * 0.62, y: 380 },

  // Error handling (reports to PULSE)
  BASTION: { x: VIEW_W * 0.87, y: 380 },
  LABYRINTH: { x: VIEW_W * 0.87, y: 445 },
};

/* -------------------------------- Helpers --------------------------------- */

function TypeIcon({ type, className }: { type: AgentType; className?: string }) {
  if (type === 'monitor') return <Eye className={className} />;
  if (type === 'error-handler') return <Shield className={className} />;
  return <Cog className={className} />;
}

interface LiveAgent { codename: string; status: string; load: number }
interface AgentsResponse { agents: LiveAgent[] }

interface Edge {
  source: string;
  target: string;
  x1: number; y1: number;
  x2: number; y2: number;
}

/* ============================== Main Component ============================= */

export default function AgentNetworkTab() {
  const { data: liveData, refresh } = useApi<AgentsResponse>('/api/agents', 10000);

  const liveMap = useMemo(() => {
    const m: Record<string, { status: string; load: number }> = {};
    for (const a of liveData?.agents ?? []) {
      m[a.codename.toUpperCase()] = { status: a.status, load: a.load };
    }
    return m;
  }, [liveData]);

  const personas = ALL_AGENT_PERSONAS;

  const [selected, setSelected] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);

  /** Edges derived from persona.reportsTo. */
  const edges = useMemo<Edge[]>(() => {
    return personas
      .filter(p => p.reportsTo && LAYOUT[p.codename] && LAYOUT[p.reportsTo])
      .map(p => ({
        source: p.reportsTo!,
        target: p.codename,
        x1: LAYOUT[p.reportsTo!].x,
        y1: LAYOUT[p.reportsTo!].y,
        x2: LAYOUT[p.codename].x,
        y2: LAYOUT[p.codename].y,
      }));
  }, [personas]);

  /** When an agent is hovered/selected, highlight its supervisor + direct reports. */
  const connectedSet = useMemo(() => {
    const focus = hovered ?? selected;
    if (!focus) return null;
    const s = new Set<string>([focus]);
    const p = personas.find(x => x.codename === focus);
    if (p?.reportsTo) s.add(p.reportsTo);
    personas.filter(x => x.reportsTo === focus).forEach(x => s.add(x.codename));
    return s;
  }, [hovered, selected, personas]);

  const isEdgeActive = (e: Edge) =>
    connectedSet != null && connectedSet.has(e.source) && connectedSet.has(e.target);

  const isNodeDim = (codename: string) =>
    connectedSet != null && !connectedSet.has(codename);

  /** Stats bar counts. */
  const stats = useMemo(() => {
    let monitoring = 0, executing = 0, errorHandlers = 0, idle = 0, working = 0;
    for (const p of personas) {
      if (p.type === 'monitor') monitoring++;
      else if (p.type === 'error-handler') errorHandlers++;
      else executing++;
      const st = liveMap[p.codename]?.status ?? 'idle';
      if (st === 'idle' || st === 'offline') idle++;
      if (st === 'working') working++;
    }
    return { total: personas.length, monitoring, executing, errorHandlers, idle, working };
  }, [personas, liveMap]);

  const selectedPersona = selected ? personas.find(p => p.codename === selected) ?? null : null;
  const selectedLive = selected ? liveMap[selected] : undefined;

  return (
    <div className="space-y-4">
      <SectionTitle
        title="Agent Network"
        icon={Share2}
        accent={JARVIS.colors.cyan}
        action={
          <button
            onClick={refresh}
            className="flex h-8 w-8 items-center justify-center rounded-md border border-[var(--j-border)] text-[var(--j-text-dim)] hover:text-[var(--j-cyan)] transition-colors"
            aria-label="Refresh agent status"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        }
      />

      {/* ----------------------------- Stats bar ----------------------------- */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatTile label="Total Agents" value={stats.total} icon={Users} color={JARVIS.colors.cyan} delay={0} />
        <StatTile label="Monitoring" value={stats.monitoring} icon={Eye} color={JARVIS.colors.violet} delay={0.04} />
        <StatTile label="Executing" value={stats.executing} icon={Cog} color={JARVIS.colors.green} delay={0.08} />
        <StatTile label="Error Handlers" value={stats.errorHandlers} icon={Shield} color={JARVIS.colors.red} delay={0.12} />
        <StatTile label="Working" value={stats.working} icon={Zap} color={JARVIS.colors.cyan} delay={0.16} />
        <StatTile label="Idle" value={stats.idle} icon={Clock} color={JARVIS.colors.textMute} delay={0.2} />
      </div>

      {/* --------------------- Main viz + detail panel ---------------------- */}
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_340px] gap-4">
        {/* SVG canvas + card overlay (desktop) / mobile grid (below) */}
        <div className="jarvis-panel p-3 relative overflow-hidden">
          <div className="hidden lg:block">
            <div className="relative w-full" style={{ aspectRatio: `${VIEW_W} / ${VIEW_H}` }}>
              {/* SVG edge layer */}
              <svg
                viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
                preserveAspectRatio="xMidYMid meet"
                className="absolute inset-0 w-full h-full"
                style={{ pointerEvents: 'none' }}
              >
                {edges.map((e, i) => {
                  const active = isEdgeActive(e);
                  const targetStatus = liveMap[e.target]?.status ?? 'idle';
                  const isTaskEdge = targetStatus === 'working';
                  const lineColor = active ? JARVIS.colors.cyan : 'var(--j-border)';
                  return (
                    <g key={`edge-${e.source}-${e.target}`}>
                      {/* Connection line with draw-in animation */}
                      <motion.line
                        x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2}
                        stroke={lineColor}
                        strokeWidth={active ? 2 : 1}
                        strokeLinecap="round"
                        initial={{ pathLength: 0, opacity: 0 }}
                        animate={{ pathLength: 1, opacity: active ? 1 : 0.45 }}
                        transition={{ duration: 0.8, delay: 0.3 + i * 0.04, ease: 'easeOut' }}
                        style={active ? { filter: `drop-shadow(0 0 4px ${JARVIS.colors.cyan})` } : undefined}
                      />
                      {/* Ambient flow dot — slow, subtle, on every edge */}
                      <motion.circle
                        r={2}
                        fill={JARVIS.colors.cyan}
                        opacity={active ? 0.9 : 0.35}
                        initial={{ cx: e.x1, cy: e.y1 }}
                        animate={{ cx: [e.x1, e.x2], cy: [e.y1, e.y2] }}
                        transition={{ duration: 3, repeat: Infinity, ease: 'linear', delay: i * 0.15 }}
                      />
                      {/* Task packet — only when target agent is actively working */}
                      {isTaskEdge && (
                        <motion.circle
                          r={4}
                          fill={JARVIS.colors.amber}
                          initial={{ cx: e.x1, cy: e.y1 }}
                          animate={{ cx: [e.x1, e.x2], cy: [e.y1, e.y2] }}
                          transition={{ duration: 1.4, repeat: Infinity, ease: 'easeIn' }}
                          style={{ filter: `drop-shadow(0 0 6px ${JARVIS.colors.amber})` }}
                        />
                      )}
                    </g>
                  );
                })}
              </svg>

              {/* Card overlay layer */}
              {personas.map((p, i) => {
                const pos = LAYOUT[p.codename];
                if (!pos) return null;
                const live = liveMap[p.codename];
                const status = live?.status ?? 'idle';
                const load = live?.load ?? 0;
                const deptColor = DEPT_COLORS[p.department];
                const statusColor = STATUS_COLORS[status] ?? STATUS_COLORS.idle;
                const isCEO = p.codename === 'ORION';
                const dim = isNodeDim(p.codename);
                const isFocus = (hovered ?? selected) === p.codename;
                const pulsing = status === 'working' || status === 'thinking';
                return (
                  <motion.button
                    key={p.codename}
                    type="button"
                    initial={{ opacity: 0, scale: 0.85 }}
                    animate={{ opacity: dim ? 0.3 : 1, scale: 1 }}
                    transition={{ duration: 0.4, delay: 0.1 + i * 0.04, ease: 'easeOut' }}
                    whileHover={{ scale: 1.06, transition: { duration: 0.15 } }}
                    onClick={() => setSelected(p.codename)}
                    onMouseEnter={() => setHovered(p.codename)}
                    onMouseLeave={() => setHovered(null)}
                    onFocus={() => setHovered(p.codename)}
                    onBlur={() => setHovered(null)}
                    aria-label={`Agent ${p.codename} — ${p.role} (${status})`}
                    className={cn(
                      'absolute -translate-x-1/2 -translate-y-1/2 text-left rounded-lg border bg-[var(--j-panel)]/95 backdrop-blur-sm cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--j-cyan)] hover:z-20',
                      isCEO && 'ring-1 ring-[var(--j-cyan)]/30',
                    )}
                    style={{
                      left: `${(pos.x / VIEW_W) * 100}%`,
                      top: `${(pos.y / VIEW_H) * 100}%`,
                      width: isCEO ? 172 : 152,
                      borderColor: isFocus ? statusColor : `${deptColor}55`,
                      boxShadow: isFocus
                        ? `0 0 16px ${statusColor}66, 0 0 0 1px ${statusColor}`
                        : pulsing
                          ? `0 0 8px ${statusColor}33`
                          : 'none',
                    }}
                  >
                    {/* Header: status dot + codename + type icon */}
                    <div className="flex items-center gap-2 px-2.5 pt-2">
                      <span
                        className={cn('inline-block rounded-full', pulsing && 'jarvis-pulse-dot')}
                        style={{ width: 8, height: 8, background: statusColor, boxShadow: `0 0 8px ${statusColor}` }}
                      />
                      <span
                        className="jarvis-mono text-xs font-bold tracking-wide truncate"
                        style={{ color: deptColor }}
                      >
                        {p.codename}
                      </span>
                      <span className="ml-auto opacity-70" style={{ color: deptColor }} aria-hidden>
                        <TypeIcon type={p.type} className="h-3 w-3" />
                      </span>
                    </div>
                    {/* Role line */}
                    <div className="px-2.5 pb-1 text-[10px] text-[var(--j-text-dim)] truncate">{p.role}</div>
                    {/* Load bar + status label */}
                    <div className="px-2.5 pb-2">
                      <div className="h-1 rounded-full bg-[var(--j-border)] overflow-hidden">
                        <motion.div
                          className="h-full rounded-full"
                          style={{ background: statusColor }}
                          initial={{ width: 0 }}
                          animate={{ width: `${Math.min(100, load)}%` }}
                          transition={{ duration: 0.8, ease: 'easeOut' }}
                        />
                      </div>
                      <div className="mt-1 flex items-center justify-between jarvis-mono text-[9px] uppercase">
                        <span style={{ color: statusColor }}>{status}</span>
                        <span className="text-[var(--j-text-mute)]">{Math.round(load)}%</span>
                      </div>
                    </div>
                  </motion.button>
                );
              })}
            </div>
          </div>

          {/* Mobile / tablet fallback: stacked grid grouped by supervisor */}
          <div className="lg:hidden">
            <MobileAgentGrid
              personas={personas}
              liveMap={liveMap}
              selected={selected}
              onSelect={setSelected}
            />
          </div>
        </div>

        {/* --------------------------- Detail panel --------------------------- */}
        <div className="jarvis-panel p-4 min-h-[400px] max-h-[760px] overflow-y-auto">
          <AnimatePresence mode="wait">
            {selectedPersona ? (
              <motion.div
                key={selectedPersona.codename}
                initial={{ opacity: 0, x: 12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -12 }}
                transition={{ duration: 0.25 }}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <div
                      className="flex h-9 w-9 items-center justify-center rounded-md shrink-0"
                      style={{
                        background: `${DEPT_COLORS[selectedPersona.department]}1a`,
                        border: `1px solid ${DEPT_COLORS[selectedPersona.department]}55`,
                        color: DEPT_COLORS[selectedPersona.department],
                      }}
                    >
                      <TypeIcon type={selectedPersona.type} className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <div
                        className="jarvis-mono text-sm font-bold truncate"
                        style={{ color: DEPT_COLORS[selectedPersona.department] }}
                      >
                        {selectedPersona.codename}
                      </div>
                      <div className="text-[10px] text-[var(--j-text-mute)] truncate">
                        {selectedPersona.name} · {selectedPersona.title}
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => setSelected(null)}
                    className="text-[var(--j-text-mute)] hover:text-[var(--j-text)] transition-colors shrink-0"
                    aria-label="Close detail panel"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                {/* Live status + load tiles */}
                <div className="mb-3 grid grid-cols-2 gap-2">
                  <div className="rounded-md border border-[var(--j-border)] p-2">
                    <div className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)]">Status</div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span
                        className={cn(
                          'inline-block rounded-full',
                          (selectedLive?.status === 'working' || selectedLive?.status === 'thinking') && 'jarvis-pulse-dot',
                        )}
                        style={{
                          width: 8,
                          height: 8,
                          background: STATUS_COLORS[selectedLive?.status ?? 'idle'] ?? STATUS_COLORS.idle,
                          boxShadow: `0 0 8px ${STATUS_COLORS[selectedLive?.status ?? 'idle'] ?? STATUS_COLORS.idle}`,
                        }}
                      />
                      <span
                        className="jarvis-mono text-xs capitalize"
                        style={{ color: STATUS_COLORS[selectedLive?.status ?? 'idle'] ?? STATUS_COLORS.idle }}
                      >
                        {selectedLive?.status ?? 'idle'}
                      </span>
                    </div>
                  </div>
                  <div className="rounded-md border border-[var(--j-border)] p-2">
                    <div className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)]">Load</div>
                    <div className="jarvis-mono text-xs text-[var(--j-text)] mt-0.5">
                      {Math.round(selectedLive?.load ?? 0)}%
                    </div>
                  </div>
                </div>

                <DetailRow label="Department" value={DEPT_LABELS[selectedPersona.department]} accent={DEPT_COLORS[selectedPersona.department]} />
                <DetailRow label="Type" value={TYPE_LABELS[selectedPersona.type]} />
                <DetailRow label="Seniority" value={selectedPersona.seniority} />
                <DetailRow label="Reports To" value={selectedPersona.reportsTo ?? '— (CEO)'} />
                <DetailRow label="Max Iterations" value={String(selectedPersona.maxIterations)} />
                <DetailRow label="Max RPM" value={String(selectedPersona.maxRpm)} />

                <DetailBlock label="Persona">{selectedPersona.persona}</DetailBlock>
                <DetailBlock label="Goal">{selectedPersona.goal}</DetailBlock>
                <DetailBlock label="Backstory">{selectedPersona.backstory}</DetailBlock>

                <div className="mt-3">
                  <div className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)] mb-1.5">Model Preference</div>
                  <div className="flex flex-wrap gap-1.5">
                    {selectedPersona.modelPreference.map((m, i) => (
                      <Pill key={m} color={i === 0 ? JARVIS.colors.green : JARVIS.colors.textDim}>
                        {m}{i === 0 ? ' · primary' : ''}
                      </Pill>
                    ))}
                  </div>
                </div>

                <div className="mt-3">
                  <div className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)] mb-1.5">Skills</div>
                  <div className="flex flex-wrap gap-1.5">
                    {selectedPersona.skills.map(s => (
                      <Pill key={s} color={DEPT_COLORS[selectedPersona.department]}>{s}</Pill>
                    ))}
                  </div>
                </div>

                {/* Direct reports — clickable to drill in */}
                {(() => {
                  const reports = personas.filter(p => p.reportsTo === selectedPersona.codename);
                  if (reports.length === 0) return null;
                  return (
                    <div className="mt-3">
                      <div className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)] mb-1.5">
                        Direct Reports ({reports.length})
                      </div>
                      <div className="space-y-1">
                        {reports.map(r => {
                          const rStatus = liveMap[r.codename]?.status ?? 'idle';
                          return (
                            <button
                              key={r.codename}
                              type="button"
                              onClick={() => setSelected(r.codename)}
                              className="w-full flex items-center gap-2 px-2 py-1.5 rounded border border-[var(--j-border)] hover:border-[var(--j-cyan)] hover:bg-[var(--j-panel-soft)]/40 transition-colors text-left"
                            >
                              <span
                                className="h-1.5 w-1.5 rounded-full shrink-0"
                                style={{ background: STATUS_COLORS[rStatus] ?? STATUS_COLORS.idle }}
                              />
                              <span
                                className="jarvis-mono text-[11px] shrink-0"
                                style={{ color: DEPT_COLORS[r.department] }}
                              >
                                {r.codename}
                              </span>
                              <span className="text-[10px] text-[var(--j-text-mute)] truncate">{r.role}</span>
                              <ChevronRight className="h-3 w-3 ml-auto text-[var(--j-text-mute)] shrink-0" />
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}
              </motion.div>
            ) : (
              <motion.div
                key="empty"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="h-full min-h-[340px] flex flex-col items-center justify-center text-center py-12"
              >
                <div
                  className="flex h-14 w-14 items-center justify-center rounded-2xl mb-3"
                  style={{
                    background: `${JARVIS.colors.cyan}1a`,
                    border: `1px solid ${JARVIS.colors.cyan}33`,
                    color: JARVIS.colors.cyan,
                  }}
                >
                  <Share2 className="h-7 w-7 opacity-70" />
                </div>
                <div className="jarvis-mono text-xs uppercase text-[var(--j-text-dim)] mb-1">Select an agent</div>
                <div className="text-[10px] text-[var(--j-text-mute)] max-w-[240px] leading-relaxed">
                  Click any node in the network to inspect its persona, skills, model preference, goal, backstory and live status.
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* -------------------------------- Legend -------------------------------- */}
      <div className="jarvis-panel p-4">
        <SectionTitle title="Legend" icon={Layers} accent={JARVIS.colors.violet} />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <div className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)] mb-2">Agent Types</div>
            <div className="flex flex-wrap gap-3">
              {(['monitor', 'exec', 'error-handler'] as AgentType[]).map(t => (
                <div key={t} className="flex items-center gap-1.5">
                  <span
                    className="flex h-6 w-6 items-center justify-center rounded-md border border-[var(--j-border)]"
                    style={{
                      color: t === 'monitor' ? JARVIS.colors.violet : t === 'error-handler' ? JARVIS.colors.red : JARVIS.colors.green,
                    }}
                  >
                    <TypeIcon type={t} className="h-3 w-3" />
                  </span>
                  <span className="text-xs text-[var(--j-text-dim)]">{TYPE_LABELS[t]}</span>
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)] mb-2">Departments</div>
            <div className="flex flex-wrap gap-3">
              {(Object.keys(DEPT_COLORS) as Department[]).map(d => (
                <div key={d} className="flex items-center gap-1.5">
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ background: DEPT_COLORS[d], boxShadow: `0 0 6px ${DEPT_COLORS[d]}` }}
                  />
                  <span className="text-xs text-[var(--j-text-dim)]">{DEPT_LABELS[d]}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="md:col-span-2">
            <div className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)] mb-2">Live Status</div>
            <div className="flex flex-wrap gap-3">
              {(['working', 'thinking', 'idle', 'error', 'offline'] as const).map(s => (
                <div key={s} className="flex items-center gap-1.5">
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ background: STATUS_COLORS[s], boxShadow: `0 0 6px ${STATUS_COLORS[s]}` }}
                  />
                  <span className="text-xs text-[var(--j-text-dim)] capitalize">{s}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ Sub-components ----------------------------- */

function StatTile({
  label, value, icon: Icon, color, delay = 0,
}: {
  label: string;
  value: number;
  icon: LucideIcon;
  color: string;
  delay?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay }}
      className="jarvis-panel p-3 flex items-center gap-3"
    >
      <div
        className="flex h-9 w-9 items-center justify-center rounded-md shrink-0"
        style={{ background: `${color}1a`, border: `1px solid ${color}33`, color }}
      >
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <div className="text-xl font-semibold leading-tight" style={{ color }}>{value}</div>
        <div className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)] truncate">{label}</div>
      </div>
    </motion.div>
  );
}

function DetailRow({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-[var(--j-border-soft)] last:border-b-0">
      <span className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)]">{label}</span>
      <span
        className="text-xs truncate ml-2 capitalize"
        style={accent ? { color: accent } : undefined}
      >
        {value}
      </span>
    </div>
  );
}

function DetailBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-3">
      <div className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)] mb-1">{label}</div>
      <div className="text-xs text-[var(--j-text-dim)] leading-relaxed">{children}</div>
    </div>
  );
}

/* --------------------------- Mobile fallback grid -------------------------- */

function MobileAgentGrid({
  personas, liveMap, selected, onSelect,
}: {
  personas: AgentPersona[];
  liveMap: Record<string, { status: string; load: number }>;
  selected: string | null;
  onSelect: (codename: string) => void;
}) {
  const groups = useMemo(() => {
    const g: Record<string, AgentPersona[]> = {};
    for (const p of personas) {
      const k = p.reportsTo ?? 'ORION (CEO)';
      (g[k] ??= []).push(p);
    }
    return g;
  }, [personas]);

  return (
    <div className="space-y-3">
      {Object.entries(groups).map(([supervisor, agents]) => (
        <div key={supervisor}>
          <div className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)] mb-2">
            Reports to <span style={{ color: JARVIS.colors.cyan }}>{supervisor}</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {agents.map((p, i) => {
              const live = liveMap[p.codename];
              const status = live?.status ?? 'idle';
              const load = live?.load ?? 0;
              const deptColor = DEPT_COLORS[p.department];
              const statusColor = STATUS_COLORS[status] ?? STATUS_COLORS.idle;
              const pulsing = status === 'working' || status === 'thinking';
              return (
                <motion.button
                  key={p.codename}
                  type="button"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: i * 0.03 }}
                  onClick={() => onSelect(p.codename)}
                  className="text-left rounded-lg border p-2 bg-[var(--j-panel-soft)]/40 transition-colors hover:border-[var(--j-cyan)]"
                  style={{
                    borderColor: selected === p.codename ? statusColor : `${deptColor}55`,
                    boxShadow: selected === p.codename ? `0 0 12px ${statusColor}55` : 'none',
                  }}
                >
                  <div className="flex items-center gap-1.5">
                    <span
                      className={cn('inline-block rounded-full', pulsing && 'jarvis-pulse-dot')}
                      style={{ width: 6, height: 6, background: statusColor, boxShadow: `0 0 6px ${statusColor}` }}
                    />
                    <span className="jarvis-mono text-[11px] font-bold truncate" style={{ color: deptColor }}>
                      {p.codename}
                    </span>
                    <span className="ml-auto opacity-70" style={{ color: deptColor }}>
                      <TypeIcon type={p.type} className="h-3 w-3" />
                    </span>
                  </div>
                  <div className="text-[9px] text-[var(--j-text-mute)] truncate mt-0.5">{p.role}</div>
                  <div className="mt-1.5 h-1 rounded-full bg-[var(--j-border)] overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${Math.min(100, load)}%`, background: statusColor }}
                    />
                  </div>
                </motion.button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
