'use client';

// =====================================================================
// not-found.tsx — JARVIS-styled 404 page.
// =====================================================================
// Rendered by Next.js App Router when no route matches, or when a
// route calls `notFound()`. Uses JARVIS design tokens (amber accent
// for "warning" tone, distinct from red error tone) and offers a
// link back to the root Mission Control view.
// =====================================================================

import Link from 'next/link';
import { JARVIS } from '@/lib/config';

export default function NotFound() {
  const accent = JARVIS.colors.amber;

  return (
    <div
      role="alert"
      className="min-h-screen flex items-center justify-center p-6"
      style={{ background: JARVIS.colors.bg, color: JARVIS.colors.text }}
    >
      <div
        className="w-full max-w-lg rounded-xl overflow-hidden text-center"
        style={{
          background: JARVIS.colors.panel,
          border: `1px solid ${accent}55`,
          boxShadow: `0 0 40px ${accent}22, 0 0 0 1px ${accent}11 inset`,
        }}
      >
        {/* Header */}
        <div
          className="flex flex-col items-center gap-3 px-5 py-8"
          style={{ borderBottom: `1px solid ${JARVIS.colors.border}`, background: `${accent}10` }}
        >
          <div
            className="flex h-14 w-14 items-center justify-center rounded-2xl"
            style={{ background: `${accent}1a`, border: `1px solid ${accent}44`, color: accent }}
          >
            <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </div>
          <div>
            <div className="jarvis-mono text-[10px] uppercase tracking-widest" style={{ color: accent }}>
              JARVIS · Signal Lost
            </div>
            <div
              className="text-5xl font-bold mt-2"
              style={{ color: accent, textShadow: `0 0 20px ${accent}44` }}
            >
              404
            </div>
            <div className="text-sm mt-2" style={{ color: JARVIS.colors.textDim }}>
              Page not found
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="px-5 py-6 space-y-4">
          <p className="text-xs" style={{ color: JARVIS.colors.textDim }}>
            The requested route does not exist in the JARVIS Mission Control registry.
            Return to the command deck to continue operations.
          </p>

          <div className="flex flex-wrap gap-2 justify-center pt-1">
            <Link
              href="/"
              className="jarvis-mono text-[11px] uppercase tracking-wider px-4 py-2 rounded-md transition-all hover:scale-[1.03] inline-flex items-center"
              style={{
                background: accent,
                color: JARVIS.colors.bg,
                border: `1px solid ${accent}`,
                fontWeight: 600,
              }}
            >
              Return to Mission Control
            </Link>
            <button
              type="button"
              onClick={() => window.history.back()}
              className="jarvis-mono text-[11px] uppercase tracking-wider px-4 py-2 rounded-md transition-all hover:scale-[1.03]"
              style={{
                background: `${accent}10`,
                color: accent,
                border: `1px solid ${accent}44`,
              }}
            >
              Go Back
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
