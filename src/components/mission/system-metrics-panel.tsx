"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import { FullScreenPanel } from "./full-screen-panel";
import {
  RadialBarChart,
  RadialBar,
  PolarAngleAxis,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import {
  Cpu,
  MemoryStick,
  HardDrive,
  ServerCog,
  Activity,
  Clock,
  Globe,
  HardDriveDownload,
  RefreshCw,
  AlertCircle,
} from "lucide-react";

// ─── Types ─────────────────────────────────────────────────────────
interface SystemMetrics {
  cpu: {
    manufacturer: string;
    brand: string;
    speed: string;
    cores: number;
    loadCurrent: number;
    loadCores: number[];
  } | null;
  memory: {
    total: number;
    used: number;
    active: number;
    available: number;
    usagePercent: number;
  } | null;
  disk: {
    total: number;
    used: number;
    available: number;
    usagePercent: number;
    fsType: string;
  } | null;
  network: {
    latencyMs: number;
    interfaces: string[];
  } | null;
  os: {
    platform: string;
    distro: string;
    release: string;
    hostname: string;
    uptime: number;
  } | null;
  process: {
    pid: number;
    memoryMB: number;
    cpuPercent: number;
    uptime: number;
  } | null;
  checkedAt: string;
}

// ─── Helpers ────────────────────────────────────────────────────────
function bytesToGB(bytes: number): string {
  if (!bytes || bytes <= 0) return "0 GB";
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function formatUptime(seconds: number): string {
  if (!seconds || seconds < 0) return "0d 0h 0m";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${d}d ${h}h ${m}m`;
}

function thresholdColor(pct: number): string {
  if (pct < 50) return "#34d399"; // emerald
  if (pct <= 80) return "#fbbf24"; // amber
  return "#f87171"; // rose
}

const TOOLTIP_STYLE = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "6px",
  fontFamily: "var(--font-mono)",
  fontSize: "10px",
  color: "var(--text)",
  padding: "6px 8px",
} as const;

/**
 * SystemMetricsPanel — real host + process metrics from /api/system-metrics.
 *
 * Polls the API every 10s. Each metric block is independently null-tolerant
 * — if the API returned partial data (e.g. disk probe failed), the gauge
 * renders a "—" placeholder rather than crashing.
 *
 * Task ID: FEATURES-ANALYTICS-METRICS
 */
export function SystemMetricsPanel() {
  const [data, setData] = useState<SystemMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const fetchMetrics = useCallback(async () => {
    try {
      const res = await fetch("/api/system-metrics", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as SystemMetrics;
      setData(json);
      setError(false);
    } catch (err) {
      console.error("system-metrics fetch failed", err);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchMetrics();
    const id = setInterval(() => {
      void fetchMetrics();
    }, 10000);
    return () => clearInterval(id);
  }, [fetchMetrics]);

  return (
    <FullScreenPanel
      title="System Metrics"
      icon={<Cpu className="h-4 w-4 text-cyan-300" />}
      actions={
        <button
          type="button"
          onClick={() => {
            setLoading(true);
            void fetchMetrics();
          }}
          title="Refresh now"
          aria-label="Refresh system metrics"
          className="flex h-7 w-7 items-center justify-center rounded-md border border-border/60 text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      }
    >
      <div className="p-3 sm:p-4">
        {loading && !data ? (
          <LoadingState />
        ) : error && !data ? (
          <ErrorState onRetry={fetchMetrics} />
        ) : data ? (
          <>
            {/* 4 gauge cards */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <GaugeCard
                title="CPU Load"
                icon={<Cpu className="h-3.5 w-3.5" />}
                pct={data.cpu?.loadCurrent ?? null}
                footer={
                  data.cpu
                    ? `${data.cpu.brand} · ${data.cpu.cores} cores`
                    : "—"
                }
                sub={
                  data.cpu
                    ? `${data.cpu.manufacturer} · ${data.cpu.speed}`
                    : "unavailable"
                }
              />
              <GaugeCard
                title="Memory Usage"
                icon={<MemoryStick className="h-3.5 w-3.5" />}
                pct={data.memory?.usagePercent ?? null}
                footer={
                  data.memory
                    ? `${bytesToGB(data.memory.active ?? data.memory.used)} / ${bytesToGB(data.memory.total)}`
                    : "—"
                }
                sub={
                  data.memory
                    ? `${bytesToGB(data.memory.available)} available`
                    : "unavailable"
                }
              />
              <GaugeCard
                title="Disk Usage"
                icon={<HardDrive className="h-3.5 w-3.5" />}
                pct={data.disk?.usagePercent ?? null}
                footer={
                  data.disk
                    ? `${bytesToGB(data.disk.used)} / ${bytesToGB(data.disk.total)}`
                    : "—"
                }
                sub={
                  data.disk
                    ? `${data.disk.fsType} · ${bytesToGB(data.disk.available)} free`
                    : "unavailable"
                }
              />
              <ProcessCard process={data.process} />
            </div>

            {/* System info bar */}
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <InfoTile
                icon={<Globe className="h-3 w-3" />}
                label="OS"
                value={
                  data.os
                    ? `${data.os.platform} · ${data.os.distro}`
                    : "unavailable"
                }
              />
              <InfoTile
                icon={<ServerCog className="h-3 w-3" />}
                label="Hostname"
                value={data.os?.hostname ?? "—"}
              />
              <InfoTile
                icon={<Clock className="h-3 w-3" />}
                label="Host Uptime"
                value={data.os ? formatUptime(data.os.uptime) : "—"}
              />
              <InfoTile
                icon={<Activity className="h-3 w-3" />}
                label="CPU Brand"
                value={data.cpu?.brand ?? "—"}
              />
            </div>

            {/* Last-checked footer */}
            <div className="mt-3 flex items-center justify-between border-t border-border/40 pt-2 font-mono text-[9px] text-muted-foreground">
              <span className="flex items-center gap-1">
                <HardDriveDownload className="h-3 w-3" />
                live metrics · refresh 10s
              </span>
              <span>
                checked {new Date(data.checkedAt).toLocaleTimeString("en-US", { hour12: false })}
              </span>
            </div>
          </>
        ) : null}
      </div>
    </FullScreenPanel>
  );
}

// ─── Sub-components ────────────────────────────────────────────────

function GaugeCard({
  title,
  icon,
  pct,
  footer,
  sub,
}: {
  title: string;
  icon: ReactNode;
  pct: number | null;
  footer: string;
  sub: string;
}) {
  // Clamp pct to 0–100 for the radial chart, but display the raw value.
  const value = pct === null ? 0 : Math.max(0, Math.min(100, pct));
  const color = pct === null ? "#71717a" : thresholdColor(pct);
  const display = pct === null ? "—" : `${pct.toFixed(1)}%`;

  const chartData = [{ name: title, value, fill: color }];

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className="mc-glow-card relative flex flex-col rounded-lg border border-border/60 bg-surface-2 p-3"
    >
      <div className="mb-1 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="text-cyan-300">{icon}</span>
          <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-foreground">
            {title}
          </span>
        </div>
      </div>

      <div className="relative h-[150px]">
        <ResponsiveContainer width="100%" height="100%">
          <RadialBarChart
            data={chartData}
            innerRadius="68%"
            outerRadius="100%"
            startAngle={90}
            endAngle={-270}
            margin={{ top: 0, right: 0, bottom: 0, left: 0 }}
          >
            <PolarAngleAxis
              type="number"
              domain={[0, 100]}
              angleAxisId={0}
              tick={false}
            />
            <RadialBar
              background={{ fill: "rgba(255,255,255,0.04)" }}
              dataKey="value"
              cornerRadius={8}
              angleAxisId={0}
            />
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              formatter={(v: number) => [`${v.toFixed(1)}%`, title]}
            />
          </RadialBarChart>
        </ResponsiveContainer>
        {/* Center value overlay */}
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span
            className="font-mono text-2xl font-bold tabular-nums"
            style={{ color }}
          >
            {display}
          </span>
          <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
            usage
          </span>
        </div>
      </div>

      <div className="mt-2 border-t border-border/40 pt-2">
        <div className="truncate font-mono text-[10px] font-medium text-foreground" title={footer}>
          {footer}
        </div>
        <div className="mt-0.5 truncate font-mono text-[9px] text-muted-foreground" title={sub}>
          {sub}
        </div>
      </div>
    </motion.div>
  );
}

function ProcessCard({
  process,
}: {
  process: SystemMetrics["process"];
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className="mc-glow-card flex flex-col rounded-lg border border-border/60 bg-surface-2 p-3"
    >
      <div className="mb-1 flex items-center gap-1.5">
        <ServerCog className="h-3.5 w-3.5 text-cyan-300" />
        <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-foreground">
          Node.js Process
        </span>
      </div>

      <div className="flex flex-1 flex-col justify-center gap-3 py-3">
        <ProcessStat
          label="Memory"
          value={process ? `${process.memoryMB.toFixed(1)} MB` : "—"}
          color="#8b5cf6"
        />
        <ProcessStat
          label="CPU Time"
          value={process ? `${process.cpuPercent.toFixed(1)} s` : "—"}
          color="#22d3ee"
        />
        <ProcessStat
          label="Uptime"
          value={process ? formatUptime(process.uptime) : "—"}
          color="#34d399"
        />
      </div>

      <div className="border-t border-border/40 pt-2">
        <div className="font-mono text-[10px] font-medium text-foreground">
          PID {process?.pid ?? "—"}
        </div>
        <div className="mt-0.5 font-mono text-[9px] text-muted-foreground">
          {process ? "live process telemetry" : "unavailable"}
        </div>
      </div>
    </motion.div>
  );
}

function ProcessStat({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-1.5">
        <span
          className="inline-block h-1.5 w-1.5 rounded-full"
          style={{ background: color }}
        />
        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
      </div>
      <span className="font-mono text-sm font-semibold tabular-nums text-foreground">
        {value}
      </span>
    </div>
  );
}

function InfoTile({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border border-border/50 bg-surface-2 p-2.5">
      <div className="flex items-center gap-1.5">
        <span className="text-muted-foreground">{icon}</span>
        <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
      </div>
      <div
        className="mt-1 truncate font-mono text-[11px] font-medium text-foreground"
        title={value}
      >
        {value}
      </div>
    </div>
  );
}

function LoadingState() {
  return (
    <div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="mc-glow-card flex flex-col rounded-lg border border-border/60 bg-surface-2 p-3"
          >
            <div className="mb-1 h-3 w-24 animate-pulse rounded bg-border/30" />
            <div className="relative my-4 h-[150px] animate-pulse rounded-full bg-border/20" />
            <div className="h-2.5 w-full animate-pulse rounded bg-border/20" />
            <div className="mt-1 h-2.5 w-2/3 animate-pulse rounded bg-border/20" />
          </div>
        ))}
      </div>
      <div className="mt-4 flex items-center justify-center gap-2 font-mono text-[10px] text-muted-foreground">
        <RefreshCw className="h-3 w-3 animate-spin" />
        Loading system metrics…
      </div>
    </div>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-12">
      <AlertCircle className="h-8 w-8 text-rose-300" />
      <div className="text-center">
        <p className="font-mono text-xs font-semibold text-foreground">
          System metrics unavailable
        </p>
        <p className="mt-1 font-mono text-[10px] text-muted-foreground">
          Could not reach /api/system-metrics
        </p>
      </div>
      <button
        type="button"
        onClick={onRetry}
        className="flex items-center gap-1.5 rounded-md border border-border/60 bg-surface-2 px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-foreground transition-colors hover:border-primary/40 hover:text-primary"
      >
        <RefreshCw className="h-3 w-3" />
        Retry
      </button>
    </div>
  );
}

export default SystemMetricsPanel;
