"use client";

import { useEffect } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

/**
 * error.tsx — route-level error boundary (v42: captures to ErrorLog).
 *
 * Catches any runtime render error in the mission shell, sends it to
 * the /api/errors endpoint for DB logging (ErrorLog table), and offers
 * a one-click recovery without a full reload of the browser session.
 */
export default function MissionError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[aria] mission error:", error);

    // v42: Capture to ErrorLog via the /api/errors endpoint
    fetch("/api/errors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: error.message,
        stack: error.stack,
        digest: error.digest,
        url: window.location.href,
        userAgent: navigator.userAgent,
        severity: "error",
        source: "error-boundary",
      }),
    }).catch(() => {
      // silent — don't infinite-loop if the error endpoint itself fails
    });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="mc-surface-elevated max-w-md p-6 text-center">
        <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full border border-rose-500/40 bg-rose-500/10">
          <AlertTriangle className="h-5 w-5 text-rose-300" />
        </div>
        <h2 className="font-mono text-sm font-semibold text-foreground">Mission panel error</h2>
        <p className="mt-1 break-words font-mono text-xs text-muted-foreground">
          {error.message || "an unexpected render error occurred"}
        </p>
        {error.digest && (
          <p className="mt-1 font-mono text-[10px] text-muted-foreground/60">digest: {error.digest}</p>
        )}
        <button
          onClick={reset}
          className="mt-4 inline-flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-3 py-1.5 font-mono text-xs text-primary transition-colors hover:bg-primary/20"
        >
          <RotateCcw className="h-3.5 w-3.5" /> Recover panel
        </button>
      </div>
    </div>
  );
}
