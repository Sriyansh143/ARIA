"use client";

import { useEffect, useRef } from "react";
import { useMissionStore } from "@/stores/mission-store";
import type { AlertSeverity, SystemAlert } from "@/lib/types";

/**
 * useAlertNotifications — wires notification preferences to real alerts.
 *
 * Watches the store's `alerts` collection for new unacknowledged alerts
 * and triggers sound / haptic / desktop notifications based on the
 * operator's saved preferences (from the NotificationPreferences panel,
 * persisted in localStorage under `aria-notification-prefs`).
 *
 * Respects:
 *  - Per-severity enable/disable
 *  - Sound + volume (Web Audio API oscillator beep)
 *  - Haptic (navigator.vibrate)
 *  - Desktop notifications (Notification API)
 *  - Quiet hours (suppresses non-critical alerts during the window)
 *  - Auto-ack threshold (auto-acknowledges alerts below a severity)
 *
 * This hook is idempotent and safe to mount multiple times — it tracks
 * the last-seen alert ID to avoid re-firing.
 */

interface Prefs {
  severityEnabled: Record<AlertSeverity, boolean>;
  soundEnabled: boolean;
  volume: number;
  hapticEnabled: boolean;
  desktopEnabled: boolean;
  autoAckThreshold: AlertSeverity | "none";
  quietHoursEnabled: boolean;
  quietStart: string;
  quietEnd: string;
}

const DEFAULT_PREFS: Prefs = {
  severityEnabled: { info: true, warn: true, error: true, critical: true },
  soundEnabled: false,
  volume: 60,
  hapticEnabled: false,
  desktopEnabled: false,
  autoAckThreshold: "none",
  quietHoursEnabled: false,
  quietStart: "22:00",
  quietEnd: "07:00",
};

const SEVERITY_RANK: Record<AlertSeverity, number> = {
  info: 0,
  warn: 1,
  error: 2,
  critical: 3,
};

function loadPrefs(): Prefs {
  if (typeof window === "undefined") return DEFAULT_PREFS;
  try {
    const raw = localStorage.getItem("aria-notification-prefs");
    if (raw) {
      const saved = JSON.parse(raw) as Partial<Prefs>;
      return {
        ...DEFAULT_PREFS,
        ...saved,
        severityEnabled: { ...DEFAULT_PREFS.severityEnabled, ...saved.severityEnabled },
      };
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_PREFS;
}

function isInQuietHours(start: string, end: string): boolean {
  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  const startMin = sh * 60 + sm;
  const endMin = eh * 60 + em;
  if (startMin < endMin) {
    return currentMinutes >= startMin && currentMinutes < endMin;
  }
  // Overnight window (e.g., 22:00 → 07:00).
  return currentMinutes >= startMin || currentMinutes < endMin;
}

function playBeep(volume: number, severity: AlertSeverity) {
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    // Higher severity = higher pitch.
    const freq = severity === "critical" ? 880 : severity === "error" ? 660 : severity === "warn" ? 550 : 440;
    osc.frequency.value = freq;
    osc.type = "sine";
    const vol = (volume / 100) * 0.3;
    gain.gain.setValueAtTime(vol, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.5);
    // Clean up.
    osc.onended = () => ctx.close();
  } catch {
    /* AudioContext may not be available */
  }
}

function fireDesktopNotification(alert: SystemAlert) {
  try {
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    const notif = new Notification(`ARIA · ${alert.severity.toUpperCase()}`, {
      body: alert.message,
      tag: alert.id,
      icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg",
    });
    notif.onclick = () => {
      window.focus();
      notif.close();
    };
  } catch {
    /* Notification API may not be available */
  }
}

function fireHaptic(severity: AlertSeverity) {
  try {
    if (typeof navigator === "undefined" || !navigator.vibrate) return;
    const pattern = severity === "critical" ? [200, 100, 200, 100, 200] : severity === "error" ? [200, 100, 200] : [200];
    navigator.vibrate(pattern);
  } catch {
    /* vibrate may not be available */
  }
}

export function useAlertNotifications(): void {
  const alerts = useMissionStore((s) => s.alerts);
  const seenIdsRef = useRef<Set<string>>(new Set());
  const ackTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Initialize seen set with current alerts so we don't fire for historical ones.
  useEffect(() => {
    for (const a of alerts) {
      seenIdsRef.current.add(a.id);
    }
  }, []);

  // Watch for NEW alerts.
  useEffect(() => {
    const prefs = loadPrefs();
    const quiet = prefs.quietHoursEnabled && isInQuietHours(prefs.quietStart, prefs.quietEnd);

    for (const alert of alerts) {
      if (alert.ack || seenIdsRef.current.has(alert.id)) continue;
      seenIdsRef.current.add(alert.id);

      const sev = alert.severity as AlertSeverity;
      if (!prefs.severityEnabled[sev]) continue;

      // During quiet hours, suppress everything except critical.
      if (quiet && sev !== "critical") continue;

      // Fire notifications.
      if (prefs.soundEnabled) {
        playBeep(prefs.volume, sev);
      }
      if (prefs.hapticEnabled) {
        fireHaptic(sev);
      }
      if (prefs.desktopEnabled) {
        fireDesktopNotification(alert);
      }

      // Auto-ack if below threshold.
      if (prefs.autoAckThreshold !== "none") {
        const thresholdRank = SEVERITY_RANK[prefs.autoAckThreshold];
        const alertRank = SEVERITY_RANK[sev];
        if (alertRank < thresholdRank) {
          // Auto-ack after 30s.
          const timer = setTimeout(() => {
            fetch(`/api/alerts/${alert.id}/ack`, { method: "PATCH" }).catch(() => {});
            ackTimersRef.current.delete(alert.id);
          }, 30_000);
          ackTimersRef.current.set(alert.id, timer);
        }
      }
    }
  }, [alerts]);

  // Clean up timers on unmount.
  useEffect(() => {
    const timers = ackTimersRef.current;
    return () => {
      for (const timer of timers.values()) {
        clearTimeout(timer);
      }
      timers.clear();
    };
  }, []);
}
