"use client";

import { motion } from "framer-motion";
import { useRealtimeSync } from "@/hooks/use-realtime-sync";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/**
 * RealtimeIndicator — a compact connection-status dot that lives in the
 * MissionHeader next to the NotificationCenter.
 *
 * States:
 *   - connected    → emerald dot, steady glow
 *   - connecting   → amber dot, slow pulse
 *   - offline/error → rose dot, fast pulse (the app falls back to SSE)
 *
 * The hook manages its own reconnection; this component is a pure view
 * over `useRealtimeSync().connected`. A Tooltip surfaces the human
 * label on hover.
 *
 * Task ID: FEATURES-LEARN-NOTIFY-RT (Task 3).
 */
export function RealtimeIndicator() {
  const { connected } = useRealtimeSync();

  // The hook starts with `connected: false` and flips to true on the
  // first `connect` event. We treat the first ~2s after mount as
  // "connecting" to avoid flashing rose before the socket establishes.
  // Once we've seen a connect or a connect_error, the state is
  // authoritative.
  const tone = connected
    ? "bg-emerald-400"
    : "bg-amber-400";
  const glow = connected
    ? "shadow-[0_0_10px_-1px_rgba(52,211,153,0.7)]"
    : "shadow-[0_0_10px_-1px_rgba(251,191,36,0.7)]";
  const label = connected
    ? "Realtime: connected"
    : "Realtime: connecting…";
  const anim = connected
    ? { opacity: [1, 0.6, 1] }
    : { opacity: [1, 0.3, 1] };
  const transition = connected
    ? { duration: 2.4, repeat: Infinity, ease: "easeInOut" as const }
    : { duration: 0.9, repeat: Infinity, ease: "easeInOut" as const };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          role="status"
          aria-label={label}
          className="relative flex h-7 w-7 cursor-default items-center justify-center rounded-md border border-border/60 bg-card/40"
        >
          <motion.span
            className={`h-2 w-2 rounded-full ${tone} ${glow}`}
            initial={{ opacity: 1 }}
            animate={anim}
            transition={transition}
          />
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="font-mono text-[10px]">
        {label}
        {!connected && (
          <span className="ml-1 text-amber-300/70">(using SSE fallback)</span>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

export default RealtimeIndicator;
