'use client';

import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';
import { LucideIcon, ArrowUpRight } from 'lucide-react';
import { JARVIS, STATUS_COLORS, PRIORITY_COLORS, LEVEL_COLORS, timeAgo } from '@/lib/config';
import type { AgentStatus } from '@/lib/config';
import { useTabNav } from '@/lib/nav-store';

/* ---------- Status dot ---------- */
export function StatusDot({ status, size = 8 }: { status: AgentStatus; size?: number }) {
  const color = STATUS_COLORS[status];
  const pulse = status === 'working' || status === 'thinking';
  return (
    <span
      className={cn('inline-block rounded-full', pulse && 'jarvis-pulse-dot')}
      style={{ width: size, height: size, background: color, color, boxShadow: `0 0 8px ${color}` }}
    />
  );
}

/* ---------- Stat card ---------- */
/**
 * StatCard now supports an optional `href` (tab key) + `navContext`.
 * When provided, the card becomes a clickable button that navigates
 * to the target tab via the global nav store, with a subtle arrow
 * indicator that appears on hover.
 */
export function StatCard({
  label,
  value,
  sub,
  icon: Icon,
  accent = JARVIS.colors.cyan,
  delay = 0,
  children,
  href,
  navContext,
  onClick,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  icon?: LucideIcon;
  accent?: string;
  delay?: number;
  children?: React.ReactNode;
  /** Tab key to navigate to when the card is clicked. */
  href?: string;
  /** Optional context payload passed to the nav store on click. */
  navContext?: Record<string, string | number | boolean | undefined>;
  /** Optional direct click handler (used when href is not appropriate). */
  onClick?: () => void;
}) {
  const navigate = useTabNav();
  const clickable = Boolean(href || onClick);
  const handleClick = href
    ? () => navigate(href, navContext ?? {})
    : onClick;
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay }}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={clickable ? handleClick : undefined}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                handleClick?.();
              }
            }
          : undefined
      }
      className={cn(
        'jarvis-panel jarvis-card-hover p-4 relative overflow-hidden transition-all',
        clickable && 'cursor-pointer hover:border-[var(--j-cyan)] hover:ring-1 hover:ring-[var(--j-cyan)]/40',
      )}
    >
      {clickable && (
        <div className="absolute top-2 right-2 z-10 opacity-0 group-hover:opacity-100 transition-opacity">
          <ArrowUpRight className="h-3.5 w-3.5 text-[var(--j-cyan)]" />
        </div>
      )}
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <div className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">{label}</div>
          <div className="mt-1 text-2xl font-semibold tracking-tight" style={{ color: accent }}>
            {value}
          </div>
          {sub && <div className="mt-0.5 text-xs text-[var(--j-text-dim)]">{sub}</div>}
        </div>
        {Icon && (
          <div
            className="flex h-9 w-9 items-center justify-center rounded-lg shrink-0"
            style={{ background: `${accent}1a`, border: `1px solid ${accent}33`, color: accent }}
          >
            <Icon className="h-4 w-4" />
          </div>
        )}
      </div>
      {children && <div className="mt-3">{children}</div>}
      <div
        className="absolute bottom-0 left-0 h-[2px]"
        style={{ width: '40%', background: `linear-gradient(90deg, ${accent}, transparent)` }}
      />
    </motion.div>
  );
}

/* ---------- Radial gauge (SVG) ---------- */
export function RadialGauge({
  value,
  label,
  unit = '%',
  size = 120,
  color = JARVIS.colors.cyan,
}: {
  value: number;
  label: string;
  unit?: string;
  size?: number;
  color?: string;
}) {
  const stroke = 8;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, value));
  const offset = c - (pct / 100) * c;
  return (
    <div className="flex flex-col items-center">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle className="jarvis-ring-track" cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} />
          <circle
            className="jarvis-ring-progress"
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            strokeWidth={stroke}
            stroke={color}
            strokeDasharray={c}
            strokeDashoffset={offset}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-xl font-semibold" style={{ color }}>
            {Math.round(pct)}
            <span className="text-xs ml-0.5 text-[var(--j-text-dim)]">{unit}</span>
          </span>
        </div>
      </div>
      <div className="jarvis-mono text-[10px] uppercase mt-1 text-[var(--j-text-dim)]">{label}</div>
    </div>
  );
}

/* ---------- Section title ---------- */
export function SectionTitle({
  title,
  icon: Icon,
  action,
  accent = JARVIS.colors.cyan,
}: {
  title: string;
  icon?: LucideIcon;
  action?: React.ReactNode;
  accent?: string;
}) {
  return (
    <div className="flex items-center justify-between mb-3">
      <div className="flex items-center gap-2">
        {Icon && (
          <div
            className="flex h-7 w-7 items-center justify-center rounded-md"
            style={{ background: `${accent}1a`, border: `1px solid ${accent}33`, color: accent }}
          >
            <Icon className="h-3.5 w-3.5" />
          </div>
        )}
        <h2 className="jarvis-mono text-xs uppercase tracking-widest text-[var(--j-text)]">{title}</h2>
      </div>
      {action}
    </div>
  );
}

/* ---------- Priority badge ---------- */
export function PriorityBadge({ priority }: { priority: string }) {
  const color = PRIORITY_COLORS[priority] ?? JARVIS.colors.textDim;
  return (
    <span
      className="jarvis-mono text-[9px] uppercase px-1.5 py-0.5 rounded"
      style={{ color, background: `${color}1a`, border: `1px solid ${color}33` }}
    >
      {priority}
    </span>
  );
}

/* ---------- Level badge (logs) ---------- */
export function LevelBadge({ level }: { level: string }) {
  const color = LEVEL_COLORS[level] ?? JARVIS.colors.textDim;
  return (
    <span
      className="jarvis-mono text-[9px] uppercase px-1.5 py-0.5 rounded"
      style={{ color, background: `${color}1a`, border: `1px solid ${color}33` }}
    >
      {level}
    </span>
  );
}

/* ---------- Pill ---------- */
export function Pill({ children, color = JARVIS.colors.cyan }: { children: React.ReactNode; color?: string }) {
  return (
    <span
      className="jarvis-mono text-[9px] uppercase px-1.5 py-0.5 rounded"
      style={{ color, background: `${color}1a`, border: `1px solid ${color}33` }}
    >
      {children}
    </span>
  );
}

/* ---------- Empty state ---------- */
export function EmptyState({ icon: Icon, message }: { icon: LucideIcon; message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-10 text-[var(--j-text-mute)]">
      <Icon className="h-8 w-8 mb-2 opacity-50" />
      <div className="text-xs jarvis-mono uppercase">{message}</div>
    </div>
  );
}

/* ---------- Relative time ---------- */
export function TimeAgo({ date }: { date: string | number | Date }) {
  return <span className="text-[var(--j-text-mute)]">{timeAgo(date)}</span>;
}

/* ---------- Sparkline (tiny inline chart) ---------- */
export function Sparkline({
  data,
  color = JARVIS.colors.cyan,
  width = 80,
  height = 24,
}: {
  data: number[];
  color?: string;
  width?: number;
  height?: number;
}) {
  if (data.length < 2) return <div style={{ width, height }} />;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const pts = data
    .map((d, i) => {
      const x = (i / (data.length - 1)) * width;
      const y = height - ((d - min) / range) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg width={width} height={height} className="overflow-visible">
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={width} cy={height - ((data[data.length - 1] - min) / range) * height} r={2} fill={color} />
    </svg>
  );
}
