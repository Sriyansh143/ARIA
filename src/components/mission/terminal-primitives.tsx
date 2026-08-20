"use client";

import { motion } from "framer-motion";

/**
 * Terminal primitives — Monolith-inspired UI kit.
 *
 * A small set of server-component-friendly primitives inspired by the
 * FounderOS-DEMO `terminal.tsx`. These enforce the "instrumentation"
 * aesthetic: square LEDs with steps(1) blink, color-mix badge tints,
 * label-with-flex-rule, and inline SVG sparklines.
 *
 * Color = status only. No decorative hues.
 */

type Status = "ok" | "warn" | "err" | "off" | "info";

const STATUS_COLOR: Record<Status, string> = {
  ok: "oklch(0.75 0.16 150)", // emerald
  warn: "oklch(0.78 0.15 80)", // amber
  err: "oklch(0.68 0.22 18)", // rose
  off: "oklch(0.4 0.01 250)", // dim
  info: "oklch(0.78 0.16 195)", // cyan
};

/** Square LED dot with optional hard steps(1) blink. */
export function Dot({
  status = "ok",
  blink = false,
  size = 6,
}: {
  status?: Status;
  blink?: boolean;
  size?: number;
}) {
  return (
    <span
      className={`inline-block flex-shrink-0 ${blink ? "mc-led-blink" : ""}`}
      style={{
        width: size,
        height: size,
        background: STATUS_COLOR[status],
        borderRadius: 0, // square, not circle
      }}
    />
  );
}

/** Sharp-cornered badge with color-mix tinted background. */
export function Badge({
  children,
  status = "info",
}: {
  children: React.ReactNode;
  status?: Status;
}) {
  const color = STATUS_COLOR[status];
  return (
    <span
      className="inline-flex items-center px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-[0.14em]"
      style={{
        color,
        background: `color-mix(in oklab, ${color} 9%, transparent)`,
        border: `1px solid color-mix(in oklab, ${color} 35%, transparent)`,
        borderRadius: 0,
      }}
    >
      {children}
    </span>
  );
}

/** Label with a flex rule: `LABEL count ————` pattern. */
export function Label({
  children,
  count,
  accent,
}: {
  children: React.ReactNode;
  count?: number | string;
  accent?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span
        className="font-mono text-[10px] font-bold uppercase tracking-[0.26em]"
        style={{ color: accent ?? "var(--muted-foreground)" }}
      >
        {children}
      </span>
      {count !== undefined && (
        <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
          {count}
        </span>
      )}
      <span className="h-px flex-1 bg-border/40" />
    </div>
  );
}

/** Inline SVG sparkline — 1.5px polyline + 10% area fill. */
export function Spark({
  data,
  width = 80,
  height = 20,
  color = "var(--primary)",
}: {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
}) {
  if (data.length < 2) return null;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const step = width / (data.length - 1);
  const points = data.map((v, i) => {
    const x = i * step;
    const y = height - ((v - min) / range) * height;
    return `${x},${y}`;
  });
  const polyline = points.join(" ");
  const area = `0,${height} ${polyline} ${width},${height}`;

  return (
    <svg width={width} height={height} className="inline-block">
      <polygon points={area} fill={color} opacity={0.1} />
      <polyline
        points={polyline}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="square"
        strokeLinejoin="miter"
      />
    </svg>
  );
}

/** Kbd — sharp border with border-b-2 to mimic a physical key cap. */
export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd
      className="inline-flex items-center border border-border-strong bg-background px-1.5 py-0.5 font-mono text-[9px] font-semibold text-foreground"
      style={{
        borderRadius: 0,
        borderBottomWidth: "2px",
      }}
    >
      {children}
    </kbd>
  );
}

/** PageHeader eyebrow — code-comment style `// description` prefix. */
export function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 font-mono text-[9.5px] tracking-[0.32em] text-muted-foreground">
      <span className="text-muted-foreground/50">{"//"}</span>
      <span className="uppercase">{children}</span>
    </div>
  );
}

/** Page title with optional blinking caret. */
export function PageTitle({
  children,
  caret = false,
}: {
  children: React.ReactNode;
  caret?: boolean;
}) {
  return (
    <h1
      className={`font-mono text-2xl font-bold uppercase tracking-[0.06em] text-foreground ${caret ? "mc-caret" : ""}`}
    >
      {children}
    </h1>
  );
}

/** Section head with label + optional count + right-aligned link. */
export function SectionHead({
  children,
  count,
  link,
  onLinkClick,
}: {
  children: React.ReactNode;
  count?: number | string;
  link?: string;
  onLinkClick?: () => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <Label count={count}>{children}</Label>
      {link && (
        <button
          onClick={onLinkClick}
          className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
        >
          {link} {"→"}
        </button>
      )}
    </div>
  );
}

/** StatTile — large mono number + tiny unit (instrument readout pattern). */
export function StatTile({
  value,
  unit,
  label,
  status = "info",
  spark,
}: {
  value: string | number;
  unit?: string;
  label?: string;
  status?: Status;
  spark?: number[];
}) {
  const color = STATUS_COLOR[status];
  return (
    <div className="border border-border/60 bg-card/40 p-3" style={{ borderRadius: 0 }}>
      {label && (
        <div className="mb-1 font-mono text-[9px] uppercase tracking-[0.2em] text-muted-foreground">
          {label}
        </div>
      )}
      <div className="flex items-baseline gap-1">
        <span
          className="font-mono text-[26px] font-semibold tracking-[-0.02em] tabular-nums"
          style={{ color }}
        >
          {value}
        </span>
        {unit && <span className="font-mono text-xs text-muted-foreground">{unit}</span>}
      </div>
      {spark && spark.length > 1 && (
        <div className="mt-1.5">
          <Spark data={spark} color={color} width={120} height={20} />
        </div>
      )}
    </div>
  );
}

/** ConductorEmblem — the signature "thinking" animation. */
export function ConductorEmblem({
  size = 32,
  active = false,
}: {
  size?: number;
  active?: boolean;
}) {
  return (
    <div
      className="relative flex items-center justify-center"
      style={{ width: size, height: size }}
    >
      {active && (
        <>
          {/* Comet sweep */}
          <div
            className="mc-comet absolute inset-0"
            style={{ width: size, height: size }}
          />
          {/* Heartbeat halo */}
          <div
            className="mc-heartbeat absolute inset-0 border-2"
            style={{ borderColor: "oklch(0.78 0.16 195 / 0.5)", borderRadius: 0 }}
          />
        </>
      )}
      {/* Core */}
      <motion.div
        className="relative border-2"
        style={{
          width: size * 0.5,
          height: size * 0.5,
          borderColor: active ? "var(--primary)" : "var(--muted-foreground)",
          borderRadius: 0,
        }}
        animate={active ? { scale: [1, 1.05, 1] } : {}}
        transition={{ duration: 1.9, repeat: Infinity, ease: "easeInOut" }}
      />
    </div>
  );
}

export { motion };
