"use client";

import { useCallback, useState, type ReactNode } from "react";
import { Maximize2, Minimize2, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogPortal,
  DialogOverlay,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/**
 * FullScreenPanel — a panel wrapper with header (title + icon) and a
 * "fullscreen" toggle button.
 *
 * v36 fix: the fullscreen Dialog was not opening properly because:
 *   1. The DialogContent inherited `p-6 gap-4` from the base dialog.tsx
 *      which conflicted with the `p-0` override — fixed by using `!p-0`.
 *   2. The z-50 on the dialog was the same as the header's z-40, causing
 *      visual stacking issues on some browsers — bumped to z-[100].
 *   3. The DialogOverlay was rendered twice (once by DialogContent
 *      internally, once explicitly here) — removed the duplicate.
 */
interface FullScreenPanelProps {
  title: string;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Extra header buttons rendered OUTSIDE the fullscreen button. */
  actions?: ReactNode;
}

export function FullScreenPanel({
  title,
  icon,
  children,
  className,
  actions,
}: FullScreenPanelProps) {
  const [fullscreen, setFullscreen] = useState(false);

  const open = useCallback(() => setFullscreen(true), []);
  const close = useCallback(() => setFullscreen(false), []);

  return (
    <>
      <section
        className={cn(
          "mc-surface relative flex flex-col overflow-hidden rounded-xl border border-border/60",
          className
        )}
      >
        {/* Header row */}
        <header className="relative flex items-center justify-between gap-3 border-b border-border/60 px-4 py-2.5">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-violet-500/20 via-transparent to-transparent" />
          <div className="flex min-w-0 items-center gap-2">
            {icon}
            <h2 className="truncate font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-foreground">
              {title}
            </h2>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {actions}
            <button
              type="button"
              onClick={open}
              aria-label={`Expand ${title} to fullscreen`}
              title="Expand"
              className="flex h-7 w-7 items-center justify-center rounded-md border border-border/60 text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </header>

        {/* Body — compact by default */}
        <div className="relative flex-1 min-h-0">{children}</div>
      </section>

      {/* Fullscreen overlay — z-[100] ensures it's above the header (z-40) + tab nav (z-20) */}
      <Dialog open={fullscreen} onOpenChange={setFullscreen}>
        <DialogPortal>
          <DialogOverlay className="bg-black/80 backdrop-blur-md z-[100]" />
          <DialogContent
            showCloseButton={false}
            className="left-[50%] top-[50%] grid w-[90vw] max-w-[calc(100vw-3rem)] translate-x-[-50%] translate-y-[-50%] gap-0 rounded-xl border-border/60 p-0 shadow-[0_0_60px_-15px_rgba(139,92,246,0.3)] sm:max-w-[90vw] z-[100] !p-0 !gap-0"
            style={{ height: "90vh", maxWidth: "90vw" }}
          >
            <DialogTitle className="sr-only">{title}</DialogTitle>
            <header className="relative flex items-center justify-between gap-3 border-b border-border/60 px-4 py-2.5">
              <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-violet-500/20 via-transparent to-transparent" />
              <div className="flex min-w-0 items-center gap-2">
                {icon}
                <h2 className="truncate font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-foreground">
                  {title}
                </h2>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {actions}
                <button
                  type="button"
                  onClick={close}
                  aria-label={`Close ${title} fullscreen`}
                  title="Close"
                  className="flex h-7 w-7 items-center justify-center rounded-md border border-border/60 text-muted-foreground transition-colors hover:border-rose-500/40 hover:text-rose-300"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </header>
            <div className="mc-scroll relative min-h-0 flex-1 overflow-auto">
              {children}
            </div>
            <div className="pointer-events-none absolute bottom-2 right-2 flex items-center gap-1 rounded border border-border/40 bg-background/70 px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground backdrop-blur">
              <Minimize2 className="h-2.5 w-2.5" />
              <span>press X to exit</span>
            </div>
          </DialogContent>
        </DialogPortal>
      </Dialog>
    </>
  );
}

export default FullScreenPanel;
