'use client';

// =====================================================================
// ActionTrackerProvider — wraps the app to auto-track user actions.
// =====================================================================
// Responsibilities:
//   1. Install `window.__track*` global helpers (once).
//   2. Subscribe to the nav store → track navigations on tab change.
//   3. Listen to `window.error` + `unhandledrejection` → track errors.
//   4. Mark page-visible + track a heartbeat "navigate" on first mount
//      so the very first session shows up in the activity stream.
//
// All tracking is fire-and-forget via src/lib/action-tracker.ts.
// This component renders nothing — it's purely a side-effect installer.
// =====================================================================

import { useEffect } from 'react';
import {
  installGlobalTrackers,
  useAutoTrackNavigations,
  trackError,
} from '@/lib/action-tracker';

export default function ActionTrackerProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  // Install global trackers (idempotent — safe to call multiple times).
  useEffect(() => {
    installGlobalTrackers();
  }, []);

  // Auto-track navigations via the nav store.
  useAutoTrackNavigations();

  // Auto-track uncaught errors + unhandled promise rejections.
  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      trackError(event.error ?? event.message, {
        fatal: false,
        source: `window.onerror:${event.filename ?? 'unknown'}:${event.lineno ?? 0}`,
      });
    };
    const onUnhandled = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      const err =
        reason instanceof Error
          ? reason
          : typeof reason === 'string'
            ? new Error(reason)
            : new Error(`Unhandled rejection: ${JSON.stringify(reason)}`);
      trackError(err, { fatal: false, source: 'unhandledrejection' });
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onUnhandled);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onUnhandled);
    };
  }, []);

  return <>{children}</>;
}
