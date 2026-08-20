"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { AlertTriangle, X, Loader2, HeartPulse } from "lucide-react";
import { useMissionStore } from "@/stores/mission-store";

/**
 * SystemHealthBanner — slim dismissible banner shown above the tabs when
 * the agent fleet is degraded or critical.
 *
 * Critical: any agent has status "error" or "offline" (rose accent).
 * Degraded: >30% of agents are "idle" or "offline" with no errors (amber).
 *
 * Dismissal is stored in component state; if health gets WORSE than when
 * the user dismissed (e.g. degraded → critical), the banner re-shows.
 *
 * "Heal All" iterates over every error/offline agent and POSTs each id to
 * /api/monitor/heal (the API requires an agentId per call), then surfaces
 * a single aggregated toast.
 *
 * Task ID: FEATURES-TICKER-FAB (Task 3).
 */

type HealthLevel = "degraded" | "critical";

const LEVEL_RANK: Record<HealthLevel, number> = { degraded: 1, critical: 2 };

export function SystemHealthBanner() {
  const agents = useMissionStore((s) => s.agents);

  const { level, errorCount, offlineCount, idleCount, totalAgents, unhealthyAgentIds } =
    useMemo(() => {
      const arr = Object.values(agents);
      const errorIds = arr.filter((a) => a.status === "error").map((a) => a.id);
      const offlineIds = arr.filter((a) => a.status === "offline").map((a) => a.id);
      const idleN = arr.filter((a) => a.status === "idle").length;
      const offlineN = offlineIds.length;
      const errorN = errorIds.length;
      const total = arr.length;

      const critical = errorN > 0 || offlineN > 0;
      const degraded = !critical && total > 0 && (idleN + offlineN) / total > 0.3;

      const unhealthyIds = [...errorIds, ...offlineIds];
      return {
        level: (critical ? "critical" : degraded ? "degraded" : null) as HealthLevel | null,
        errorCount: errorN,
        offlineCount: offlineN,
        idleCount: idleN,
        totalAgents: total,
        unhealthyAgentIds: unhealthyIds,
      };
    }, [agents]);

  const [dismissed, setDismissed] = useState(false);
  const dismissedLevel = useRef<HealthLevel | null>(null);
  const [healing, setHealing] = useState(false);

  // Re-show banner if health worsens beyond the level the user dismissed.
  useEffect(() => {
    if (!level) {
      // System recovered — reset dismissal so the banner can reappear
      // next time health degrades.
      dismissedLevel.current = null;
      setDismissed(false);
      return;
    }
    if (
      dismissedLevel.current &&
      LEVEL_RANK[level] > LEVEL_RANK[dismissedLevel.current]
    ) {
      setDismissed(false);
      dismissedLevel.current = null;
    }
  }, [level]);

  const handleHealAll = async () => {
    if (unhealthyAgentIds.length === 0) {
      toast.info("No error/offline agents to heal.");
      return;
    }
    setHealing(true);
    const tid = toast.loading(
      `Healing ${unhealthyAgentIds.length} agent${unhealthyAgentIds.length === 1 ? "" : "s"}…`
    );
    try {
      const results = await Promise.allSettled(
        unhealthyAgentIds.map((id) =>
          fetch("/api/monitor/heal", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ agentId: id }),
          }).then(async (r) => {
            const data = await r.json().catch(() => ({}));
            return { id, ok: r.ok, healed: !!data?.healed, action: data?.action };
          })
        )
      );
      const fulfilled = results.filter((r) => r.status === "fulfilled") as PromiseFulfilledResult<{
        id: string;
        ok: boolean;
        healed: boolean;
        action?: string;
      }>[];
      const healedCount = fulfilled.filter((r) => r.value.healed).length;
      const failedCount = results.length - healedCount;

      if (failedCount === 0) {
        toast.success(`Heal complete — ${healedCount} agent${healedCount === 1 ? "" : "s"} recovered`, {
          id: tid,
        });
      } else if (healedCount === 0) {
        toast.error(`Heal failed — ${failedCount} agent${failedCount === 1 ? "" : "s"} could not recover`, {
          id: tid,
          description: "Check system logs for details.",
        });
      } else {
        toast.warning(`Partial heal — ${healedCount} recovered, ${failedCount} failed`, {
          id: tid,
        });
      }
    } catch (err) {
      toast.error("Heal request failed", {
        id: tid,
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setHealing(false);
    }
  };

  const visible = level && !dismissed;

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          className="overflow-hidden"
        >
          <div
            className={`mx-auto flex w-full max-w-[1600px] items-center gap-3 rounded-lg border px-4 py-2 sm:px-6 ${
              level === "critical"
                ? "border-rose-500/40 border-l-2 border-l-rose-500 bg-rose-500/10"
                : "border-amber-500/40 border-l-2 border-l-amber-500 bg-amber-500/10"
            }`}
          >
            <AlertTriangle
              className={`h-4 w-4 shrink-0 ${
                level === "critical" ? "text-rose-400" : "text-amber-400"
              }`}
            />
            <div className="min-w-0 flex-1 leading-tight">
              <span
                className={`font-mono text-[11px] font-semibold uppercase tracking-wider ${
                  level === "critical" ? "text-rose-300" : "text-amber-300"
                }`}
              >
                System {level}
              </span>
              <span className="ml-2 text-[11px] text-foreground">
                {errorCount + offlineCount} agent{errorCount + offlineCount === 1 ? "" : "s"} need attention
                {errorCount > 0 && ` · ${errorCount} in error`}
                {offlineCount > 0 && ` · ${offlineCount} offline`}
                {level === "degraded" && idleCount > 0 && ` · ${idleCount} idle`}
              </span>
            </div>

            <button
              type="button"
              onClick={handleHealAll}
              disabled={healing || unhealthyAgentIds.length === 0}
              className={`flex shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-wider transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                level === "critical"
                  ? "border-rose-500/40 bg-rose-500/15 text-rose-200 hover:bg-rose-500/25"
                  : "border-amber-500/40 bg-amber-500/15 text-amber-200 hover:bg-amber-500/25"
              }`}
            >
              {healing ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <HeartPulse className="h-3 w-3" />
              )}
              Heal All
            </button>

            <button
              type="button"
              onClick={() => {
                setDismissed(true);
                if (level) dismissedLevel.current = level;
              }}
              aria-label="Dismiss banner"
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-border/60 text-muted-foreground transition-colors hover:border-border hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export default SystemHealthBanner;
