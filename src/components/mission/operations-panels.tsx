"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { useMissionStore } from "@/stores/mission-store";
import { SEVERITY_META, SKILL_CATEGORIES, type AlertSeverity, type SkillCategory } from "@/lib/types";
import { relTime } from "@/hooks/use-clock";
import { toast } from "sonner";
import {
  Clock,
  CheckCircle2,
  XCircle,
  PauseCircle,
  AlertOctagon,
  Bell,
  CheckCheck,
  Boxes,
  Puzzle,
  Play,
  Loader2,
} from "lucide-react";

const CRON_STATUS_META: Record<string, { label: string; tone: string; icon: typeof Clock }> = {
  active: { label: "Active", tone: "text-emerald-300", icon: CheckCircle2 },
  paused: { label: "Paused", tone: "text-amber-300", icon: PauseCircle },
  error: { label: "Error", tone: "text-rose-300", icon: XCircle },
};

const CATEGORY_TONE: Record<SkillCategory, string> = {
  llm: "text-cyan-300 border-cyan-500/30 bg-cyan-500/5",
  media: "text-violet-300 border-violet-500/30 bg-violet-500/5",
  doc: "text-amber-300 border-amber-500/30 bg-amber-500/5",
  data: "text-emerald-300 border-emerald-500/30 bg-emerald-500/5",
  web: "text-sky-300 border-sky-500/30 bg-sky-500/5",
};

/** CronRegistry — background daemon schedule viewer with manual trigger. */
export function CronRegistry() {
  const cronJobs = useMissionStore((s) => s.cronJobs);
  const list = Object.values(cronJobs).sort((a, b) => a.name.localeCompare(b.name));
  const [busyJobs, setBusyJobs] = useState<Record<string, boolean>>({});

  async function runJob(jobId: string, jobName: string) {
    setBusyJobs((prev) => ({ ...prev, [jobId]: true }));
    try {
      const res = await fetch(`/api/cron/${jobId}/run`, { method: "POST" });
      if (!res.ok) throw new Error("run failed");
      const data = (await res.json()) as { run: { ok: boolean; latencyMs: number; result: string } };
      if (data.run.ok) {
        toast.success(`Cron "${jobName}" executed`, {
          description: `${data.run.result} · ${data.run.latencyMs}ms`,
        });
      } else {
        toast.error(`Cron "${jobName}" failed`, { description: data.run.result });
      }
    } catch {
      toast.error(`Failed to trigger "${jobName}"`);
    } finally {
      setBusyJobs((prev) => ({ ...prev, [jobId]: false }));
    }
  }

  return (
    <section className="mc-surface flex min-h-0 flex-col">
      <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-amber-300" />
          <h2 className="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-foreground">
            Cron Registry
          </h2>
        </div>
        <span className="font-mono text-[10px] text-muted-foreground">{list.length} jobs</span>
      </div>
      <div className="mc-scroll max-h-[24rem] flex-1 overflow-y-auto p-2.5">
        <ul className="space-y-1.5">
          {list.map((job) => {
            const meta = CRON_STATUS_META[job.status] ?? CRON_STATUS_META.active;
            const Icon = meta.icon;
            const successRate = job.runCount > 0 ? Math.round((1 - job.failCount / job.runCount) * 100) : 100;
            return (
              <motion.li
                key={job.id}
                layout
                className="rounded-md border border-border/50 bg-card/50 p-2.5"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Icon className={`h-3 w-3 ${meta.tone}`} />
                      <span className="truncate font-mono text-xs font-medium text-foreground">{job.name}</span>
                    </div>
                    {job.description && (
                      <p className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground">{job.description}</p>
                    )}
                  </div>
                  <span className={`shrink-0 rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase ${meta.tone} border-current/30`}>
                    {meta.label}
                  </span>
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] text-muted-foreground">
                  <span className="rounded bg-background/60 px-1.5 py-0.5 text-cyan-300">{job.schedule}</span>
                  <span>{job.runCount} runs</span>
                  <span className={successRate < 95 ? "text-rose-300" : "text-emerald-300"}>{successRate}% ok</span>
                  <span>last: {relTime(job.lastRunAt)}</span>
                  <span>next: {job.nextRunAt ? relTime(job.nextRunAt) : "—"}</span>
                </div>
                {job.lastResult && (
                  <div className="mt-1 font-mono text-[9px] text-muted-foreground/70">
                    <span className="text-border">▸ </span>{job.lastResult}
                  </div>
                )}
                <button
                  onClick={() => void runJob(job.id, job.name)}
                  disabled={busyJobs[job.id]}
                  className="mt-2 flex items-center gap-1 rounded border border-cyan-500/30 bg-cyan-500/5 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-cyan-300 transition-colors hover:bg-cyan-500/15 disabled:opacity-50"
                >
                  {busyJobs[job.id] ? (
                    <Loader2 className="h-2.5 w-2.5 animate-spin" />
                  ) : (
                    <Play className="h-2.5 w-2.5" />
                  )}
                  {busyJobs[job.id] ? "running…" : "run now"}
                </button>
              </motion.li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

/** AlertsTicker — scrolling marquee of unacked critical/warn alerts. */
export function AlertsTicker() {
  const alerts = useMissionStore((s) => s.alerts);
  const recent = useMemo(
    () => alerts.slice(0, 12).filter((a) => !a.ack || a.severity === "critical"),
    [alerts]
  );

  if (recent.length === 0) {
    return (
      <div className="flex items-center gap-2 overflow-hidden rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-1.5">
        <CheckCheck className="h-3.5 w-3.5 text-emerald-300" />
        <span className="font-mono text-[11px] text-emerald-300">All systems nominal · no unacknowledged alerts</span>
      </div>
    );
  }

  const doubled = [...recent, ...recent];
  return (
    <div className="relative flex items-center gap-2 overflow-hidden rounded-lg border border-border/60 bg-card/60">
      <div className="flex shrink-0 items-center gap-1.5 border-r border-border/60 bg-rose-500/10 px-3 py-1.5">
        <AlertOctagon className="h-3.5 w-3.5 text-rose-300" />
        <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-rose-300">
          {recent.length} alert{recent.length === 1 ? "" : "s"}
        </span>
      </div>
      <div className="relative flex-1 overflow-hidden">
        <div className="mc-anim-marquee flex w-max items-center gap-6 whitespace-nowrap py-1.5">
          {doubled.map((a, i) => {
            const meta = SEVERITY_META[a.severity as AlertSeverity] ?? SEVERITY_META.warn;
            return (
              <span key={`${a.id}-${i}`} className="flex items-center gap-1.5 font-mono text-[11px]">
                <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
                <span className={meta.tone}>[{a.severity.toUpperCase()}]</span>
                <span className="text-muted-foreground">{a.source}:</span>
                <span className="text-foreground/80">{a.message}</span>
                <span className="text-muted-foreground/60">· {relTime(a.createdAt)}</span>
              </span>
            );
          })}
        </div>
        {/* edge fades */}
        <div className="pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-background to-transparent" />
        <div className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-background to-transparent" />
      </div>
    </div>
  );
}

/** AlertsPanel — full ack-able alert list with bulk-ack action. */
export function AlertsPanel() {
  const alerts = useMissionStore((s) => s.alerts);
  const list = alerts.slice(0, 30);
  const unackedCount = useMemo(() => alerts.filter((a) => !a.ack).length, [alerts]);
  const [bulkAcking, setBulkAcking] = useState(false);

  async function ack(id: string) {
    try {
      await fetch(`/api/alerts/${id}/ack`, { method: "PATCH" });
    } catch {
      /* store will still update via SSE broadcast */
    }
  }

  async function ackAll() {
    if (bulkAcking || unackedCount === 0) return;
    setBulkAcking(true);
    try {
      const res = await fetch(`/api/alerts/ack-all`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!res.ok) throw new Error("ack-all failed");
      const data = (await res.json()) as { acked: number };
      toast.success(`Acknowledged ${data.acked} alert${data.acked === 1 ? "" : "s"}`);
    } catch {
      toast.error("Failed to acknowledge all alerts");
    } finally {
      setBulkAcking(false);
    }
  }

  return (
    <section className="mc-surface flex min-h-0 flex-col">
      <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
        <div className="flex items-center gap-2">
          <Bell className="h-4 w-4 text-rose-300" />
          <h2 className="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-foreground">
            System Alerts
          </h2>
        </div>
        <div className="flex items-center gap-2">
          {unackedCount > 0 && (
            <button
              onClick={ackAll}
              disabled={bulkAcking}
              className="flex items-center gap-1 rounded border border-emerald-500/30 bg-emerald-500/5 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-emerald-300 transition-colors hover:bg-emerald-500/15 disabled:opacity-50"
              title={`Acknowledge ${unackedCount} unacked alert${unackedCount === 1 ? "" : "s"}`}
            >
              {bulkAcking ? (
                <Loader2 className="h-2.5 w-2.5 animate-spin" />
              ) : (
                <CheckCheck className="h-2.5 w-2.5" />
              )}
              {bulkAcking ? "acking…" : `ack all (${unackedCount})`}
            </button>
          )}
          <span className="font-mono text-[10px] text-muted-foreground">{list.length}</span>
        </div>
      </div>
      <div className="mc-scroll max-h-[24rem] flex-1 overflow-y-auto p-2.5">
        <ul className="space-y-1.5">
          {list.length === 0 ? (
            <li className="flex h-20 items-center justify-center font-mono text-xs text-muted-foreground">
              no alerts — all nominal
            </li>
          ) : (
            list.map((a) => {
              const meta = SEVERITY_META[a.severity as AlertSeverity] ?? SEVERITY_META.warn;
              return (
                <motion.li
                  key={a.id}
                  layout
                  className={`flex items-center gap-2 rounded-md border border-border/50 bg-card/50 px-2.5 py-1.5 ${a.ack ? "opacity-50" : ""}`}
                >
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${meta.dot}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className={`font-mono text-[9px] uppercase ${meta.tone}`}>{a.severity}</span>
                      <span className="font-mono text-[10px] text-muted-foreground">{a.source}</span>
                    </div>
                    <p className="truncate font-mono text-[11px] text-foreground/90">{a.message}</p>
                  </div>
                  <span className="shrink-0 font-mono text-[9px] text-muted-foreground">{relTime(a.createdAt)}</span>
                  {!a.ack && (
                    <button
                      onClick={() => ack(a.id)}
                      className="shrink-0 rounded border border-border/60 px-1.5 py-0.5 font-mono text-[9px] uppercase text-muted-foreground transition-colors hover:border-emerald-500/40 hover:text-emerald-300"
                    >
                      ack
                    </button>
                  )}
                </motion.li>
              );
            })
          )}
        </ul>
      </div>
    </section>
  );
}

/** SkillsRegistry — the autonomous capability inventory. */
export function SkillsRegistry() {
  const skills = useMissionStore((s) => s.skills);
  const grouped = useMemo(() => {
    const g: Record<string, typeof skills> = {};
    for (const c of SKILL_CATEGORIES) g[c] = [];
    for (const s of skills) {
      const key = (s.category in g ? s.category : "llm") as SkillCategory;
      g[key].push(s);
    }
    return g;
  }, [skills]);

  return (
    <section className="mc-surface flex min-h-0 flex-col">
      <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
        <div className="flex items-center gap-2">
          <Puzzle className="h-4 w-4 text-violet-300" />
          <h2 className="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-foreground">
            Skills Registry
          </h2>
        </div>
        <span className="flex items-center gap-1 font-mono text-[10px] text-muted-foreground">
          <Boxes className="h-3 w-3" /> {skills.length} capabilities
        </span>
      </div>
      <div className="mc-scroll max-h-[24rem] flex-1 overflow-y-auto p-2.5">
        <div className="space-y-3">
          {SKILL_CATEGORIES.map((cat) => {
            const items = grouped[cat] ?? [];
            if (items.length === 0) return null;
            return (
              <div key={cat}>
                <div className="mb-1.5 px-1 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                  {cat} · {items.length}
                </div>
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                  {items.map((s) => (
                    <motion.div
                      key={s.id}
                      layout
                      className={`rounded-md border p-2 ${CATEGORY_TONE[(s.category in CATEGORY_TONE ? s.category : "llm") as SkillCategory]}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-mono text-xs font-medium text-foreground">{s.name}</span>
                        <span className="font-mono text-[9px] tabular-nums text-muted-foreground">{Math.round(s.successRate * 100)}%</span>
                      </div>
                      {s.description && (
                        <p className="mt-0.5 line-clamp-1 text-[10px] text-muted-foreground">{s.description}</p>
                      )}
                      <div className="mt-1 flex items-center justify-between font-mono text-[9px] text-muted-foreground">
                        <span>/{s.slug}</span>
                        <span>{s.invocations.toLocaleString()} calls</span>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
