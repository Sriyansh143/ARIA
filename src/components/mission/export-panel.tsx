"use client";

import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useMissionStore } from "@/stores/mission-store";
import { compact } from "@/hooks/use-clock";
import { toast } from "sonner";
import {
  FileDown,
  FileText,
  Database,
  TrendingUp,
  Users,
  CheckCircle2,
  Loader2,
  X,
} from "lucide-react";

type ExportFormat = "csv" | "json" | "markdown";
type ExportScope = "financial" | "performance" | "full";

interface ExportOption {
  scope: ExportScope;
  label: string;
  description: string;
  icon: typeof FileText;
  tone: string;
}

const SCOPE_OPTIONS: ExportOption[] = [
  {
    scope: "financial",
    label: "Financial Report",
    description: "Revenue events, deal pipeline, cost analysis, profitability summary",
    icon: TrendingUp,
    tone: "text-emerald-300",
  },
  {
    scope: "performance",
    label: "Performance Report",
    description: "Agent leaderboard, task velocity, capability matrix, system health",
    icon: Users,
    tone: "text-cyan-300",
  },
  {
    scope: "full",
    label: "Full Mission Report",
    description: "Complete snapshot: financials + performance + telemetry + logs",
    icon: Database,
    tone: "text-violet-300",
  },
];

/**
 * ExportPanel — generates downloadable reports (CSV/JSON/Markdown).
 *
 * Lets operators export a summary of the mission-control state in three
 * formats and three scopes. Reports are generated client-side from the
 * store's live data and downloaded as a file — no server round-trip.
 */
export function ExportPanel() {
  const [selectedScope, setSelectedScope] = useState<ExportScope>("full");
  const [format, setFormat] = useState<ExportFormat>("csv");
  const [generating, setGenerating] = useState(false);

  const agents = useMissionStore((s) => s.agents);
  const tasks = useMissionStore((s) => s.tasks);
  const revenueEvents = useMissionStore((s) => s.revenueEvents);
  const deals = useMissionStore((s) => s.deals);
  const llmCalls = useMissionStore((s) => s.llmCalls);
  const alerts = useMissionStore((s) => s.alerts);

  const stats = useMemo(() => {
    const totalRevenue = revenueEvents.reduce((s, r) => s + r.amount, 0);
    const pipelineValue = Object.values(deals)
      .filter((d) => d.stage !== "won" && d.stage !== "lost")
      .reduce((s, d) => s + d.value, 0);
    const wonDeals = Object.values(deals).filter((d) => d.stage === "won");
    const totalTasks = Object.values(tasks);
    const completedTasks = totalTasks.filter((t) => t.status === "completed");
    return {
      agentCount: Object.keys(agents).length,
      taskCount: totalTasks.length,
      completedTaskCount: completedTasks.length,
      revenueCount: revenueEvents.length,
      totalRevenue,
      pipelineValue,
      wonDeals: wonDeals.length,
      dealCount: Object.keys(deals).length,
      llmCallCount: llmCalls.length,
      alertCount: alerts.length,
    };
  }, [agents, tasks, revenueEvents, deals, llmCalls, alerts]);

  function generateReport(): string {
    const ts = new Date().toISOString();
    const agentList = Object.values(agents);
    const taskList = Object.values(tasks);
    const dealList = Object.values(deals);

    if (format === "csv") {
      return generateCSV(selectedScope, agentList, taskList, dealList, revenueEvents, stats, ts);
    }
    if (format === "json") {
      return generateJSON(selectedScope, agentList, taskList, dealList, revenueEvents, stats, ts);
    }
    return generateMarkdown(selectedScope, agentList, taskList, dealList, revenueEvents, stats, ts);
  }

  function handleExport() {
    setGenerating(true);
    setTimeout(() => {
      try {
        const content = generateReport();
        const ext = format === "markdown" ? "md" : format;
        const filename = `aria-mission-report-${selectedScope}-${Date.now()}.${ext}`;
        const blob = new Blob([content], {
          type: format === "json" ? "application/json" : format === "csv" ? "text/csv" : "text/markdown",
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        toast.success("Report exported", {
          description: `${filename} · ${compact(content.length)} bytes`,
        });
      } catch {
        toast.error("Export failed");
      } finally {
        setGenerating(false);
      }
    }, 400);
  }

  return (
    <section className="mc-surface flex flex-col">
      <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
        <div className="flex items-center gap-2">
          <FileDown className="h-4 w-4 text-amber-300" />
          <h2 className="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-foreground">
            Export & Reports
          </h2>
        </div>
        <span className="font-mono text-[10px] text-muted-foreground">
          {stats.agentCount} agents · {stats.taskCount} tasks · ${compact(stats.totalRevenue)} rev
        </span>
      </div>

      <div className="p-4">
        {/* Scope selection */}
        <div className="mb-3">
          <div className="mb-1.5 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
            Report scope
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {SCOPE_OPTIONS.map((opt) => {
              const Icon = opt.icon;
              const isSelected = selectedScope === opt.scope;
              return (
                <button
                  key={opt.scope}
                  onClick={() => setSelectedScope(opt.scope)}
                  className={`rounded-lg border p-2.5 text-left transition-colors ${
                    isSelected
                      ? `border-primary/50 bg-primary/10`
                      : "border-border/50 bg-background/40 hover:border-border/70"
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    <Icon className={`h-3.5 w-3.5 ${isSelected ? "text-primary" : opt.tone}`} />
                    <span className={`font-mono text-[10px] font-semibold uppercase tracking-wider ${isSelected ? "text-primary" : "text-foreground"}`}>
                      {opt.label}
                    </span>
                  </div>
                  <p className="mt-1 font-mono text-[9px] text-muted-foreground">{opt.description}</p>
                </button>
              );
            })}
          </div>
        </div>

        {/* Format selection */}
        <div className="mb-3">
          <div className="mb-1.5 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
            Format
          </div>
          <div className="flex gap-1.5">
            {(["csv", "json", "markdown"] as ExportFormat[]).map((fmt) => (
              <button
                key={fmt}
                onClick={() => setFormat(fmt)}
                className={`flex items-center gap-1 rounded border px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors ${
                  format === fmt
                    ? "border-amber-500/50 bg-amber-500/10 text-amber-300"
                    : "border-border/60 text-muted-foreground hover:text-foreground"
                }`}
              >
                <FileText className="h-2.5 w-2.5" />
                {fmt}
              </button>
            ))}
          </div>
        </div>

        {/* Preview stats */}
        <div className="mb-3 rounded-md border border-border/40 bg-background/40 p-2.5">
          <div className="mb-1.5 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
            Report will include
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[10px] sm:grid-cols-3">
            <Stat label="Agents" value={String(stats.agentCount)} />
            <Stat label="Tasks" value={`${stats.completedTaskCount}/${stats.taskCount}`} />
            <Stat label="Revenue events" value={String(stats.revenueCount)} />
            <Stat label="Total revenue" value={`$${compact(stats.totalRevenue)}`} />
            <Stat label="Pipeline value" value={`$${compact(stats.pipelineValue)}`} />
            <Stat label="Deals" value={`${stats.wonDeals}/${stats.dealCount} won`} />
          </div>
        </div>

        {/* Export button */}
        <button
          onClick={handleExport}
          disabled={generating}
          className="flex w-full items-center justify-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 font-mono text-xs font-semibold uppercase tracking-wider text-amber-300 transition-colors hover:bg-amber-500/20 disabled:opacity-50"
        >
          {generating ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Generating report…
            </>
          ) : (
            <>
              <FileDown className="h-4 w-4" />
              Export {selectedScope} report ({format.toUpperCase()})
            </>
          )}
        </button>
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold text-foreground">{value}</span>
    </div>
  );
}

// ─── Report generators ─────────────────────────────────────────────

function generateCSV(
  scope: ExportScope,
  agents: Array<{ name: string; role: string; status: string; tasksDone: number; errorCount: number; tokensUsed: number }>,
  tasks: Array<{ title: string; status: string; priority: string; progress: number; assignedTo?: { name: string } | null }>,
  deals: Array<{ title: string; value: number; stage: string; probability: number; counterparty: string | null }>,
  revenue: Array<{ source: string; amount: number; description: string | null; createdAt: string }>,
  stats: Record<string, number>,
  ts: string,
): string {
  const lines: string[] = [];
  lines.push(`# ARIA Mission Control Report — ${scope} — ${ts}`);
  lines.push("");

  if (scope === "financial" || scope === "full") {
    lines.push("## Revenue Events");
    lines.push("source,amount,description,timestamp");
    for (const r of revenue) {
      lines.push(`"${r.source}",${r.amount},"${r.description ?? ""}","${r.createdAt}"`);
    }
    lines.push("");
    lines.push("## Deal Pipeline");
    lines.push("title,value,stage,probability,counterparty");
    for (const d of deals) {
      lines.push(`"${d.title}",${d.value},"${d.stage}",${d.probability},"${d.counterparty ?? ""}"`);
    }
    lines.push("");
    lines.push(`## Summary: Total Revenue=$${stats.totalRevenue}, Pipeline=$${stats.pipelineValue}, Won Deals=${stats.wonDeals}`);
    lines.push("");
  }

  if (scope === "performance" || scope === "full") {
    lines.push("## Agent Performance");
    lines.push("name,role,status,tasksDone,errorCount,tokensUsed");
    for (const a of agents) {
      lines.push(`"${a.name}","${a.role}","${a.status}",${a.tasksDone},${a.errorCount},${a.tokensUsed}`);
    }
    lines.push("");
    lines.push("## Task Pipeline");
    lines.push("title,status,priority,progress,assignee");
    for (const t of tasks) {
      lines.push(`"${t.title}","${t.status}","${t.priority}",${t.progress},"${t.assignedTo?.name ?? "unassigned"}"`);
    }
    lines.push("");
  }

  if (scope === "full") {
    lines.push(`## System: Agents=${stats.agentCount}, Tasks=${stats.taskCount}, LLM Calls=${stats.llmCallCount}, Alerts=${stats.alertCount}`);
  }

  return lines.join("\n");
}

function generateJSON(
  scope: ExportScope,
  agents: unknown[],
  tasks: unknown[],
  deals: unknown[],
  revenue: unknown[],
  stats: Record<string, number>,
  ts: string,
): string {
  return JSON.stringify(
    {
      report: "aria-mission-control",
      scope,
      generatedAt: ts,
      summary: stats,
      agents: scope === "financial" ? undefined : agents,
      tasks: scope === "financial" ? undefined : tasks,
      deals: scope === "performance" ? undefined : deals,
      revenue: scope === "performance" ? undefined : revenue,
    },
    null,
    2,
  );
}

function generateMarkdown(
  scope: ExportScope,
  agents: Array<{ name: string; role: string; status: string; tasksDone: number; errorCount: number; tokensUsed: number }>,
  tasks: Array<{ title: string; status: string; priority: string; progress: number; assignedTo?: { name: string } | null }>,
  deals: Array<{ title: string; value: number; stage: string; probability: number; counterparty: string | null }>,
  revenue: Array<{ source: string; amount: number; description: string | null; createdAt: string }>,
  stats: Record<string, number>,
  ts: string,
): string {
  const lines: string[] = [];
  lines.push(`# ARIA Mission Control Report`);
  lines.push(`**Scope:** ${scope} · **Generated:** ${ts}`);
  lines.push("");
  lines.push(`## Summary`);
  lines.push(`- **Agents:** ${stats.agentCount}`);
  lines.push(`- **Tasks:** ${stats.completedTaskCount}/${stats.taskCount} completed`);
  lines.push(`- **Total Revenue:** $${stats.totalRevenue.toLocaleString()}`);
  lines.push(`- **Pipeline Value:** $${stats.pipelineValue.toLocaleString()}`);
  lines.push(`- **Deals Won:** ${stats.wonDeals}/${stats.dealCount}`);
  lines.push(`- **LLM Calls:** ${stats.llmCallCount}`);
  lines.push(`- **Alerts:** ${stats.alertCount}`);
  lines.push("");

  if (scope === "performance" || scope === "full") {
    lines.push(`## Agent Performance`);
    lines.push(`| Agent | Role | Status | Tasks Done | Errors | Tokens |`);
    lines.push(`|-------|------|--------|------------|--------|--------|`);
    for (const a of agents) {
      lines.push(`| ${a.name} | ${a.role} | ${a.status} | ${a.tasksDone} | ${a.errorCount} | ${a.tokensUsed.toLocaleString()} |`);
    }
    lines.push("");
  }

  if (scope === "financial" || scope === "full") {
    lines.push(`## Deal Pipeline`);
    lines.push(`| Deal | Value | Stage | Probability | Counterparty |`);
    lines.push(`|------|-------|-------|-------------|--------------|`);
    for (const d of deals) {
      lines.push(`| ${d.title} | $${d.value.toLocaleString()} | ${d.stage} | ${d.probability}% | ${d.counterparty ?? "—"} |`);
    }
    lines.push("");
    lines.push(`## Recent Revenue`);
    lines.push(`| Source | Amount | Description |`);
    lines.push(`|--------|--------|-------------|`);
    for (const r of revenue.slice(0, 20)) {
      lines.push(`| ${r.source} | $${r.amount.toLocaleString()} | ${r.description ?? "—"} |`);
    }
  }

  return lines.join("\n");
}

export { CheckCircle2, X };
