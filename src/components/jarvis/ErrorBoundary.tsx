'use client';

// =====================================================================
// ErrorBoundary — top-level React error boundary for JARVIS Mission Control.
// =====================================================================
// Responsibilities:
//   1. Catch JavaScript errors anywhere in the child component tree
//      (render + lifecycle). Errors thrown in event handlers or async
//      callbacks are NOT caught by boundaries — those are handled by
//      ActionTrackerProvider's `window.onerror` + `unhandledrejection`
//      listeners.
//   2. Log the error to the console for dev diagnostics.
//   3. Track the error via the action tracker so monitor agents see it
//      in the activity stream. Fire-and-forget POST to /api/user-actions
//      with type='error'.
//   4. Render a styled fallback UI with:
//        - error message + component stack
//        - "Reload" button (window.location.reload)
//        - "Copy Error" button (writes full stack to clipboard)
//
// Styled with JARVIS design tokens — dark panel, red accent for errors.
// Wraps {children} OUTSIDE the ActionTrackerProvider in layout.tsx so it
// can catch errors thrown by the provider itself.
// =====================================================================

import React from 'react';
import { JARVIS } from '@/lib/config';
import { trackAction } from '@/lib/action-tracker';

interface ErrorBoundaryProps {
  children: React.ReactNode;
  /** Optional fallback render prop — overrides the default JARVIS fallback. */
  fallback?: (error: Error, reset: () => void) => React.ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
  componentStack: string | null;
}

export default class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { error: null, componentStack: null };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    const componentStack = info.componentStack ?? null;
    this.setState({ componentStack });

    // 1. Console log for dev diagnostics.
    console.error('[ErrorBoundary] Uncaught error:', error, info.componentStack);

    // 2. Track via action tracker (fire-and-forget POST to /api/user-actions).
    // The trackAction helper is safe to call from any client code — it
    // never throws and uses sendBeacon / keepalive fetch.
    try {
      trackAction('error', {
        target: 'react-error-boundary',
        label: error.message.slice(0, 200),
        severity: 'critical',
        meta: {
          message: error.message,
          stack: error.stack?.slice(0, 2000),
          componentStack: componentStack?.slice(0, 2000),
          source: 'react-error-boundary',
        },
      });
    } catch {
      // swallow — telemetry must never break recovery
    }
  }

  reset = (): void => {
    this.setState({ error: null, componentStack: null });
  };

  copyError = async (): Promise<void> => {
    if (!this.state.error) return;
    const text = [
      `JARVIS Error Boundary — ${new Date().toISOString()}`,
      `Message: ${this.state.error.message}`,
      '',
      'Stack:',
      this.state.error.stack ?? '(no stack)',
      '',
      'Component Stack:',
      this.state.componentStack ?? '(no component stack)',
    ].join('\n');
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        // Fallback for older browsers.
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
    } catch {
      // swallow — clipboard may be unavailable
    }
  };

  render(): React.ReactNode {
    const { error, componentStack } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(error, this.reset);

    const accent = JARVIS.colors.red;
    return (
      <div
        role="alert"
        aria-live="assertive"
        className="min-h-screen flex items-center justify-center p-6"
        style={{
          background: JARVIS.colors.bg,
          color: JARVIS.colors.text,
        }}
      >
        <div
          className="w-full max-w-2xl rounded-xl overflow-hidden"
          style={{
            background: JARVIS.colors.panel,
            border: `1px solid ${accent}55`,
            boxShadow: `0 0 40px ${accent}22, 0 0 0 1px ${accent}11 inset`,
          }}
        >
          {/* Header */}
          <div
            className="flex items-center gap-3 px-5 py-3"
            style={{
              borderBottom: `1px solid ${JARVIS.colors.border}`,
              background: `${accent}10`,
            }}
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
            <div className="min-w-0">
              <div
                className="jarvis-mono text-[10px] uppercase tracking-widest"
                style={{ color: accent }}
              >
                JARVIS · Critical Error
              </div>
              <div className="text-xs" style={{ color: JARVIS.colors.textDim }}>
                An uncaught error rendered this view inoperable.
              </div>
            </div>
          </div>

          {/* Body */}
          <div className="px-5 py-4 space-y-4">
            <div>
              <div
                className="jarvis-mono text-[10px] uppercase mb-1"
                style={{ color: JARVIS.colors.textMute }}
              >
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
                {error.message || 'Unknown error'}
              </div>
            </div>

            {componentStack && (
              <div>
                <div
                  className="jarvis-mono text-[10px] uppercase mb-1"
                  style={{ color: JARVIS.colors.textMute }}
                >
                  Component Stack
                </div>
                <pre
                  className="max-h-48 overflow-auto rounded-md p-3 text-[11px] leading-relaxed"
                  style={{
                    background: JARVIS.colors.bgSoft,
                    border: `1px solid ${JARVIS.colors.border}`,
                    color: JARVIS.colors.textDim,
                  }}
                >
                  {componentStack.trim()}
                </pre>
              </div>
            )}

            {/* Actions */}
            <div className="flex flex-wrap gap-2 pt-1">
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="jarvis-mono text-[11px] uppercase tracking-wider px-4 py-2 rounded-md transition-all hover:scale-[1.03]"
                style={{
                  background: accent,
                  color: JARVIS.colors.bg,
                  border: `1px solid ${accent}`,
                  fontWeight: 600,
                }}
              >
                Reload
              </button>
              <button
                type="button"
                onClick={() => void this.copyError()}
                className="jarvis-mono text-[11px] uppercase tracking-wider px-4 py-2 rounded-md transition-all hover:scale-[1.03]"
                style={{
                  background: `${accent}10`,
                  color: accent,
                  border: `1px solid ${accent}44`,
                }}
              >
                Copy Error
              </button>
              <button
                type="button"
                onClick={this.reset}
                className="jarvis-mono text-[11px] uppercase tracking-wider px-4 py-2 rounded-md transition-all hover:scale-[1.03]"
                style={{
                  background: 'transparent',
                  color: JARVIS.colors.textDim,
                  border: `1px solid ${JARVIS.colors.border}`,
                }}
              >
                Try Again
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }
}
