"use client";

import { useMissionStore } from "@/stores/mission-store";
import { useClock, formatTime } from "@/hooks/use-clock";
import { motion } from "framer-motion";
import { ThemeToggle } from "@/components/mission/theme-toggle";
import { CompanySwitcher } from "@/components/mission/company-switcher";
import { NotificationCenter } from "@/components/mission/notification-center";
import { RealtimeIndicator } from "@/components/mission/realtime-indicator";
import { Radio, Activity, ShieldCheck, Wifi, WifiOff } from "lucide-react";

/**
 * MissionHeader — slim top command bar.
 *
 * Left: ARIA • MISSION CONTROL brand + STREAM LIVE indicator
 * Right: System Health %, Uptime, Realtime dot, Notification bell,
 *        Theme Toggle, Company Switcher
 *
 * NOTE: Detailed metrics (agent counts, tasks, alerts) are in the
 * PrimaryStatsBar below the header — NOT duplicated here.
 *
 * Task ID: FEATURES-LEARN-NOTIFY-RT — added onJumpTo prop and
 * integrated <NotificationCenter> + <RealtimeIndicator> into the
 * right-side action area. Added a subtle gradient bottom border.
 */
export function MissionHeader({ onJumpTo }: { onJumpTo?: (target: string) => void }) {
  const now = useClock();
  const connection = useMissionStore((s) => s.connection);
  const heartbeat = useMissionStore((s) => s.heartbeat);
  const agents = useMissionStore((s) => s.agents);

  const connected = connection === "open";
  const agentArr = Object.values(agents);
  const totalAgents = agentArr.length;
  const healthyAgents = agentArr.filter((a) => a.status !== "error" && a.status !== "offline").length;
  const healthPercent = totalAgents > 0 ? Math.round((healthyAgents / totalAgents) * 100) : 100;
  const uptime = heartbeat?.uptime ? formatUptime(heartbeat.uptime) : "—";

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur-xl">
      <div className="mx-auto flex max-w-[1600px] items-center justify-between px-4 py-2.5 sm:px-6">
        {/* Left: Brand + Stream Live indicator */}
        <div className="flex items-center gap-3">
          <div className="relative flex h-8 w-8 items-center justify-center rounded-lg border border-violet-500/40 bg-violet-500/10">
            <motion.span
              className="absolute inset-0 rounded-lg"
              style={{ boxShadow: "0 0 18px -4px rgba(139, 92, 246, 0.6)" }}
              initial={{ opacity: 0.4 }} animate={{ opacity: [0.4, 1, 0.4] }}
              transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
            />
            <Radio className="relative h-4 w-4 text-violet-400" />
          </div>
          <div className="leading-tight">
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-semibold tracking-tight text-foreground">
                ARIA
              </span>
              <span className="text-violet-400">·</span>
              <span className="text-sm font-semibold tracking-tight text-foreground">
                MISSION CONTROL
              </span>
            </div>
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              {connected ? (
                <>
                  <motion.span
                    className="h-1.5 w-1.5 rounded-full bg-emerald-400"
                    initial={{ opacity: 1 }} animate={{ opacity: [1, 0.3, 1] }}
                    transition={{ duration: 1.5, repeat: Infinity }}
                  />
                  <Wifi className="h-3 w-3 text-emerald-400" />
                  <span className="text-emerald-400 font-medium">STREAM LIVE</span>
                </>
              ) : (
                <>
                  <WifiOff className="h-3 w-3 text-amber-400" />
                  <span className="text-amber-400">RECONNECTING…</span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Right: System Health, Uptime, Theme, Company */}
        <div className="flex items-center gap-3">
          {/* System Health */}
          <div className="hidden items-center gap-2 rounded-lg border border-border bg-card/40 px-3 py-1.5 sm:flex">
            <ShieldCheck className={`h-3.5 w-3.5 ${healthPercent === 100 ? "text-emerald-400" : healthPercent > 70 ? "text-amber-400" : "text-rose-400"}`} />
            <div className="leading-none">
              <div className="text-[9px] uppercase tracking-wider text-muted-foreground">Health</div>
              <div className={`text-xs font-semibold tabular-nums ${healthPercent === 100 ? "text-emerald-400" : healthPercent > 70 ? "text-amber-400" : "text-rose-400"}`}>
                {healthPercent}%
              </div>
            </div>
          </div>

          {/* Uptime */}
          <div className="hidden items-center gap-2 rounded-lg border border-border bg-card/40 px-3 py-1.5 sm:flex">
            <Activity className="h-3.5 w-3.5 text-cyan-400" />
            <div className="leading-none">
              <div className="text-[9px] uppercase tracking-wider text-muted-foreground">Uptime</div>
              <div className="text-xs font-semibold tabular-nums text-foreground">{uptime}</div>
            </div>
          </div>

          {/* Clock */}
          <div className="hidden items-center gap-2 rounded-lg border border-border bg-card/40 px-3 py-1.5 md:flex">
            <div className="leading-none">
              <div className="text-[9px] uppercase tracking-wider text-muted-foreground">Time</div>
              <div className="text-xs font-semibold tabular-nums text-foreground">{formatTime(now?.toISOString() ?? null)}</div>
            </div>
          </div>

          <CompanySwitcher />
          <ThemeToggle />

          {/* Realtime status + Notifications (Task ID: FEATURES-LEARN-NOTIFY-RT) */}
          <RealtimeIndicator />
          <NotificationCenter />
        </div>
      </div>
      {/* Subtle animated scanline under the header */}
      <div className="mc-sweep-line h-px w-full animate-pulse opacity-60" />
      {/* Subtle gradient bottom border (Task ID: FEATURES-LEARN-NOTIFY-RT) */}
      <div className="h-px w-full bg-gradient-to-r from-transparent via-violet-500/20 to-transparent" />
    </header>
  );
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}
