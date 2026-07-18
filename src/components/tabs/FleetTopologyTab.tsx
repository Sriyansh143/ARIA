'use client';

import { motion } from 'framer-motion';
import { Share2, Bot, Radio, RefreshCw, ArrowRight } from 'lucide-react';
import { useApi } from '@/lib/hooks/use-api';
import { JARVIS } from '@/lib/config';
import { SectionTitle, StatCard, Pill, EmptyState } from '@/components/jarvis/shared';
import { ForceGraph, GraphLegend, type GraphNode, type GraphEdge } from '@/components/jarvis/ForceGraph';

interface TopoData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  stats: { agents: number; messages: number; edges: number; hub: string; hubDegree: number; working: number; avgLoad: number };
}

const STATUS_COLORS: Record<string, string> = {
  idle: '#7DD3FC',
  thinking: '#C4B5FD',
  working: '#34D399',
  error: '#F87171',
  offline: '#64748B',
};

export default function FleetTopologyTab() {
  const { data, loading, refresh } = useApi<TopoData>('/api/fleet/topology', 20000);

  return (
    <div className="space-y-4">
      <SectionTitle
        title="Fleet Topology"
        icon={Share2}
        accent={JARVIS.colors.cyan}
        action={
          <button onClick={refresh} className="flex h-8 w-8 items-center justify-center rounded-md border border-[var(--j-border)] text-[var(--j-text-dim)] hover:text-[var(--j-cyan)]">
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Agents" value={data?.stats.agents ?? 0} icon={Bot} accent={JARVIS.colors.cyan} />
        <StatCard label="Working" value={data?.stats.working ?? 0} icon={Bot} accent={JARVIS.colors.green} />
        <StatCard label="Comms Edges" value={data?.stats.edges ?? 0} icon={Radio} accent={JARVIS.colors.violet} />
        <StatCard label="Avg Load" value={`${data?.stats.avgLoad ?? 0}%`} icon={Share2} accent={JARVIS.colors.amber} />
      </div>

      <div className="jarvis-panel p-4">
        <SectionTitle title="Agent Network" icon={Share2} accent={JARVIS.colors.cyan} action={
          data?.stats.hub ? (
            <span className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)] flex items-center gap-1.5">
              hub: <span className="text-[var(--j-violet)]">{data.stats.hub}</span> ({data.stats.hubDegree} links)
            </span>
          ) : undefined
        } />
        {loading && !data ? (
          <div className="h-[460px] flex items-center justify-center">
            <div className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)] animate-pulse">mapping fleet…</div>
          </div>
        ) : (data?.nodes?.length ?? 0) > 0 ? (
          <>
            <ForceGraph nodes={data!.nodes} edges={data!.edges} height={460} emptyMessage="No agents" />
            <GraphLegend
              items={[
                { label: 'idle', color: STATUS_COLORS.idle },
                { label: 'thinking', color: STATUS_COLORS.thinking },
                { label: 'working', color: STATUS_COLORS.working },
                { label: 'error', color: STATUS_COLORS.error },
              ]}
            />
          </>
        ) : (
          <EmptyState icon={Share2} message="No topology data" />
        )}
      </div>

      {/* Agent roster grid with connection counts */}
      <div className="jarvis-panel p-4">
        <SectionTitle title="Agent Roster" icon={Bot} accent={JARVIS.colors.green} />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {data?.nodes.map((a, i) => {
            const color = STATUS_COLORS[a.type] ?? JARVIS.colors.textDim;
            const degree = data.edges.filter((e) => e.source === a.id || e.target === a.id).length;
            return (
              <motion.div
                key={a.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.03 }}
                className="p-3 rounded-lg border border-[var(--j-border)] bg-[var(--j-panel-soft)]/40"
              >
                <div className="flex items-center gap-2 mb-2">
                  <span className="h-2 w-2 rounded-full" style={{ background: color, boxShadow: `0 0 8px ${color}` }} />
                  <span className="jarvis-mono text-sm font-bold" style={{ color }}>{a.id}</span>
                  <span className="ml-auto jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)]">{a.type}</span>
                </div>
                <div className="text-[10px] text-[var(--j-text-dim)] mb-2 truncate">{a.meta.role as string}</div>
                <div className="flex items-center justify-between text-[10px]">
                  <span className="jarvis-mono text-[var(--j-cyan)]">{Math.round(a.meta.load as number)}%</span>
                  <span className="jarvis-mono text-[var(--j-violet)] flex items-center gap-1">
                    <ArrowRight className="h-2.5 w-2.5" />{degree} links
                  </span>
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>

      {data?.stats.hub && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="jarvis-panel p-4 flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg" style={{ background: `${JARVIS.colors.violet}1a`, border: `1px solid ${JARVIS.colors.violet}33`, color: JARVIS.colors.violet }}>
            <Radio className="h-4 w-4" />
          </div>
          <div className="flex-1">
            <div className="text-sm text-[var(--j-text)]">
              <span className="jarvis-mono text-[var(--j-violet)]">{data.stats.hub}</span> is the fleet communications hub
            </div>
            <div className="text-xs text-[var(--j-text-dim)]">{data.stats.hubDegree} active connections · {data.stats.messages} recent messages across the fleet</div>
          </div>
          <Pill color={JARVIS.colors.violet}>hub</Pill>
        </motion.div>
      )}
    </div>
  );
}
