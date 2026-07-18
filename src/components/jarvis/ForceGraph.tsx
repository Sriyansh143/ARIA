'use client';

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { JARVIS } from '@/lib/config';

export interface GraphNode {
  id: string;
  label: string;
  type: string;
  color: string;
  size?: number;
  meta?: Record<string, unknown>;
}

export interface GraphEdge {
  source: string;
  target: string;
  color?: string;
  width?: number;
  label?: string;
}

interface SimNode extends GraphNode {
  x: number;
  y: number;
  vx: number;
  vy: number;
  fx?: number;
  fy?: number;
}

/**
 * Lightweight force-directed graph renderer (SVG).
 * Runs a simple Verlet simulation: node repulsion + spring edges + centering.
 * No external graph dependency. Interactive: hover highlights a node + its neighbors.
 */
export function ForceGraph({
  nodes,
  edges,
  height = 460,
  showLabels = true,
  emptyMessage = 'No graph data',
  onNodeClick,
  highlightIds,
}: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  height?: number;
  showLabels?: boolean;
  emptyMessage?: string;
  onNodeClick?: (node: GraphNode) => void;
  highlightIds?: Set<string>;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [dims, setDims] = useState({ w: 800, h: height });
  const [hovered, setHovered] = useState<string | null>(null);
  const simRef = useRef<SimNode[]>([]);
  const [tick, setTick] = useState(0);
  const rafRef = useRef<number | null>(null);
  const draggingRef = useRef<string | null>(null);
  const dragMovedRef = useRef<boolean>(false);

  // Track container width.
  useEffect(() => {
    if (!svgRef.current) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 800;
      setDims({ w, h: height });
    });
    ro.observe(svgRef.current);
    return () => ro.disconnect();
  }, [height]);

  // Initialize / reset simulation when nodes change.
  useEffect(() => {
    const cx = dims.w / 2;
    const cy = dims.h / 2;
    const r = Math.min(dims.w, dims.h) * 0.32;
    simRef.current = nodes.map((n, i) => {
      const angle = (i / Math.max(nodes.length, 1)) * Math.PI * 2;
      return {
        ...n,
        x: cx + Math.cos(angle) * r + (Math.random() - 0.5) * 30,
        y: cy + Math.sin(angle) * r + (Math.random() - 0.5) * 30,
        vx: 0,
        vy: 0,
      };
    });
  }, [nodes, dims]);

  // Run the force simulation.
  useEffect(() => {
    if (simRef.current.length === 0) return;
    const cx = dims.w / 2;
    const cy = dims.h / 2;
    const repulsion = 4200;
    const springLen = 90;
    const springK = 0.025;
    const centerK = 0.012;
    const damping = 0.82;
    let frame = 0;
    const maxFrames = 400;

    const step = () => {
      const sn = simRef.current;
      if (sn.length === 0) return;

      // Repulsion between all pairs.
      for (let i = 0; i < sn.length; i++) {
        for (let j = i + 1; j < sn.length; j++) {
          const dx = sn[i].x - sn[j].x;
          const dy = sn[i].y - sn[j].y;
          let dist2 = dx * dx + dy * dy;
          if (dist2 < 1) dist2 = 1;
          const dist = Math.sqrt(dist2);
          const force = repulsion / dist2;
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;
          sn[i].vx += fx;
          sn[i].vy += fy;
          sn[j].vx -= fx;
          sn[j].vy -= fy;
        }
      }

      // Spring forces along edges.
      for (const e of edges) {
        const a = sn.find((n) => n.id === e.source);
        const b = sn.find((n) => n.id === e.target);
        if (!a || !b) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const diff = dist - springLen;
        const fx = (dx / dist) * diff * springK;
        const fy = (dy / dist) * diff * springK;
        if (draggingRef.current !== a.id) { a.vx += fx; a.vy += fy; }
        if (draggingRef.current !== b.id) { b.vx -= fx; b.vy -= fy; }
      }

      // Centering + integrate.
      for (const n of sn) {
        if (draggingRef.current === n.id) continue;
        n.vx += (cx - n.x) * centerK;
        n.vy += (cy - n.y) * centerK;
        n.vx *= damping;
        n.vy *= damping;
        n.x += n.vx;
        n.y += n.vy;
        // Keep within bounds.
        const pad = 30;
        n.x = Math.max(pad, Math.min(dims.w - pad, n.x));
        n.y = Math.max(pad, Math.min(dims.h - pad, n.y));
      }

      frame++;
      setTick((t) => t + 1);
      if (frame < maxFrames) {
        rafRef.current = requestAnimationFrame(step);
      }
    };

    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [edges, dims]);

  // Drag interaction.
  const onPointerDown = useCallback((e: React.PointerEvent, id: string) => {
    e.preventDefault();
    draggingRef.current = id;
    dragMovedRef.current = false;
    const node = simRef.current.find((n) => n.id === id);
    if (node) { node.fx = node.x; node.fy = node.y; }
    (e.target as Element).setPointerCapture(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!draggingRef.current || !svgRef.current) return;
    dragMovedRef.current = true;
    const rect = svgRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const node = simRef.current.find((n) => n.id === draggingRef.current);
    if (node) { node.x = x; node.y = y; node.vx = 0; node.vy = 0; }
    // Re-energize the sim for a few frames while dragging.
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    let f = 0;
    const dragStep = () => {
      const sn = simRef.current;
      const cx = dims.w / 2;
      const cy = dims.h / 2;
      for (let i = 0; i < sn.length; i++) {
        for (let j = i + 1; j < sn.length; j++) {
          const dx = sn[i].x - sn[j].x;
          const dy = sn[i].y - sn[j].y;
          let dist2 = dx * dx + dy * dy;
          if (dist2 < 1) dist2 = 1;
          const dist = Math.sqrt(dist2);
          const force = 4200 / dist2;
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;
          if (draggingRef.current !== sn[i].id) { sn[i].vx += fx; sn[i].vy += fy; }
          if (draggingRef.current !== sn[j].id) { sn[j].vx -= fx; sn[j].vy -= fy; }
        }
      }
      for (const e2 of edges) {
        const a = sn.find((n) => n.id === e2.source);
        const b = sn.find((n) => n.id === e2.target);
        if (!a || !b) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const diff = dist - 90;
        const fx = (dx / dist) * diff * 0.025;
        const fy = (dy / dist) * diff * 0.025;
        if (draggingRef.current !== a.id) { a.vx += fx; a.vy += fy; }
        if (draggingRef.current !== b.id) { b.vx -= fx; b.vy -= fy; }
      }
      for (const n of sn) {
        if (draggingRef.current === n.id) { n.x = x; n.y = y; continue; }
        n.vx += (cx - n.x) * 0.012;
        n.vy += (cy - n.y) * 0.012;
        n.vx *= 0.82;
        n.vy *= 0.82;
        n.x += n.vx;
        n.y += n.vy;
        const pad = 30;
        n.x = Math.max(pad, Math.min(dims.w - pad, n.x));
        n.y = Math.max(pad, Math.min(dims.h - pad, n.y));
      }
      setTick((t) => t + 1);
      f++;
      if (f < 60) rafRef.current = requestAnimationFrame(dragStep);
    };
    rafRef.current = requestAnimationFrame(dragStep);
  }, [edges, dims]);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    draggingRef.current = null;
    try { (e.target as Element).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
  }, []);

  // Highlight set when hovering.
  const highlightSet = useMemo(() => {
    if (!hovered) return null;
    const connected = new Set<string>([hovered]);
    for (const e of edges) {
      if (e.source === hovered) connected.add(e.target);
      if (e.target === hovered) connected.add(e.source);
    }
    return connected;
  }, [hovered, edges]);

  if (nodes.length === 0) {
    return (
      <div className="flex items-center justify-center text-sm text-[var(--j-text-mute)] jarvis-mono uppercase" style={{ height }}>
        {emptyMessage}
      </div>
    );
  }

  const sn = simRef.current;

  return (
    <svg
      ref={svgRef}
      width="100%"
      height={dims.h}
      className="overflow-visible select-none"
      style={{ cursor: 'default' }}
    >
      {/* Edges */}
      {edges.map((e, i) => {
        const a = sn.find((n) => n.id === e.source);
        const b = sn.find((n) => n.id === e.target);
        if (!a || !b) return null;
        const dim = highlightSet && !highlightSet.has(e.source) && !highlightSet.has(e.target);
        return (
          <line
            key={i}
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            stroke={e.color ?? JARVIS.colors.border}
            strokeWidth={e.width ?? 1}
            strokeOpacity={dim ? 0.1 : highlightSet ? 0.7 : 0.35}
            strokeDasharray={e.label ? '4 3' : undefined}
          >
            {e.label && (
              <title>{e.label}</title>
            )}
          </line>
        );
      })}

      {/* Nodes */}
      {sn.map((n) => {
        const r = n.size ?? 8;
        const dim = highlightSet && !highlightSet.has(n.id);
        const isHovered = hovered === n.id;
        const isMatched = highlightIds && highlightIds.has(n.id);
        const dimBySearch = highlightIds && highlightIds.size > 0 && !isMatched;
        return (
          <g
            key={n.id}
            transform={`translate(${n.x},${n.y})`}
            style={{ cursor: onNodeClick ? 'pointer' : 'grab', opacity: dim || dimBySearch ? 0.2 : 1, transition: 'opacity 0.2s' }}
            onPointerDown={(e) => onPointerDown(e, n.id)}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={onPointerUp}
            onMouseEnter={() => setHovered(n.id)}
            onMouseLeave={() => setHovered(null)}
            onClick={(e) => { if (onNodeClick && !dragMovedRef.current) { e.stopPropagation(); onNodeClick(n); } }}
          >
            {/* Search-match pulse ring */}
            {isMatched && <circle r={r + 8} fill="none" stroke={n.color} strokeWidth={1.5} opacity={0.6} className="jarvis-blink" />}
            {/* Glow ring on hover */}
            {isHovered && <circle r={r + 6} fill="none" stroke={n.color} strokeWidth={1} opacity={0.4} />}
            <circle
              r={r}
              fill={n.color}
              fillOpacity={0.2}
              stroke={n.color}
              strokeWidth={1.5}
              style={{ filter: isHovered ? `drop-shadow(0 0 8px ${n.color})` : undefined, transition: 'filter 0.2s' }}
            />
            <circle r={Math.max(2, r - 4)} fill={n.color} />
            {showLabels && (
              <text
                y={r + 12}
                textAnchor="middle"
                fill={isHovered ? 'var(--j-text)' : 'var(--j-text-dim)'}
                fontSize={10}
                className="jarvis-mono"
                style={{ pointerEvents: 'none', fontWeight: isHovered ? 600 : 400 }}
              >
                {n.label.length > 22 ? n.label.slice(0, 21) + '…' : n.label}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

/* Legend chip */
export function GraphLegend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className="flex flex-wrap gap-3 justify-center mt-2">
      {items.map((it) => (
        <span key={it.label} className="jarvis-mono text-[9px] uppercase flex items-center gap-1.5 text-[var(--j-text-dim)]">
          <span className="h-2 w-2 rounded-full" style={{ background: it.color, boxShadow: `0 0 6px ${it.color}` }} />
          {it.label}
        </span>
      ))}
    </div>
  );
}

void motion; // keep framer-motion import for tree-shaking friendliness
