'use client';

// =====================================================================
// global-error.tsx — Next.js App Router ROOT error boundary.
// =====================================================================
// This catches errors that error.tsx CANNOT catch — specifically errors
// thrown while rendering the ROOT LAYOUT itself (src/app/layout.tsx),
// or errors thrown in a server component above the route segment boundary.
//
// Contract per Next.js docs:
//   • MUST be a client component ('use client').
//   • MUST render its own <html> + <body> tags (it replaces the entire
//     document — layout.tsx is NOT used here).
//   • CANNOT rely on Tailwind globals.css or any providers from layout.tsx
//     (ActionTrackerProvider, theme provider, ErrorBoundary) — they live
//     INSIDE the layout that just crashed. So we use inline styles + a
//     raw fetch() for telemetry instead of the action-tracker module.
//
// The component receives { error, reset } from Next.js. `reset` re-attempts
// the failed render of the root layout. We also fire-and-forget POST the
// error to /api/user-actions so monitor agents can see critical crashes
// even when the rest of the app is dead.
// =====================================================================

import { useEffect } from 'react';

// ── JARVIS design tokens (inlined — no external CSS dependency) ──────
const COLORS = {
  bg: '#08090A',
  bgSoft: '#0C0F14',
  panel: '#0E1218',
  border: '#1B2330',
  borderSoft: '#141B26',
  cyan: '#7DD3FC',
  green: '#34D399',
  amber: '#FBBF24',
  red: '#F87171',
  violet: '#C4B5FD',
  text: '#E2E8F0',
  textDim: '#94A3B8',
  textMute: '#64748B',
};

const MONO_FONT =
  "'Geist Mono','JetBrains Mono','SF Mono','Menlo','Consolas',ui-monospace,monospace";
const SANS_FONT =
  "'Geist Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // ── Telemetry: fire-and-forget POST to /api/user-actions ──────────
  // We deliberately bypass src/lib/action-tracker.ts here because that
  // module depends on the nav store (provided by ActionTrackerProvider,
  // which lives INSIDE the layout that just crashed). A raw fetch with
  // keepalive survives page unload.
  useEffect(() => {
    const message = error?.message ?? 'Unknown error';
    const stack = error?.stack?.slice(0, 2000);
    const digest = error?.digest;

    // Console log for server-side / dev visibility.
    console.error('[global-error.tsx] ROOT error caught:', message, stack);

    // Fire-and-forget telemetry — never blocks recovery, never throws.
    try {
      const payload = JSON.stringify({
        type: 'error',
        target: 'global-error-boundary',
        label: message.slice(0, 200),
        tab: null,
        meta: JSON.stringify({
          message,
          stack,
          digest,
          source: 'next-app-router:global-error.tsx',
          fatal: true,
        }),
        severity: 'critical',
        duration: null,
        actor: 'operator',
        sessionId: 'default',
      });

      // Prefer sendBeacon (survives page unload) → fallback to fetch(keepalive).
      if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
        const blob = new Blob([payload], { type: 'application/json' });
        navigator.sendBeacon('/api/user-actions', blob);
      } else if (typeof fetch !== 'undefined') {
        void fetch('/api/user-actions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
          keepalive: true,
        }).catch(() => undefined);
      }
    } catch {
      // Telemetry must never break recovery — swallow.
    }
  }, [error]);

  const accent = COLORS.red;

  // ── Inline-styled full-document fallback ─────────────────────────
  // We intentionally use inline styles (no className / no globals.css)
  // because global-error.tsx replaces the entire <html> document — the
  // Tailwind stylesheet loaded by layout.tsx may not be present.
  return (
    <html lang="en" style={{ background: COLORS.bg, color: COLORS.text }}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>JARVIS · Critical Error</title>
        <style>{`
          * { box-sizing: border-box; }
          body {
            margin: 0;
            min-height: 100vh;
            background: ${COLORS.bg};
            color: ${COLORS.text};
            font-family: ${SANS_FONT};
            -webkit-font-smoothing: antialiased;
            -moz-osx-font-smoothing: grayscale;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 24px;
          }
          .jarvis-panel {
            width: 100%;
            max-width: 640px;
            background: ${COLORS.panel};
            border: 1px solid ${accent}55;
            border-radius: 12px;
            overflow: hidden;
            box-shadow: 0 0 40px ${accent}22, 0 0 0 1px ${accent}11 inset;
          }
          .jarvis-header {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 14px 20px;
            border-bottom: 1px solid ${COLORS.border};
            background: ${accent}10;
          }
          .jarvis-icon {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 32px;
            height: 32px;
            border-radius: 8px;
            background: ${accent}1a;
            border: 1px solid ${accent}44;
            color: ${accent};
            flex-shrink: 0;
          }
          .jarvis-mono {
            font-family: ${MONO_FONT};
          }
          .jarvis-label {
            font-family: ${MONO_FONT};
            font-size: 10px;
            letter-spacing: 0.18em;
            text-transform: uppercase;
            color: ${accent};
            line-height: 1.4;
          }
          .jarvis-sub {
            font-size: 12px;
            color: ${COLORS.textDim};
            line-height: 1.4;
          }
          .jarvis-body {
            padding: 20px;
            display: flex;
            flex-direction: column;
            gap: 16px;
          }
          .jarvis-section-label {
            font-family: ${MONO_FONT};
            font-size: 10px;
            letter-spacing: 0.18em;
            text-transform: uppercase;
            color: ${COLORS.textMute};
            margin-bottom: 6px;
          }
          .jarvis-msg {
            font-family: ${MONO_FONT};
            font-size: 13px;
            color: ${accent};
            background: ${COLORS.bgSoft};
            border: 1px solid ${COLORS.border};
            border-radius: 6px;
            padding: 12px;
            word-break: break-word;
            white-space: pre-wrap;
            max-height: 200px;
            overflow-y: auto;
          }
          .jarvis-digest {
            font-family: ${MONO_FONT};
            font-size: 11px;
            color: ${COLORS.textDim};
            background: ${COLORS.bgSoft};
            border: 1px solid ${COLORS.border};
            border-radius: 6px;
            padding: 8px 10px;
            word-break: break-all;
          }
          .jarvis-actions {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            padding-top: 4px;
          }
          .jarvis-btn {
            font-family: ${MONO_FONT};
            font-size: 11px;
            letter-spacing: 0.1em;
            text-transform: uppercase;
            font-weight: 600;
            padding: 9px 16px;
            border-radius: 6px;
            cursor: pointer;
            border: 1px solid ${accent};
            background: ${accent};
            color: ${COLORS.bg};
            transition: transform 0.12s ease, opacity 0.12s ease;
          }
          .jarvis-btn:hover { transform: scale(1.04); }
          .jarvis-btn-secondary {
            background: ${accent}10;
            color: ${accent};
          }
          .jarvis-btn-ghost {
            background: transparent;
            color: ${COLORS.textDim};
            border: 1px solid ${COLORS.border};
            text-decoration: none;
            display: inline-flex;
            align-items: center;
          }
          .jarvis-footer {
            padding: 10px 20px;
            border-top: 1px solid ${COLORS.borderSoft};
            font-family: ${MONO_FONT};
            font-size: 9px;
            letter-spacing: 0.16em;
            text-transform: uppercase;
            color: ${COLORS.textMute};
            display: flex;
            justify-content: space-between;
            align-items: center;
          }
          @media (max-width: 480px) {
            body { padding: 12px; }
            .jarvis-body { padding: 16px; }
            .jarvis-btn { flex: 1; min-width: 120px; text-align: center; }
          }
        `}</style>
      </head>
      <body>
        <div className="jarvis-panel" role="alert" aria-live="assertive">
          {/* Header */}
          <div className="jarvis-header">
            <span className="jarvis-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
            </span>
            <div>
              <div className="jarvis-label">JARVIS · Critical System Error</div>
              <div className="jarvis-sub">
                The root layout failed to render. Mission Control is offline.
              </div>
            </div>
          </div>

          {/* Body */}
          <div className="jarvis-body">
            <div>
              <div className="jarvis-section-label">Error Message</div>
              <div className="jarvis-msg">
                {error?.message || 'Unknown error — no message available.'}
              </div>
            </div>

            {error?.digest && (
              <div>
                <div className="jarvis-section-label">Digest</div>
                <div className="jarvis-digest">{error.digest}</div>
              </div>
            )}

            <div>
              <div className="jarvis-section-label">What happened?</div>
              <div className="jarvis-sub" style={{ fontSize: 13, lineHeight: 1.5 }}>
                This is a <strong>root-level</strong> error caught by Next.js&apos;
                <code className="jarvis-mono" style={{ color: COLORS.textDim }}> global-error.tsx</code>
                boundary. It means the application&apos;s root layout itself crashed —
                the standard route error boundary (<code className="jarvis-mono" style={{ color: COLORS.textDim }}>error.tsx</code>)
                could not handle it. The error has been logged to the operator
                telemetry pipeline.
              </div>
            </div>

            {/* Actions */}
            <div className="jarvis-actions">
              <button
                type="button"
                className="jarvis-btn"
                onClick={() => reset()}
              >
                Try Again
              </button>
              <button
                type="button"
                className="jarvis-btn jarvis-btn-secondary"
                onClick={() => window.location.reload()}
              >
                Reload
              </button>
              <a className="jarvis-btn jarvis-btn-ghost" href="/">
                Home
              </a>
            </div>
          </div>

          {/* Footer */}
          <div className="jarvis-footer">
            <span>JARVIS Mission Control · v9.0.0</span>
            <span>critical · root boundary</span>
          </div>
        </div>
      </body>
    </html>
  );
}
