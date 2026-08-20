"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import {
  ScrollText,
  RefreshCw,
  Loader2,
  Download,
  ChevronRight,
  Inbox,
  Repeat,
  type LucideIcon,
} from "lucide-react";
import { FullScreenPanel } from "./full-screen-panel";
import { Badge } from "@/components/ui/badge";
import { useMissionStore } from "@/stores/mission-store";

// ─── Types ───────────────────────────────────────────────────────────
type EntryType = "log" | "approval" | "alert";
type LogLevel = "debug" | "info" | "warn" | "error" | "success";
type LevelFilter = "all" | LogLevel;
type LimitOption = 100 | 200 | 500;

interface AuditEntry {
  id: string;
  timestamp: string;
  type: EntryType;
  level: LogLevel;
  agentId: string | null;
  agentName?: string | null;
  message: string;
  meta: unknown | null;
}

interface AuditLogResponse {
  entries: AuditEntry[];
  total: number;
  filters?: {
    level: string | null;
    agentId: string | null;
    limit: number;
  };
  error?: string;
}

// ─── Style maps ──────────────────────────────────────────────────────
const TYPE_TONE: Record<EntryType, string> = {
  log: "text-cyan-300 border-cyan-500/30 bg-cyan-500/10",
  approval: "text-violet-300 border-violet-500/30 bg-violet-500/10",
  alert: "text-amber-300 border-amber-500/30 bg-amber-500/10",
};

const LEVEL_TONE: Record<LogLevel, string> = {
  error: "text-rose-300 border-rose-500/30 bg-rose-500/10",
  warn: "text-amber-300 border-amber-500/30 bg-amber-500/10",
  info: "text-cyan-300 border-cyan-500/30 bg-cyan-500/10",
  success: "text-emerald-300 border-emerald-500/30 bg-emerald-500/10",
  debug: "text-muted-foreground border-border/60 bg-surface-2/40",
};

const TYPE_ICON: Record<EntryType, LucideIcon> = {
  log: ScrollText,
  approval: ChevronRight,
  alert: ScrollText,
};

const LEVEL_OPTIONS: { value: LevelFilter; label: string }[] = [
  { value: "all", label: "All Levels" },
  { value: "error", label: "Error" },
  { value: "warn", label: "Warn" },
  { value: "info", label: "Info" },
  { value: "success", label: "Success" },
  { value: "debug", label: "Debug" },
];

const LIMIT_OPTIONS: LimitOption[] = [100, 200, 500];

// ─── Helpers ────────────────────────────────────────────────────────
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const diff = Date.now() - then;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

function absoluteTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC");
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

// ─── Component ───────────────────────────────────────────────────────
export function AuditLogPanel() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [level, setLevel] = useState<LevelFilter>("all");
  const [agentId, setAgentId] = useState<string>("all");
  const [limit, setLimit] = useState<LimitOption>(200);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Pull agents from the store for the agent dropdown.
  const agents = useMissionStore((s) => s.agents);
  const agentList = useMemo(() => {
    const list = Object.values(agents).sort((a, b) => a.name.localeCompare(b.name));
    return list;
  }, [agents]);

  const fetchEntries = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!opts?.silent) setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        if (level !== "all") params.set("level", level);
        if (agentId !== "all") params.set("agentId", agentId);
        params.set("limit", String(limit));
        const url = `/api/audit-log?${params.toString()}`;
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json().catch(() => ({}))) as AuditLogResponse;
        if (data.error) {
          setError(data.error);
        }
        setEntries(data.entries ?? []);
        setTotal(data.total ?? 0);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to load audit log";
        setError(msg);
        if (!opts?.silent) {
          toast.error("Failed to load audit log", { description: msg });
        }
      } finally {
        setLoading(false);
      }
    },
    [level, agentId, limit],
  );

  // Refetch whenever filters change.
  useEffect(() => {
    void fetchEntries();
  }, [fetchEntries]);

  // Auto-refresh every 30s.
  useEffect(() => {
    if (!autoRefresh) {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      return;
    }
    timerRef.current = setInterval(() => {
      void fetchEntries({ silent: true });
    }, 30_000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
    };
  }, [autoRefresh, fetchEntries]);

  const handleExport = useCallback(() => {
    if (entries.length === 0) {
      toast.info("Nothing to export", { description: "No audit entries in current filter" });
      return;
    }
    const blob = new Blob([JSON.stringify({ entries, total, exportedAt: new Date().toISOString() }, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `aria-audit-log-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success("Exported audit log", {
      description: `${entries.length} entries → ${a.download}`,
    });
  }, [entries, total]);

  return (
    <FullScreenPanel
      title="Audit Log"
      icon={<ScrollText className="h-3.5 w-3.5 text-cyan-300" />}
      actions={
        <>
          <button
            type="button"
            onClick={() => setAutoRefresh((p) => !p)}
            aria-pressed={autoRefresh}
            title={autoRefresh ? "Auto-refresh every 30s (on)" : "Auto-refresh off"}
            className={`flex h-7 items-center gap-1 rounded-md border px-2 font-mono text-[10px] font-medium transition-colors ${
              autoRefresh
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
                : "border-border/60 bg-surface-2/60 text-muted-foreground hover:border-primary/40 hover:text-foreground"
            }`}
          >
            <Repeat className="h-3 w-3" />
            {autoRefresh ? "Auto" : "Manual"}
          </button>
          <button
            type="button"
            onClick={handleExport}
            disabled={entries.length === 0}
            aria-label="Export entries as JSON"
            title="Export current entries as JSON"
            className="flex h-7 items-center gap-1 rounded-md border border-border/60 bg-surface-2/60 px-2 font-mono text-[10px] font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground disabled:opacity-50"
          >
            <Download className="h-3 w-3" />
            Export
          </button>
          <button
            type="button"
            onClick={() => void fetchEntries()}
            disabled={loading}
            aria-label="Refresh audit log"
            title="Refresh"
            className="flex h-7 w-7 items-center justify-center rounded-md border border-border/60 text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
        </>
      }
    >
      <div className="space-y-2 p-3">
        {/* Filter bar */}
        <div className="mc-surface flex flex-col gap-2 rounded-lg border border-border/60 bg-surface-2/30 p-2 lg:flex-row lg:items-center lg:justify-between">
          {/* Level filter */}
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground/60">Level</span>
            <FilterDropdown
              value={level}
              options={LEVEL_OPTIONS}
              onChange={(v) => setLevel(v as LevelFilter)}
            />
          </div>
          {/* Agent filter */}
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground/60">Agent</span>
            <FilterDropdown
              value={agentId}
              options={[
                { value: "all", label: "All Agents" },
                ...agentList.map((a) => ({ value: a.id, label: a.name })),
              ]}
              onChange={(v) => setAgentId(v)}
            />
          </div>
          {/* Limit selector */}
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground/60">Limit</span>
            <div className="flex items-center gap-0.5 rounded border border-border/60 bg-surface-2/40 p-0.5">
              {LIMIT_OPTIONS.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setLimit(n)}
                  className={`rounded px-2 py-0.5 font-mono text-[10px] font-medium transition-colors ${
                    limit === n
                      ? "bg-cyan-500/20 text-cyan-200"
                      : "text-muted-foreground/70 hover:text-foreground"
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
          {/* Total count */}
          <div className="font-mono text-[10px] text-muted-foreground">
            <span className="text-foreground/80">{entries.length}</span>
            <span className="text-muted-foreground/60"> / {total} shown</span>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="rounded border border-rose-500/30 bg-rose-500/5 px-2 py-1.5 font-mono text-[10px] text-rose-300">
            load failed: {error}
          </div>
        )}

        {/* Body */}
        {loading ? (
          <div className="flex items-center justify-center gap-1.5 py-8 font-mono text-[10px] text-muted-foreground/60">
            <Loader2 className="h-3 w-3 animate-spin" />
            loading audit trail…
          </div>
        ) : entries.length === 0 ? (
          <EmptyState
            icon={Inbox}
            label="No audit entries found"
            hint="Try clearing filters or running an autonomous cycle to generate activity."
          />
        ) : (
          <div className="mc-scroll max-h-[60vh] space-y-1 overflow-y-auto pr-1">
            <AnimatePresence initial={false}>
              {entries.map((entry) => (
                <AuditEntryRow
                  key={entry.id}
                  entry={entry}
                  expanded={expandedId === entry.id}
                  onToggle={() =>
                    setExpandedId((p) => (p === entry.id ? null : entry.id))
                  }
                />
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>
    </FullScreenPanel>
  );
}

// ─── Audit Entry Row ────────────────────────────────────────────────
function AuditEntryRow({
  entry,
  expanded,
  onToggle,
}: {
  entry: AuditEntry;
  expanded: boolean;
  onToggle: () => void;
}) {
  const TypeIcon = TYPE_ICON[entry.type];
  return (
    <motion.div
      layout
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="mc-surface rounded-md border border-border/60 bg-background/40"
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex w-full items-start gap-2 px-3 py-2 text-left transition-colors hover:bg-surface-2/30"
      >
        <TypeIcon className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground/60" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className="font-mono text-[9px] text-muted-foreground/70"
              title={absoluteTime(entry.timestamp)}
            >
              {relativeTime(entry.timestamp)}
            </span>
            <Badge
              variant="outline"
              className={`px-1 py-0 font-mono text-[8px] font-bold uppercase ${TYPE_TONE[entry.type]}`}
            >
              {entry.type}
            </Badge>
            <Badge
              variant="outline"
              className={`px-1 py-0 font-mono text-[8px] font-bold uppercase ${LEVEL_TONE[entry.level]}`}
            >
              {entry.level}
            </Badge>
            {entry.agentName && (
              <span className="font-mono text-[9px] text-violet-300/80">
                {entry.agentName}
              </span>
            )}
          </div>
          <div className={`mt-0.5 font-mono text-[10px] text-foreground/90 ${expanded ? "whitespace-pre-wrap break-words" : "truncate"}`}>
            {expanded ? entry.message : truncate(entry.message, 140)}
          </div>
        </div>
        <ChevronRight
          className={`mt-0.5 h-3 w-3 shrink-0 text-muted-foreground/50 transition-transform ${
            expanded ? "rotate-90" : ""
          }`}
        />
      </button>
      <AnimatePresence initial={false}>
        {expanded && entry.meta != null && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden border-t border-border/40"
          >
            <pre className="mc-scroll max-h-48 overflow-auto bg-surface-2/40 px-3 py-2 font-mono text-[9px] leading-relaxed text-muted-foreground/90">
              {JSON.stringify(entry.meta, null, 2)}
            </pre>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ─── Filter Dropdown ─────────────────────────────────────────────────
function FilterDropdown({
  value,
  options,
  onChange,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const selected = options.find((o) => o.value === value);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex h-7 min-w-[110px] items-center justify-between gap-1 rounded border border-border/60 bg-surface-2/60 px-2 font-mono text-[10px] text-foreground transition-colors hover:border-primary/40"
      >
        <span className="truncate">{selected?.label ?? value}</span>
        <ChevronRight className={`h-2.5 w-2.5 shrink-0 transition-transform ${open ? "rotate-90" : ""}`} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className="mc-surface absolute left-0 top-8 z-50 max-h-60 min-w-[140px] overflow-y-auto rounded-md border border-border/60 bg-background p-1 shadow-lg"
            role="listbox"
          >
            {options.map((opt) => {
              const isSel = opt.value === value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => {
                    onChange(opt.value);
                    setOpen(false);
                  }}
                  role="option"
                  aria-selected={isSel}
                  className={`flex w-full items-center justify-between gap-2 rounded px-2 py-1 text-left font-mono text-[10px] transition-colors ${
                    isSel
                      ? "bg-cyan-500/15 text-cyan-200"
                      : "text-muted-foreground hover:bg-surface-2/40 hover:text-foreground"
                  }`}
                >
                  <span className="truncate">{opt.label}</span>
                  {isSel && <ChevronRight className="h-2.5 w-2.5 shrink-0" />}
                </button>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Empty State ────────────────────────────────────────────────────
function EmptyState({
  icon: Icon,
  label,
  hint,
}: {
  icon: LucideIcon;
  label: string;
  hint?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-1.5 py-8 text-center">
      <Icon className="h-6 w-6 text-muted-foreground/40" />
      <div className="text-[11px] font-medium text-muted-foreground">{label}</div>
      {hint && (
        <div className="max-w-sm px-4 font-mono text-[9px] text-muted-foreground/60">
          {hint}
        </div>
      )}
    </div>
  );
}

export default AuditLogPanel;
