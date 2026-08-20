"use client";

import { motion } from "framer-motion";
import { AlertTriangle, RotateCcw } from "lucide-react";

/**
 * BootBoundary — graceful loading + error states for the mission shell.
 *
 * Catches boot errors (seed fetch failure) and renders an actionable
 * recovery panel instead of a white screen. Runtime render errors are
 * caught by the route-level `error.tsx` boundary.
 */
export function BootBoundary({
  booting,
  bootError,
  onRetry,
  children,
}: {
  booting: boolean;
  bootError: string | null;
  onRetry: () => void;
  children: React.ReactNode;
}) {
  if (bootError) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-6">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="mc-surface-elevated max-w-md p-6 text-center"
        >
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full border border-rose-500/40 bg-rose-500/10">
            <AlertTriangle className="h-5 w-5 text-rose-300" />
          </div>
          <h3 className="font-mono text-sm font-semibold text-foreground">Mission boot failed</h3>
          <p className="mt-1 break-words font-mono text-xs text-muted-foreground">{bootError}</p>
          <button
            onClick={onRetry}
            className="mt-4 inline-flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-3 py-1.5 font-mono text-xs text-primary transition-colors hover:bg-primary/20"
          >
            <RotateCcw className="h-3.5 w-3.5" /> Retry boot
          </button>
        </motion.div>
      </div>
    );
  }

  if (booting) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-6">
        <div className="flex flex-col items-center gap-3">
          <div className="relative h-10 w-10">
            <motion.span
              className="absolute inset-0 rounded-lg border-2 border-primary/20"
              animate={{ rotate: 360 }}
              transition={{ duration: 1.6, repeat: Infinity, ease: "linear" }}
            />
            <motion.span
              className="absolute inset-0 rounded-lg border-t-2 border-primary"
              animate={{ rotate: 360 }}
              transition={{ duration: 1.2, repeat: Infinity, ease: "linear" }}
            />
          </div>
          <div className="text-center">
            <p className="font-mono text-xs font-semibold uppercase tracking-[0.2em] text-foreground">
              Initializing ARIA
            </p>
            <p className="mt-1 font-mono text-[10px] text-muted-foreground">
              booting agent fleet · establishing event stream
            </p>
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
