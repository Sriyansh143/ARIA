"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import {
  Database,
  Plus,
  Trash2,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  FlaskConical,
  Users,
  Briefcase,
  DollarSign,
  Mail,
  Brain,
  Bell,
  Sparkles,
} from "lucide-react";
import { FullScreenPanel } from "./full-screen-panel";

/**
 * SampleDataManager — Add / Delete sample data for demos and testing.
 *
 * GET  /api/sample-data  — table counts
 * POST /api/sample-data  — seed sample records (agents, tasks, deals, etc.)
 * DELETE /api/sample-data — wipe ALL business data (keeps agent roster + infra)
 *
 * This panel lets operators populate the dashboard with realistic demo
 * data with one click, or wipe it clean to start fresh. Useful for:
 *  - First-run demos
 *  - Testing UI with data
 *  - Resetting after experiments
 */
export function SampleDataManager() {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [infra, setInfra] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);
  const [wiping, setWiping] = useState(false);
  const [confirmWipe, setConfirmWipe] = useState(false);

  const fetchCounts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/sample-data");
      const data = await res.json();
      setCounts(data.counts ?? {});
      setInfra(data.infra ?? {});
    } catch {
      setCounts({});
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCounts();
  }, [fetchCounts]);

  const handleSeed = useCallback(async () => {
    setSeeding(true);
    try {
      const res = await fetch("/api/sample-data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force: false }),
      });
      const data = await res.json();
      if (data.ok) {
        const seeded = data.seeded as Record<string, number>;
        const total = Object.values(seeded).reduce((a, b) => a + b, 0);
        toast.success(`Sample data seeded (${total} records added)`);
        await fetchCounts();
      } else {
        toast.error(data.error || "Failed to seed");
      }
    } catch {
      toast.error("Network error while seeding");
    } finally {
      setSeeding(false);
    }
  }, [fetchCounts]);

  const handleWipe = useCallback(async () => {
    setWiping(true);
    try {
      const res = await fetch("/api/sample-data", { method: "DELETE" });
      const data = await res.json();
      if (data.ok) {
        toast.success(`Wiped ${data.total} business records (agent roster preserved)`);
        setConfirmWipe(false);
        await fetchCounts();
      } else {
        toast.error(data.error || "Failed to wipe");
      }
    } catch {
      toast.error("Network error while wiping");
    } finally {
      setWiping(false);
    }
  }, [fetchCounts]);

  const businessTables: Array<{ key: string; label: string; icon: typeof Users }> = [
    { key: "task", label: "Tasks", icon: CheckCircle2 },
    { key: "approval", label: "Approvals", icon: AlertTriangle },
    { key: "deal", label: "Deals", icon: Briefcase },
    { key: "revenueEvent", label: "Revenue", icon: DollarSign },
    { key: "agentMessage", label: "Messages", icon: Mail },
    { key: "memoryItem", label: "Memories", icon: Brain },
    { key: "systemAlert", label: "Alerts", icon: Bell },
    { key: "skill", label: "Skills", icon: Sparkles },
  ];

  const totalBusiness = Object.values(counts).reduce((a, b) => a + Math.max(0, b), 0);

  return (
    <FullScreenPanel title="Sample Data Manager" icon={<FlaskConical className="h-3.5 w-3.5 text-amber-400" />}>
      <div className="space-y-4 p-4">
        {/* Action bar */}
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 bg-surface-2 p-3">
          <button
            onClick={() => void handleSeed()}
            disabled={seeding}
            className="flex items-center gap-1.5 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-emerald-300 transition-colors hover:bg-emerald-500/20 disabled:opacity-50"
          >
            {seeding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            {seeding ? "Seeding…" : "Add Sample Data"}
          </button>

          {!confirmWipe ? (
            <button
              onClick={() => setConfirmWipe(true)}
              disabled={wiping || totalBusiness === 0}
              className="flex items-center gap-1.5 rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-rose-300 transition-colors hover:bg-rose-500/20 disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete All Sample Data
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <span className="font-mono text-[10px] text-rose-300">Confirm wipe? This cannot be undone.</span>
              <button
                onClick={() => void handleWipe()}
                disabled={wiping}
                className="flex items-center gap-1 rounded-md border border-rose-500/50 bg-rose-500/20 px-2 py-1 font-mono text-[9px] font-bold uppercase text-rose-200 hover:bg-rose-500/30 disabled:opacity-50"
              >
                {wiping ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                Yes, Wipe
              </button>
              <button
                onClick={() => setConfirmWipe(false)}
                className="rounded-md border border-border/60 px-2 py-1 font-mono text-[9px] uppercase text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
            </div>
          )}

          <button
            onClick={() => void fetchCounts()}
            disabled={loading}
            className="ml-auto flex items-center gap-1 rounded-md border border-border/60 px-2 py-1.5 font-mono text-[9px] uppercase text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>

        {/* Business data counts */}
        <section>
          <div className="mb-2 flex items-center gap-2">
            <Database className="h-3.5 w-3.5 text-cyan-400" />
            <h3 className="font-mono text-[10px] font-semibold uppercase tracking-wider text-foreground">
              Business Data
            </h3>
            <span className="font-mono text-[9px] text-muted-foreground">
              {totalBusiness} total records
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {businessTables.map(({ key, label, icon: Icon }) => {
              const count = counts[key] ?? 0;
              const has = count > 0;
              return (
                <div
                  key={key}
                  className={`rounded-lg border px-3 py-2.5 transition-colors ${
                    has
                      ? "border-cyan-500/20 bg-cyan-500/5"
                      : "border-border/40 bg-surface-2"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <Icon className={`h-3.5 w-3.5 ${has ? "text-cyan-400" : "text-muted-foreground"}`} />
                    <span
                      className={`font-mono text-lg font-bold tabular-nums ${
                        has ? "text-foreground" : "text-muted-foreground/50"
                      }`}
                    >
                      {count}
                    </span>
                  </div>
                  <div className="mt-1 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                    {label}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Infrastructure (read-only) */}
        <section>
          <div className="mb-2 flex items-center gap-2">
            <Users className="h-3.5 w-3.5 text-violet-400" />
            <h3 className="font-mono text-[10px] font-semibold uppercase tracking-wider text-foreground">
              Infrastructure (Preserved on Wipe)
            </h3>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {[
              { key: "agent", label: "Agents" },
              { key: "personnel", label: "Personnel" },
              { key: "companyProfile", label: "Companies" },
              { key: "cronJob", label: "Cron Jobs" },
              { key: "user", label: "Users" },
            ].map(({ key, label }) => (
              <div key={key} className="rounded-lg border border-border/40 bg-surface-2 px-3 py-2">
                <div className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                  {label}
                </div>
                <div className="font-mono text-sm font-bold tabular-nums text-violet-300">
                  {infra[key] ?? 0}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Info banner */}
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
            <div className="space-y-1 font-mono text-[10px] leading-relaxed text-muted-foreground">
              <p>
                <span className="text-amber-300">Add Sample Data:</span> Seeds realistic demo records
                (tasks, deals, revenue, messages, memories, alerts, skills). Idempotent — only adds
                to empty tables unless <code className="rounded bg-surface-2 px-1">force</code> is passed.
              </p>
              <p>
                <span className="text-rose-300">Delete All:</span> Wipes ALL business data but preserves
                the 37-agent roster, personnel, companies, cron definitions, users, and credentials.
                Agents are reset to idle status.
              </p>
            </div>
          </div>
        </div>

        {loading && (
          <div className="flex items-center justify-center gap-2 py-4 font-mono text-[10px] text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" /> Loading table counts…
          </div>
        )}
      </div>
    </FullScreenPanel>
  );
}

export default SampleDataManager;
