"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Settings,
  ToggleLeft,
  ToggleRight,
  Cpu,
  Shield,
  Palette,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Server,
  Database,
  Clock,
} from "lucide-react";
import { FullScreenPanel } from "./full-screen-panel";

/**
 * SettingsPanel — LLM provider config, feature toggles, appearance, system info.
 *
 * Fetches from /api/llm-router/status (provider states) + /api/settings
 * (boolean flags + telephony + ollama). No secrets are exposed — only
 * enabled/disabled booleans.
 */
export function SettingsPanel() {
  const [routerStatus, setRouterStatus] = useState<RouterStatus | null>(null);
  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [theme, setTheme] = useState<"dark" | "light" | "system">("dark");

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [routerRes, settingsRes] = await Promise.all([
        fetch("/api/llm-router/status").then((r) => r.json()),
        fetch("/api/settings").then((r) => r.json()),
      ]);
      setRouterStatus(routerStatus);
      setSettings(settings);
    } catch {
      setRouterStatus(null);
      setSettings(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
    const id = window.setInterval(fetchAll, 30000);
    return () => window.clearInterval(id);
  }, [fetchAll]);

  const providers = Array.isArray(routerStatus?.providers) ? routerStatus.providers : [];
  const freeswitch = (routerStatus?.freeswitch ?? { connected: false }) as {
    connected: boolean;
    authenticated?: boolean;
    activeCalls?: number;
  };
  const ollama = settings?.ollama ?? { reachable: false };
  const flags = settings?.flags ?? {};
  const telephony = (settings?.telephony ?? {}) as {
    aiCallerEnabled?: boolean;
    activeCalls?: number;
    consentVerified?: boolean;
    freeswitchConnected?: boolean;
    freeswitchAuthenticated?: boolean;
  };

  return (
    <FullScreenPanel title="Settings & Configuration" icon={<Settings className="h-3.5 w-3.5 text-violet-400" />}>
      <div className="space-y-4 p-4">
        {/* LLM Providers */}
        <section className="mc-surface rounded-lg border border-border/60 p-4">
          <div className="mb-3 flex items-center gap-2">
            <Cpu className="h-4 w-4 text-violet-400" />
            <h3 className="font-mono text-xs font-semibold uppercase tracking-wider text-foreground">
              LLM Provider Status
            </h3>
            <button
              onClick={() => void fetchAll()}
              className="ml-auto flex items-center gap-1 rounded border border-border/60 px-2 py-0.5 font-mono text-[9px] uppercase text-muted-foreground hover:text-foreground"
            >
              <RefreshCw className="h-3 w-3" /> Refresh
            </button>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {providers.map((p) => (
              <div
                key={p.name}
                className={`flex items-center justify-between rounded border px-3 py-2 ${
                  p.available
                    ? "border-emerald-500/20 bg-emerald-500/5"
                    : "border-border/40 bg-surface-2"
                }`}
              >
                <div className="flex items-center gap-2">
                  {p.available ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                  ) : (
                    <XCircle className="h-4 w-4 text-muted-foreground" />
                  )}
                  <div>
                    <div className="font-mono text-xs font-semibold uppercase text-foreground">
                      {p.name}
                    </div>
                    {p.onCooldown && (
                      <div className="font-mono text-[9px] text-amber-400">
                        cooldown: {p.cooldownReason}
                      </div>
                    )}
                  </div>
                </div>
                <span
                  className={`font-mono text-[9px] uppercase ${
                    p.available ? "text-emerald-400" : "text-muted-foreground"
                  }`}
                >
                  {p.available ? "active" : "no key"}
                </span>
              </div>
            ))}
            {/* Ollama */}
            <div
              className={`flex items-center justify-between rounded border px-3 py-2 ${
                ollama.reachable
                  ? "border-emerald-500/20 bg-emerald-500/5"
                  : "border-border/40 bg-surface-2"
              }`}
            >
              <div className="flex items-center gap-2">
                {ollama.reachable ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                ) : (
                  <XCircle className="h-4 w-4 text-muted-foreground" />
                )}
                <div className="font-mono text-xs font-semibold uppercase text-foreground">
                  Ollama
                </div>
              </div>
              <span
                className={`font-mono text-[9px] uppercase ${
                  ollama.reachable ? "text-emerald-400" : "text-muted-foreground"
                }`}
              >
                {ollama.reachable ? `${ollama.lastLatencyMs}ms` : "offline"}
              </span>
            </div>
          </div>
          <div className="mt-2 font-mono text-[9px] text-muted-foreground">
            Failover: Z-AI → Groq → NVIDIA → Ollama · complexity-aware routing ·
            cooldowns: 5min auth / 60s rate-limit
          </div>
        </section>

        {/* Feature Toggles */}
        <section className="mc-surface rounded-lg border border-border/60 p-4">
          <div className="mb-3 flex items-center gap-2">
            <Shield className="h-4 w-4 text-amber-400" />
            <h3 className="font-mono text-xs font-semibold uppercase tracking-wider text-foreground">
              Security Kill-Switches
            </h3>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <ToggleRow label="AI Caller" enabled={flags.AI_CALLER_ENABLED} />
            <ToggleRow label="Code Exec" enabled={flags.ALLOW_CODE_EXEC} />
            <ToggleRow label="Terminal Exec" enabled={flags.ALLOW_TERMINAL_EXEC} />
            <ToggleRow label="Auto-Approve" enabled={flags.UI_HEALER_AUTO_APPROVE} />
            <ToggleRow label="Consent Verified" enabled={flags.AI_CALLER_CONSENT_VERIFIED} />
            <ToggleRow label="Multi-Tenant" enabled={flags.JARVIS_MULTI_TENANT} />
          </div>
          <div className="mt-2 font-mono text-[9px] text-muted-foreground">
            All default to <span className="text-amber-400">false</span> for production safety.
            Edit <code className="rounded bg-surface-2 px-1">.env</code> to change — hot-reloads in 5s.
          </div>
        </section>

        {/* Telephony + FreeSWITCH */}
        <section className="mc-surface rounded-lg border border-border/60 p-4">
          <div className="mb-3 flex items-center gap-2">
            <Server className="h-4 w-4 text-cyan-400" />
            <h3 className="font-mono text-xs font-semibold uppercase tracking-wider text-foreground">
              Telephony & Voice
            </h3>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
            <InfoTile
              label="FreeSWITCH"
              value={freeswitch.connected ? "connected" : "offline"}
              tone={freeswitch.connected ? "emerald" : "muted"}
            />
            <InfoTile
              label="Authenticated"
              value={freeswitch.authenticated ? "yes" : "no"}
              tone={freeswitch.authenticated ? "emerald" : "muted"}
            />
            <InfoTile
              label="AI Caller Gate"
              value={telephony.aiCallerEnabled ? "enabled" : "disabled"}
              tone={telephony.aiCallerEnabled ? "amber" : "muted"}
            />
            <InfoTile
              label="Active Calls"
              value={String(telephony.activeCalls ?? freeswitch.activeCalls ?? 0)}
              tone="cyan"
            />
          </div>
        </section>

        {/* Appearance */}
        <section className="mc-surface rounded-lg border border-border/60 p-4">
          <div className="mb-3 flex items-center gap-2">
            <Palette className="h-4 w-4 text-fuchsia-400" />
            <h3 className="font-mono text-xs font-semibold uppercase tracking-wider text-foreground">
              Appearance
            </h3>
          </div>
          <div className="flex items-center gap-3">
            <span className="font-mono text-[10px] uppercase text-muted-foreground">Theme:</span>
            <div className="flex gap-1">
              <button
                onClick={() => setTheme("dark")}
                className={`rounded border px-3 py-1 font-mono text-[10px] uppercase ${
                  theme === "dark"
                    ? "border-violet-500/40 bg-violet-500/10 text-violet-300"
                    : "border-border/40 text-muted-foreground hover:text-foreground"
                }`}
              >
                Dark
              </button>
              <button
                onClick={() => setTheme("light")}
                className={`rounded border px-3 py-1 font-mono text-[10px] uppercase ${
                  theme === "light"
                    ? "border-violet-500/40 bg-violet-500/10 text-violet-300"
                    : "border-border/40 text-muted-foreground hover:text-foreground"
                }`}
              >
                Light
              </button>
              <button
                onClick={() => setTheme("system")}
                className={`rounded border px-3 py-1 font-mono text-[10px] uppercase ${
                  theme === "system"
                    ? "border-violet-500/40 bg-violet-500/10 text-violet-300"
                    : "border-border/40 text-muted-foreground hover:text-foreground"
                }`}
              >
                System
              </button>
            </div>
          </div>
        </section>

        {/* System Info */}
        <section className="mc-surface rounded-lg border border-border/60 p-4">
          <div className="mb-3 flex items-center gap-2">
            <Database className="h-4 w-4 text-emerald-400" />
            <h3 className="font-mono text-xs font-semibold uppercase tracking-wider text-foreground">
              System Info
            </h3>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <InfoTile label="Version" value={settings?.app?.version ?? "v28.0-hermes-autonomous"} tone="violet" />
            <InfoTile label="Database" value={settings?.database?.provider ?? "sqlite"} tone={settings?.database?.provider === "postgresql" ? "cyan" : "emerald"} />
            <InfoTile label="Auth Mode" value={settings?.app?.authMode ?? "multi-tenant"} tone="cyan" />
            <InfoTile label="Node Env" value={settings?.app?.nodeEnv ?? "development"} tone="amber" />
          </div>
        </section>

        {loading && (
          <div className="flex items-center justify-center gap-2 py-4 font-mono text-[10px] text-muted-foreground">
            <Clock className="h-3 w-3 animate-pulse" /> Loading configuration…
          </div>
        )}
      </div>
    </FullScreenPanel>
  );
}

function ToggleRow({ label, enabled }: { label: string; enabled: boolean }) {
  return (
    <div className="flex items-center justify-between rounded border border-border/40 bg-surface-2 px-3 py-2">
      <span className="font-mono text-xs text-foreground">{label}</span>
      <div className="flex items-center gap-2">
        {enabled ? (
          <ToggleRight className="h-5 w-5 text-emerald-400" />
        ) : (
          <ToggleLeft className="h-5 w-5 text-muted-foreground" />
        )}
        <span
          className={`font-mono text-[9px] uppercase ${
            enabled ? "text-emerald-400" : "text-muted-foreground"
          }`}
        >
          {enabled ? "on" : "off"}
        </span>
      </div>
    </div>
  );
}

function InfoTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "emerald" | "amber" | "cyan" | "violet" | "muted";
}) {
  const toneClass = {
    emerald: "text-emerald-400",
    amber: "text-amber-400",
    cyan: "text-cyan-400",
    violet: "text-violet-400",
    muted: "text-muted-foreground",
  }[tone];
  return (
    <div className="rounded border border-border/40 bg-surface-2 px-3 py-2">
      <div className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className={`font-mono text-xs font-semibold ${toneClass}`}>{value}</div>
    </div>
  );
}

interface RouterStatus {
  providers: Array<{
    name: string;
    available: boolean;
    onCooldown: boolean;
    cooldownReason?: string;
  }>;
  freeswitch: {
    connected: boolean;
    authenticated: boolean;
    activeCalls?: number;
  };
}

interface SettingsData {
  flags: Record<string, boolean>;
  telephony: {
    aiCallerEnabled: boolean;
    activeCalls?: number;
  };
  ollama: {
    reachable: boolean;
    lastLatencyMs: number;
  };
  database?: {
    provider: "sqlite" | "postgresql";
    url: string;
  };
  app: {
    version: string;
    authMode: string;
    nodeEnv: string;
  };
}

export default SettingsPanel;
