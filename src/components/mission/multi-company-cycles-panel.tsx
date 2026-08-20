"use client";

import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import {
  Building2,
  Building,
  RefreshCw,
  Loader2,
  Play,
  PlayCircle,
  TrendingUp,
  Target,
  CircleDollarSign,
  Inbox,
  Clock,
  CheckCircle2,
  AlertTriangle,
  type LucideIcon,
} from "lucide-react";
import { FullScreenPanel } from "./full-screen-panel";
import { Badge } from "@/components/ui/badge";
import { relTime } from "@/hooks/use-clock";

/**
 * MultiCompanyCyclesPanel — autonomous cycle orchestration across ALL
 * active companies in the parent account.
 *
 * Sections:
 *   1. Summary bar — total companies, total cycles run today,
 *      total revenue across all companies.
 *   2. "Run All Cycles" primary action — POSTs to
 *      /api/multi-company-cycles. Long-running (30-60s × N).
 *   3. Grid of company cards — each shows name, industry badge,
 *      last cycle timestamp, opportunities today, revenue today,
 *      and a "Run Cycle" button (POST to same endpoint).
 *
 * All API calls wrapped in try/catch with sonner toast feedback.
 * No mock data — every number comes from /api/multi-company-cycles.
 *
 * Task ID: FEATURES-MULTICOMPANY-WORKFLOWS-CONNECTORS (Task 4).
 */

// ─── Types ───────────────────────────────────────────────────────────
interface CompanyCycleStatus {
  companyId: string;
  companyName: string;
  industry: string | null;
  playbookId: string;
  lastCycleAt: string | null;
  opportunitiesToday: number;
  dealsToday: number;
  revenueToday: number;
  totalRevenue: number;
}

interface MultiCompanyStatus {
  totalCompanies: number;
  totalOpportunitiesToday: number;
  totalDealsToday: number;
  totalRevenueToday: number;
  companies: CompanyCycleStatus[];
  generatedAt: string;
}

interface CycleResultEntry {
  companyId: string;
  companyName: string;
  industry: string | null;
  playbookId: string;
  success: boolean;
  error?: string;
  cycleResult: {
    found: number;
    qualified: number;
    planned: number;
    executed: number;
    delivered: number;
    invoiced: number;
    tracked: number;
    optimized: number;
    revenueGenerated: number;
    errors: string[];
  } | null;
}

interface RunAllResponse {
  ok: boolean;
  totalCompanies: number;
  cyclesRun: number;
  successes: number;
  failures: number;
  results: CycleResultEntry[];
  note?: string;
}

// ─── Helpers ────────────────────────────────────────────────────────
const fmtMoney = (n: number) =>
  n >= 1_000_000
    ? `$${(n / 1_000_000).toFixed(1)}M`
    : n >= 1_000
      ? `$${(n / 1_000).toFixed(1)}k`
      : `$${n.toFixed(0)}`;

// ─── Component ───────────────────────────────────────────────────────
export function MultiCompanyCyclesPanel() {
  return (
    <FullScreenPanel
      title="Multi-Company Cycles"
      icon={<Building2 className="h-3.5 w-3.5 text-cyan-300" />}
    >
      <div className="space-y-3 p-3">
        <SummaryBar />
        <RunAllSection />
        <CompaniesGrid />
      </div>
    </FullScreenPanel>
  );
}

// ═════════════════════════════════════════════════════════════════════
// 1. SUMMARY BAR
// ═════════════════════════════════════════════════════════════════════
function SummaryBar() {
  const [status, setStatus] = useState<MultiCompanyStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/multi-company-cycles", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json().catch(() => ({}))) as MultiCompanyStatus;
      setStatus(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load status");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchStatus();
  }, [fetchStatus]);

  return (
    <div className="mc-surface rounded-lg border border-border/60 bg-surface-2/30 p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <TrendingUp className="h-3.5 w-3.5 text-emerald-300" />
          <h3 className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground">
            Fleet Cycle Summary
          </h3>
        </div>
        <button
          type="button"
          onClick={() => void fetchStatus()}
          disabled={loading}
          aria-label="Refresh multi-company cycle status"
          className="text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
        >
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>
      {error ? (
        <div className="rounded border border-rose-500/30 bg-rose-500/5 px-2 py-1.5 font-mono text-[10px] text-rose-300">
          load failed: {error}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <StatTile
            icon={Building}
            label="Companies"
            value={loading ? "…" : String(status?.totalCompanies ?? 0)}
            tone="text-cyan-300"
          />
          <StatTile
            icon={Target}
            label="Opps (24h)"
            value={loading ? "…" : String(status?.totalOpportunitiesToday ?? 0)}
            tone="text-violet-300"
          />
          <StatTile
            icon={CircleDollarSign}
            label="Revenue (24h)"
            value={loading ? "…" : fmtMoney(status?.totalRevenueToday ?? 0)}
            tone="text-emerald-300"
          />
          <StatTile
            icon={Clock}
            label="Generated"
            value={loading || !status ? "…" : relTime(status.generatedAt)}
            tone="text-amber-300"
            title={status?.generatedAt}
          />
        </div>
      )}
      <div className="mt-2 font-mono text-[9px] text-muted-foreground/60">
        last refresh {relTime(status?.generatedAt ?? null)}
      </div>
    </div>
  );
}

function StatTile({
  icon: Icon,
  label,
  value,
  tone,
  title,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  tone: string;
  title?: string;
}) {
  return (
    <div
      className="rounded border border-border/40 bg-surface-2/40 px-2 py-1.5"
      title={title}
    >
      <div className="flex items-center gap-1 font-mono text-[9px] uppercase tracking-wider text-muted-foreground/70">
        <Icon className={`h-2.5 w-2.5 ${tone}`} />
        {label}
      </div>
      <div className={`mt-0.5 font-mono text-base font-semibold tabular-nums ${tone}`}>
        {value}
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════
// 2. RUN ALL CYCLES
// ═════════════════════════════════════════════════════════════════════
function RunAllSection() {
  const [running, setRunning] = useState(false);
  const [progressMsg, setProgressMsg] = useState<string | null>(null);
  const [result, setResult] = useState<RunAllResponse | null>(null);

  const runAll = useCallback(async () => {
    setRunning(true);
    setProgressMsg("Spawning parallel cycles for all active companies…");
    const tid = toast.loading("Running multi-company cycle…", {
      description: "Each company runs FIND → OPTIMIZE in parallel.",
    });
    try {
      const res = await fetch("/api/multi-company-cycles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force: false }),
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}${txt ? ` — ${txt.slice(0, 120)}` : ""}`);
      }
      const data = (await res.json().catch(() => ({}))) as RunAllResponse;
      setResult(data);
      setProgressMsg(null);
      if (data.ok) {
        toast.success(
          `Cycles complete — ${data.successes}/${data.cyclesRun} succeeded`,
          {
            id: tid,
            description: `${data.failures} failed · ${data.totalCompanies} companies processed`,
          },
        );
      } else {
        toast.error("Multi-company cycle failed", { id: tid });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setProgressMsg(null);
      toast.error("Run All Cycles failed", { id: tid, description: msg });
    } finally {
      setRunning(false);
    }
  }, []);

  return (
    <div className="mc-surface rounded-lg border border-border/60 bg-surface-2/30 p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-1.5">
          <PlayCircle className="h-3.5 w-3.5 text-violet-300" />
          <h3 className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground">
            Run Autonomous Cycle for All Companies
          </h3>
        </div>
        <button
          type="button"
          onClick={() => void runAll()}
          disabled={running}
          className="flex h-8 items-center gap-1.5 rounded-md border border-violet-500/40 bg-violet-500/10 px-3 font-mono text-[11px] font-medium text-violet-200 transition-colors hover:bg-violet-500/20 disabled:opacity-50"
        >
          {running ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Play className="h-3 w-3" />
          )}
          {running ? "Running…" : "Run All Cycles"}
        </button>
      </div>
      {progressMsg && (
        <div className="mt-2 flex items-center gap-1.5 rounded border border-violet-500/30 bg-violet-500/5 px-2 py-1.5 font-mono text-[10px] text-violet-300">
          <Loader2 className="h-3 w-3 animate-spin" />
          {progressMsg}
        </div>
      )}
      <AnimatePresence>
        {result && !running && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-2 overflow-hidden"
          >
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <StatTile
                icon={Building}
                label="Companies"
                value={String(result.totalCompanies)}
                tone="text-cyan-300"
              />
              <StatTile
                icon={PlayCircle}
                label="Cycles Run"
                value={String(result.cyclesRun)}
                tone="text-violet-300"
              />
              <StatTile
                icon={CheckCircle2}
                label="Successes"
                value={String(result.successes)}
                tone="text-emerald-300"
              />
              <StatTile
                icon={AlertTriangle}
                label="Failures"
                value={String(result.failures)}
                tone="text-rose-300"
              />
            </div>
            {result.note && (
              <div className="mt-2 rounded border border-amber-500/30 bg-amber-500/5 px-2 py-1.5 font-mono text-[9px] text-amber-300">
                ⚠ {result.note}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════
// 3. COMPANIES GRID
// ═════════════════════════════════════════════════════════════════════
function CompaniesGrid() {
  const [companies, setCompanies] = useState<CompanyCycleStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchCompanies = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/multi-company-cycles", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json().catch(() => ({}))) as MultiCompanyStatus;
      setCompanies(data.companies ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load companies");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchCompanies();
  }, [fetchCompanies]);

  const runSingleCycle = useCallback(
    async (company: CompanyCycleStatus) => {
      // The API endpoint runs ALL companies in parallel — there's no
      // per-company endpoint. We surface this UX as a "Run Cycle" CTA
      // but the implementation triggers the full multi-company cycle,
      // then refreshes the grid. We toast-identify the triggered
      // company so the operator gets immediate feedback.
      const tid = toast.loading(`Triggering cycle for ${company.companyName}…`, {
        description: "This runs all active companies in parallel.",
      });
      try {
        const res = await fetch("/api/multi-company-cycles", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ force: true }),
        });
        if (!res.ok) {
          const txt = await res.text().catch(() => "");
          throw new Error(`HTTP ${res.status}${txt ? ` — ${txt.slice(0, 120)}` : ""}`);
        }
        const data = (await res.json().catch(() => ({}))) as RunAllResponse;
        const thisResult = data.results?.find(
          (r) => r.companyId === company.companyId,
        );
        if (thisResult?.success) {
          toast.success(`${company.companyName} cycle complete`, {
            id: tid,
            description: `Found ${thisResult.cycleResult?.found ?? 0} · revenue $${(thisResult.cycleResult?.revenueGenerated ?? 0).toFixed(0)}`,
          });
        } else if (thisResult) {
          toast.warning(`${company.companyName} cycle had issues`, {
            id: tid,
            description: thisResult.error ?? "see logs for details",
          });
        } else {
          toast.success("Cycles triggered", { id: tid });
        }
        void fetchCompanies();
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        toast.error(`Cycle failed for ${company.companyName}`, {
          id: tid,
          description: msg,
        });
      }
    },
    [fetchCompanies],
  );

  return (
    <div className="mc-surface rounded-lg border border-border/60 bg-surface-2/30 p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Building2 className="h-3.5 w-3.5 text-cyan-300" />
          <h3 className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground">
            Active Companies
          </h3>
        </div>
        <button
          type="button"
          onClick={() => void fetchCompanies()}
          disabled={loading}
          aria-label="Refresh companies list"
          className="text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
        >
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>
      {error ? (
        <div className="rounded border border-rose-500/30 bg-rose-500/5 px-2 py-1.5 font-mono text-[10px] text-rose-300">
          load failed: {error}
        </div>
      ) : loading ? (
        <div className="flex items-center justify-center gap-1.5 py-6 font-mono text-[10px] text-muted-foreground/60">
          <Loader2 className="h-3 w-3 animate-spin" />
          loading companies…
        </div>
      ) : companies.length === 0 ? (
        <EmptyState
          icon={Inbox}
          label="No active companies yet"
          hint="Create a company under Multi-Company → Companies to enable parallel autonomous cycles."
        />
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {companies.map((c) => (
            <CompanyCard
              key={c.companyId}
              company={c}
              onRun={() => void runSingleCycle(c)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function CompanyCard({
  company,
  onRun,
}: {
  company: CompanyCycleStatus;
  onRun: () => void;
}) {
  const [running, setRunning] = useState(false);

  const handleRun = () => {
    setRunning(true);
    onRun();
    // Reset after a generous window — the actual completion comes via toast.
    setTimeout(() => setRunning(false), 4000);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex flex-col gap-2 rounded-md border border-border/60 bg-background/40 p-3"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-[12px] font-semibold text-foreground">
            {company.companyName}
          </div>
          <div className="font-mono text-[9px] text-muted-foreground/70">
            playbook: {company.playbookId}
          </div>
        </div>
        <Badge
          variant="outline"
          className="shrink-0 border-cyan-500/30 bg-cyan-500/10 px-1.5 py-0 text-[9px] font-bold text-cyan-300"
        >
          {company.industry ?? "unspecified"}
        </Badge>
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        <MiniStat label="Opps 24h" value={String(company.opportunitiesToday)} tone="text-violet-300" />
        <MiniStat label="Deals 24h" value={String(company.dealsToday)} tone="text-amber-300" />
        <MiniStat
          label="Rev 24h"
          value={fmtMoney(company.revenueToday)}
          tone="text-emerald-300"
        />
      </div>
      <div className="flex items-center justify-between gap-2 font-mono text-[9px] text-muted-foreground/70">
        <span>
          last cycle:{" "}
          {company.lastCycleAt ? (
            <span className="text-muted-foreground">{relTime(company.lastCycleAt)}</span>
          ) : (
            <span className="text-muted-foreground/50">never</span>
          )}
        </span>
        <span>
          total:{" "}
          <span className="text-emerald-300">{fmtMoney(company.totalRevenue)}</span>
        </span>
      </div>
      <button
        type="button"
        onClick={handleRun}
        disabled={running}
        className="flex h-7 items-center justify-center gap-1.5 rounded border border-border/60 bg-surface-2/60 px-2 font-mono text-[10px] font-medium text-foreground transition-colors hover:border-violet-500/40 hover:text-violet-200 disabled:opacity-50"
      >
        {running ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <Play className="h-3 w-3" />
        )}
        {running ? "Running…" : "Run Cycle"}
      </button>
    </motion.div>
  );
}

function MiniStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: string;
}) {
  return (
    <div className="rounded border border-border/40 bg-surface-2/40 px-1.5 py-1">
      <div className="font-mono text-[8px] uppercase tracking-wider text-muted-foreground/60">
        {label}
      </div>
      <div className={`font-mono text-[11px] font-semibold tabular-nums ${tone}`}>
        {value}
      </div>
    </div>
  );
}

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
