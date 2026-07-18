'use client';

// =====================================================================
// error.tsx — Next.js App Router route-level error boundary.
// =====================================================================
// Catches errors thrown during render of any route segment below it.
// (React Error Boundary in src/components/jarvis/ErrorBoundary.tsx
// handles errors inside the layout tree; this file catches errors
// raised by the route itself — e.g. during server component streaming
// or in a page that bails out of static rendering.)
//
// Receives `error` + `reset` from Next.js. `reset` re-attempts the
// failed render. Rendered with JARVIS design tokens.
// =====================================================================

import { useEffect } from 'react';
import { JARVIS } from '@/lib/config';
import { trackAction } from '@/lib/action-tracker';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // Log + track the error once on mount.
  useEffect(() => {
    console.error('[route error.tsx] Route-level error:', error);
    try {
      trackAction('error', {
        target: 'route-error-boundary',
        label: (error?.message ?? 'Unknown error').slice(0, 200),
        severity: 'critical',
        meta: {
          message: error?.message,
          stack: error?.stack?.slice(0, 2000),
          digest: error?.digest,
          source: 'next-app-router:error.tsx',
        },
      });
    } catch {
      // swallow — telemetry must never break recovery
    }
  }, [error]);

  const accent = JARVIS.colors.red;

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="min-h-screen flex items-center justify-center p-6"
      style={{ background: JARVIS.colors.bg, color: JARVIS.colors.text }}
    >
      <div
        className="w-full max-w-xl rounded-xl overflow-hidden"
        style={{
          background: JARVIS.colors.panel,
          border: `1px solid ${accent}55`,
          boxShadow: `0 0 40px ${accent}22, 0 0 0 1px ${accent}11 inset`,
        }}
      >
        {/* Header */}
        <div
          className="flex items-center gap-3 px-5 py-3"
          style={{ borderBottom: `1px solid ${JARVIS.colors.border}`, background: `${accent}10` }}
        >
          <div
            className="flex h-8 w-8 items-center justify-center rounded-md"
            style={{ background: `${accent}1a`, border: `1px solid ${accent}44`, color: accent }}
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          </div>
          <div>
            <div className="jarvis-mono text-[10px] uppercase tracking-widest" style={{ color: accent }}>
              JARVIS · Route Error
            </div>
            <div className="text-xs" style={{ color: JARVIS.colors.textDim }}>
              The requested view failed to render.
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4">
          <div>
            <div className="jarvis-mono text-[10px] uppercase mb-1" style={{ color: JARVIS.colors.textMute }}>
              Error Message
            </div>
            <div
              className="text-sm font-mono break-words rounded-md p-3"
              style={{
                background: JARVIS.colors.bgSoft,
                border: `1px solid ${JARVIS.colors.border}`,
                color: accent,
              }}
            >
              {error?.message || 'Unknown error'}
            </div>
          </div>

          {error?.digest && (
            <div>
              <div className="jarvis-mono text-[10px] uppercase mb-1" style={{ color: JARVIS.colors.textMute }}>
                Digest
              </div>
              <div
                className="text-[11px] font-mono break-all rounded-md p-2"
                style={{
                  background: JARVIS.colors.bgSoft,
                  border: `1px solid ${JARVIS.colors.border}`,
                  color: JARVIS.colors.textDim,
                }}
              >
                {error.digest}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="button"
              onClick={() => reset()}
              className="jarvis-mono text-[11px] uppercase tracking-wider px-4 py-2 rounded-md transition-all hover:scale-[1.03]"
              style={{
                background: accent,
                color: JARVIS.colors.bg,
                border: `1px solid ${accent}`,
                fontWeight: 600,
              }}
            >
              Try Again
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="jarvis-mono text-[11px] uppercase tracking-wider px-4 py-2 rounded-md transition-all hover:scale-[1.03]"
              style={{
                background: `${accent}10`,
                color: accent,
                border: `1px solid ${accent}44`,
              }}
            >
              Reload Page
            </button>
            <a
              href="/"
              className="jarvis-mono text-[11px] uppercase tracking-wider px-4 py-2 rounded-md transition-all hover:scale-[1.03] inline-flex items-center"
              style={{
                background: 'transparent',
                color: JARVIS.colors.textDim,
                border: `1px solid ${JARVIS.colors.border}`,
              }}
            >
              Home
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
