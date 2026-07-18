'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';

// The dashboard is a fully client-side SPA. SSR is disabled to eliminate
// hydration mismatches from clocks, polling, Math.random and localStorage.
const MissionControlDashboard = dynamic(() => import('./page-client'), {
  ssr: false,
  loading: () => <LoadingScreen />,
});

function LoadingScreen() {
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setTimedOut(true), 15000);
    return () => clearTimeout(timer);
  }, []);

  if (timedOut) {
    return (
      <div
        suppressHydrationWarning
        style={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#07080A',
          color: '#FCA5A5',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          fontSize: 13,
          padding: '2rem',
          textAlign: 'center',
        }}
      >
        <div style={{ marginBottom: '1rem', color: '#7DD3FC', letterSpacing: '0.2em' }}>
          INITIALIZING JARVIS MISSION CONTROL…
        </div>
        <div style={{ marginBottom: '1.5rem', color: '#94A3B8', fontSize: 12, maxWidth: 480 }}>
          The dashboard is taking longer than expected to load. This usually means a
          runtime error occurred. Check the dev server logs.
        </div>
        <button
          onClick={() => window.location.reload()}
          style={{
            padding: '0.5rem 1.5rem',
            background: '#7DD3FC',
            color: '#05070A',
            border: 'none',
            borderRadius: 6,
            fontFamily: 'inherit',
            fontSize: 12,
            cursor: 'pointer',
            fontWeight: 700,
            letterSpacing: '0.1em',
          }}
        >
          RELOAD DASHBOARD
        </button>
      </div>
    );
  }

  return (
    <div
      suppressHydrationWarning
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#07080A',
        color: '#7DD3FC',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: 12,
        letterSpacing: '0.25em',
        flexDirection: 'column',
        gap: 18,
      }}
    >
      <div style={{ position: 'relative', width: 56, height: 56 }}>
        <div
          style={{
            position: 'absolute',
            inset: 0,
            border: '2px solid rgba(125,211,252,0.2)',
            borderTopColor: '#7DD3FC',
            borderRadius: '50%',
            animation: 'jarvis-spin-slow 1.1s linear infinite',
          }}
        />
      </div>
      <div style={{ display: 'flex', gap: 4 }}>
        <span className="jarvis-typing-dot" style={{ width: 6, height: 6, borderRadius: 999, background: '#7DD3FC', animationDelay: '0s' }} />
        <span className="jarvis-typing-dot" style={{ width: 6, height: 6, borderRadius: 999, background: '#7DD3FC', animationDelay: '0.2s' }} />
        <span className="jarvis-typing-dot" style={{ width: 6, height: 6, borderRadius: 999, background: '#7DD3FC', animationDelay: '0.4s' }} />
      </div>
      <div>INITIALIZING JARVIS MISSION CONTROL…</div>
    </div>
  );
}

export default function Page() {
  return <MissionControlDashboard />;
}
