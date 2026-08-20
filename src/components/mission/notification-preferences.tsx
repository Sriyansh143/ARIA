"use client";

import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import { useMissionStore } from "@/stores/mission-store";
import { SEVERITY_META, type AlertSeverity } from "@/lib/types";
import {
  Bell,
  Volume2,
  VolumeX,
  Vibrate,
  Shield,
  Zap,
  Eye,
  EyeOff,
  RotateCcw,
} from "lucide-react";

/**
 * NotificationPreferences — operator alert configuration panel.
 *
 * Lets operators configure:
 *  - Per-severity alert toggles (info/warn/error/critical)
 *  - Sound alerts with volume slider (for critical/error only)
 *  - Haptic/vibration toggle (mobile)
 *  - Desktop notification permission toggle
 *  - Auto-ack threshold (auto-acknowledge alerts below this severity)
 *  - Quiet hours (suppress non-critical alerts during a time window)
 *
 * Preferences persist to localStorage so they survive page reloads.
 * The panel reads the live alert count to show what's currently active.
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

const SEVERITY_ORDER: AlertSeverity[] = ["critical", "error", "warn", "info"];
const STORAGE_KEY = "aria-notification-prefs";

export function NotificationPreferences() {
  const alerts = useMissionStore((s) => s.alerts);

  // Lazy-load from localStorage (client-only, no SSR mismatch since the
  // initializer runs once on the client).
  const [prefs, setPrefs] = useState<Prefs>(() => {
    if (typeof window === "undefined") return DEFAULT_PREFS;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as Partial<Prefs>;
        return {
          ...DEFAULT_PREFS,
          ...saved,
          severityEnabled: { ...DEFAULT_PREFS.severityEnabled, ...saved.severityEnabled },
        };
      }
    } catch {
      /* ignore corrupt storage */
    }
    return DEFAULT_PREFS;
  });

  // Save to localStorage on change.
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    } catch {
      /* ignore quota errors */
    }
  }, [prefs]);

  const update = useCallback(<K extends keyof Prefs>(key: K, value: Prefs[K]) => {
    setPrefs((prev) => ({ ...prev, [key]: value }));
  }, []);

  const toggleSeverity = useCallback((sev: AlertSeverity) => {
    setPrefs((prev) => ({
      ...prev,
      severityEnabled: { ...prev.severityEnabled, [sev]: !prev.severityEnabled[sev] },
    }));
  }, []);

  const reset = useCallback(() => setPrefs(DEFAULT_PREFS), []);

  const activeBySeverity = SEVERITY_ORDER.map((sev) => ({
    sev,
    count: alerts.filter((a) => !a.ack && a.severity === sev).length,
  }));

  return (
    <section className="mc-surface flex flex-col">
      <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
        <div className="flex items-center gap-2">
          <Bell className="h-4 w-4 text-amber-300" />
          <h2 className="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-foreground">
            Notification Preferences
          </h2>
        </div>
        <button
          onClick={reset}
          className="flex items-center gap-1 rounded border border-border/60 px-1.5 py-0.5 font-mono text-[9px] uppercase text-muted-foreground transition-colors hover:text-foreground"
          title="Reset to defaults"
        >
          <RotateCcw className="h-2.5 w-2.5" /> reset
        </button>
      </div>

      <div className="space-y-3 p-4">
        {/* Severity toggles */}
        <div>
          <div className="mb-1.5 flex items-center gap-1.5">
            <Shield className="h-3 w-3 text-cyan-300" />
            <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
              Alert severity filters
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {activeBySeverity.map(({ sev, count }) => {
              const meta = SEVERITY_META[sev];
              const enabled = prefs.severityEnabled[sev];
              return (
                <button
                  key={sev}
                  onClick={() => toggleSeverity(sev)}
                  className={`rounded-lg border p-2 text-left transition-colors ${
                    enabled
                      ? "border-border/60 bg-card/60"
                      : "border-border/30 bg-background/20 opacity-50"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className={`flex items-center gap-1.5 font-mono text-[10px] uppercase ${meta.tone}`}>
                      <span className={`h-2 w-2 rounded-full ${meta.dot}`} />
                      {meta.label}
                    </span>
                    {enabled ? (
                      <Eye className="h-3 w-3 text-emerald-300" />
                    ) : (
                      <EyeOff className="h-3 w-3 text-muted-foreground" />
                    )}
                  </div>
                  <div className="mt-1 font-mono text-lg font-bold tabular-nums text-foreground">
                    {count}
                  </div>
                  <div className="font-mono text-[8px] text-muted-foreground">active</div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Sound + haptic */}
        <div>
          <div className="mb-1.5 flex items-center gap-1.5">
            <Volume2 className="h-3 w-3 text-violet-300" />
            <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
              Audio & haptic
            </span>
          </div>
          <div className="space-y-2">
            <ToggleRow
              icon={prefs.soundEnabled ? Volume2 : VolumeX}
              label="Sound alerts"
              description="Play a tone for error/critical alerts"
              enabled={prefs.soundEnabled}
              onToggle={() => update("soundEnabled", !prefs.soundEnabled)}
            >
              {prefs.soundEnabled && (
                <div className="mt-2 flex items-center gap-2">
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={prefs.volume}
                    onChange={(e) => update("volume", parseInt(e.target.value, 10))}
                    className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-border/30 accent-violet-400"
                  />
                  <span className="w-8 shrink-0 text-right font-mono text-[10px] tabular-nums text-muted-foreground">
                    {prefs.volume}%
                  </span>
                </div>
              )}
            </ToggleRow>
            <ToggleRow
              icon={Vibrate}
              label="Haptic feedback"
              description="Vibrate on mobile for critical alerts"
              enabled={prefs.hapticEnabled}
              onToggle={() => update("hapticEnabled", !prefs.hapticEnabled)}
            />
            <ToggleRow
              icon={Zap}
              label="Desktop notifications"
              description="Show OS-level notifications (requires permission)"
              enabled={prefs.desktopEnabled}
              onToggle={async () => {
                if (!prefs.desktopEnabled) {
                  const perm = await Notification.requestPermission();
                  if (perm === "granted") update("desktopEnabled", true);
                } else {
                  update("desktopEnabled", false);
                }
              }}
            />
          </div>
        </div>

        {/* Auto-ack threshold */}
        <div>
          <div className="mb-1.5 flex items-center gap-1.5">
            <EyeOff className="h-3 w-3 text-amber-300" />
            <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
              Auto-acknowledge threshold
            </span>
          </div>
          <div className="flex flex-wrap gap-1">
            <Chip
              active={prefs.autoAckThreshold === "none"}
              onClick={() => update("autoAckThreshold", "none")}
            >
              off
            </Chip>
            {SEVERITY_ORDER.slice().reverse().map((sev) => (
              <Chip
                key={sev}
                active={prefs.autoAckThreshold === sev}
                onClick={() => update("autoAckThreshold", sev)}
                tone={SEVERITY_META[sev].tone}
              >
                auto-ack {SEVERITY_META[sev].label}+
              </Chip>
            ))}
          </div>
          <p className="mt-1 font-mono text-[9px] text-muted-foreground/70">
            Automatically acknowledges alerts at or below this severity after 30s.
          </p>
        </div>

        {/* Quiet hours */}
        <div>
          <div className="mb-1.5 flex items-center gap-1.5">
            <VolumeX className="h-3 w-3 text-slate-300" />
            <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
              Quiet hours
            </span>
          </div>
          <ToggleRow
            icon={VolumeX}
            label="Suppress non-critical alerts"
            description="Mute info/warn alerts during specified hours"
            enabled={prefs.quietHoursEnabled}
            onToggle={() => update("quietHoursEnabled", !prefs.quietHoursEnabled)}
          >
            {prefs.quietHoursEnabled && (
              <div className="mt-2 flex items-center gap-2 font-mono text-[10px]">
                <span className="text-muted-foreground">from</span>
                <input
                  type="time"
                  value={prefs.quietStart}
                  onChange={(e) => update("quietStart", e.target.value)}
                  className="rounded border border-border/60 bg-background/60 px-1.5 py-0.5 text-foreground focus:border-primary/50 focus:outline-none"
                />
                <span className="text-muted-foreground">to</span>
                <input
                  type="time"
                  value={prefs.quietEnd}
                  onChange={(e) => update("quietEnd", e.target.value)}
                  className="rounded border border-border/60 bg-background/60 px-1.5 py-0.5 text-foreground focus:border-primary/50 focus:outline-none"
                />
              </div>
            )}
          </ToggleRow>
        </div>
      </div>

      {/* Status footer */}
      <div className="border-t border-border/60 px-4 py-2 font-mono text-[9px] text-muted-foreground">
        <span className="text-emerald-300">●</span> preferences saved locally ·{" "}
        {prefs.soundEnabled ? "sound on" : "sound off"} ·{" "}
        {prefs.desktopEnabled ? "desktop on" : "desktop off"} ·{" "}
        {prefs.quietHoursEnabled ? `quiet ${prefs.quietStart}-${prefs.quietEnd}` : "no quiet hours"}
      </div>
    </section>
  );
}

function ToggleRow({
  icon: Icon,
  label,
  description,
  enabled,
  onToggle,
  children,
}: {
  icon: typeof Bell;
  label: string;
  description: string;
  enabled: boolean;
  onToggle: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border/40 bg-background/40 p-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Icon className={`h-3.5 w-3.5 ${enabled ? "text-violet-300" : "text-muted-foreground"}`} />
          <div>
            <div className="font-mono text-[11px] font-medium text-foreground">{label}</div>
            <div className="font-mono text-[9px] text-muted-foreground">{description}</div>
          </div>
        </div>
        <button
          onClick={onToggle}
          className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
            enabled ? "bg-violet-500/60" : "bg-border/40"
          }`}
          role="switch"
          aria-checked={enabled}
          aria-label={label}
        >
          <motion.span
            layout
            className="absolute top-0.5 h-4 w-4 rounded-full bg-foreground shadow-sm"
            animate={{ left: enabled ? "18px" : "2px" }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
          />
        </button>
      </div>
      {children}
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
  tone,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  tone?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider transition-colors ${
        active
          ? tone ?? "border-primary/50 bg-primary/10 text-primary"
          : "border-border/60 text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}
