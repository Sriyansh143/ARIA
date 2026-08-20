"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import {
  Plug,
  RefreshCw,
  Loader2,
  Download,
  Star,
  CheckCircle2,
  Key,
  ShieldCheck,
  Link2,
  Bot,
  Inbox,
  type LucideIcon,
} from "lucide-react";
import { FullScreenPanel } from "./full-screen-panel";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

/**
 * ConnectorMarketplacePanel — third-party connector catalog.
 *
 * Sections:
 *   1. Category filter tabs — All / CRM / Comms / Payments / Documents.
 *   2. "Installed only" toggle.
 *   3. Grid of connector cards fetched from /api/connectors — each
 *      shows name, category badge, description, rating (stars),
 *      install count, auth type, "Install" button (or "Installed"
 *      badge if already installed). "coming_soon" connectors render
 *      a disabled "Coming Soon" badge.
 *   4. Install POST → /api/connectors { id } → toast + refresh.
 *
 * Empty states per category ("No {category} connectors installed yet").
 * All API calls wrapped in try/catch with sonner toast feedback.
 *
 * Task ID: FEATURES-MULTICOMPANY-WORKFLOWS-CONNECTORS (Task 4).
 */

// ─── Types ───────────────────────────────────────────────────────────
type Category = "all" | "CRM" | "Comms" | "Payments" | "Documents";

interface Connector {
  id: string;
  name: string;
  category: string;
  description: string;
  authType: string;
  setupSteps: string[];
  status: "available" | "installed" | "coming_soon";
  rating: number;
  installs: number;
  author: string;
  accent: string;
  icon: string;
}

interface InstallResponse {
  ok: boolean;
  connector?: Connector;
  error?: string;
}

// ─── Category metadata ──────────────────────────────────────────────
const CATEGORY_TABS: { value: Category; label: string }[] = [
  { value: "all", label: "All" },
  { value: "CRM", label: "CRM" },
  { value: "Comms", label: "Comms" },
  { value: "Payments", label: "Payments" },
  { value: "Documents", label: "Documents" },
];

const CATEGORY_TONE: Record<string, string> = {
  CRM: "text-cyan-300 border-cyan-500/30 bg-cyan-500/10",
  Comms: "text-violet-300 border-violet-500/30 bg-violet-500/10",
  Payments: "text-emerald-300 border-emerald-500/30 bg-emerald-500/10",
  Documents: "text-amber-300 border-amber-500/30 bg-amber-500/10",
};

// ─── Auth type → icon ───────────────────────────────────────────────
const AUTH_META: Record<string, { icon: LucideIcon; label: string }> = {
  api_key: { icon: Key, label: "API Key" },
  oauth2: { icon: ShieldCheck, label: "OAuth 2.0" },
  webhook: { icon: Link2, label: "Webhook" },
  bot_token: { icon: Bot, label: "Bot Token" },
  publishable_key: { icon: Key, label: "Publishable Key" },
};

function authMeta(authType: string) {
  return (
    AUTH_META[authType] ?? {
      icon: Key,
      label: authType,
    }
  );
}

// ─── Star rating renderer ───────────────────────────────────────────
function Stars({ rating }: { rating: number }) {
  const full = Math.floor(rating);
  const half = rating - full >= 0.5;
  return (
    <div className="flex items-center gap-0.5" aria-label={`${rating.toFixed(1)} out of 5 stars`}>
      {Array.from({ length: 5 }).map((_, i) => {
        const isFull = i < full;
        const isHalf = !isFull && i === full && half;
        return (
          <Star
            key={i}
            className={`h-3 w-3 ${
              isFull
                ? "fill-amber-400 text-amber-400"
                : isHalf
                  ? "fill-amber-400/50 text-amber-400/50"
                  : "fill-transparent text-muted-foreground/30"
            }`}
          />
        );
      })}
      <span className="ml-1 font-mono text-[9px] text-muted-foreground/70">
        {rating.toFixed(1)}
      </span>
    </div>
  );
}

// ─── Component ───────────────────────────────────────────────────────
export function ConnectorMarketplacePanel() {
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<Category>("all");
  const [installedOnly, setInstalledOnly] = useState(false);
  const [installingId, setInstallingId] = useState<string | null>(null);

  const fetchConnectors = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (installedOnly) params.set("installed", "true");
      if (activeCategory !== "all") params.set("category", activeCategory);
      const url = `/api/connectors${params.toString() ? `?${params.toString()}` : ""}`;
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json().catch(() => ({}))) as {
        connectors?: Connector[];
      };
      setConnectors(Array.isArray(data.connectors) ? data.connectors : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load connectors");
    } finally {
      setLoading(false);
    }
  }, [activeCategory, installedOnly]);

  useEffect(() => {
    void fetchConnectors();
  }, [fetchConnectors]);

  const installConnector = useCallback(
    async (connector: Connector) => {
      setInstallingId(connector.id);
      const tid = toast.loading(`Installing ${connector.name}…`, {
        description: `${connector.setupSteps.length} setup steps required`,
      });
      try {
        const res = await fetch("/api/connectors", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: connector.id }),
        });
        const data = (await res.json().catch(() => ({}))) as InstallResponse;
        if (!res.ok || !data.ok) {
          const msg = data.error ?? `HTTP ${res.status}`;
          throw new Error(msg);
        }
        toast.success(`${connector.name} installed`, {
          id: tid,
          description: `${connector.category} · ${authMeta(connector.authType).label}`,
        });
        void fetchConnectors();
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        toast.error(`Install failed for ${connector.name}`, { id: tid, description: msg });
      } finally {
        setInstallingId(null);
      }
    },
    [fetchConnectors],
  );

  // Filter by category locally as well — the API filter + local filter
  // are redundant but harmless, and the local filter keeps the UI
  // snappy when toggling between tabs.
  const filtered = useMemo(() => {
    if (activeCategory === "all") return connectors;
    return connectors.filter((c) => c.category === activeCategory);
  }, [connectors, activeCategory]);

  const installedCount = useMemo(
    () => connectors.filter((c) => c.status === "installed").length,
    [connectors],
  );

  return (
    <FullScreenPanel
      title="Connector Marketplace"
      icon={<Plug className="h-3.5 w-3.5 text-cyan-300" />}
      actions={
        <button
          type="button"
          onClick={() => void fetchConnectors()}
          disabled={loading}
          aria-label="Refresh connectors"
          className="flex h-7 w-7 items-center justify-center rounded-md border border-border/60 text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
        </button>
      }
    >
      <div className="space-y-3 p-3">
        {/* Filter bar */}
        <div className="mc-surface flex flex-col gap-2 rounded-lg border border-border/60 bg-surface-2/30 p-3 sm:flex-row sm:items-center sm:justify-between">
          <Tabs
            value={activeCategory}
            onValueChange={(v) => setActiveCategory(v as Category)}
          >
            <TabsList className="h-7">
              {CATEGORY_TABS.map((tab) => (
                <TabsTrigger
                  key={tab.value}
                  value={tab.value}
                  className="px-2 py-0 font-mono text-[10px] uppercase tracking-wider"
                >
                  {tab.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setInstalledOnly((p) => !p)}
              aria-pressed={installedOnly}
              className={`flex h-7 items-center gap-1 rounded border px-2 font-mono text-[10px] font-medium transition-colors ${
                installedOnly
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
                  : "border-border/60 bg-surface-2/60 text-muted-foreground hover:border-primary/40 hover:text-foreground"
              }`}
            >
              <CheckCircle2 className="h-3 w-3" />
              Installed ({installedCount})
            </button>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="rounded border border-rose-500/30 bg-rose-500/5 px-2 py-1.5 font-mono text-[10px] text-rose-300">
            load failed: {error}
          </div>
        )}

        {/* Loading */}
        {loading ? (
          <div className="flex items-center justify-center gap-1.5 py-8 font-mono text-[10px] text-muted-foreground/60">
            <Loader2 className="h-3 w-3 animate-spin" />
            loading connectors…
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={Inbox}
            label={
              installedOnly
                ? `No installed ${activeCategory === "all" ? "" : activeCategory} connectors`
                : `No ${activeCategory === "all" ? "" : activeCategory} connectors available`
            }
            hint="Try a different category or clear the installed-only filter."
          />
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
            <AnimatePresence mode="popLayout">
              {filtered.map((c) => (
                <ConnectorCard
                  key={c.id}
                  connector={c}
                  onInstall={() => void installConnector(c)}
                  installing={installingId === c.id}
                />
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>
    </FullScreenPanel>
  );
}

// ─── Connector Card ─────────────────────────────────────────────────
function ConnectorCard({
  connector,
  onInstall,
  installing,
}: {
  connector: Connector;
  onInstall: () => void;
  installing: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const auth = authMeta(connector.authType);
  const AuthIcon = auth.icon;
  const categoryTone =
    CATEGORY_TONE[connector.category] ?? "text-muted-foreground border-border/60 bg-surface-2/40";

  return (
    <motion.div
      layout
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="flex flex-col gap-2 rounded-md border border-border/60 bg-background/40 p-3"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <div
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border/60"
            style={{ backgroundColor: `${connector.accent}1a` }}
          >
            <Plug className="h-3.5 w-3.5" style={{ color: connector.accent }} />
          </div>
          <div className="min-w-0">
            <div className="truncate text-[12px] font-semibold text-foreground">
              {connector.name}
            </div>
            <div className="font-mono text-[9px] text-muted-foreground/70">
              by {connector.author}
            </div>
          </div>
        </div>
        <Badge
          variant="outline"
          className={`shrink-0 px-1.5 py-0 text-[9px] font-bold ${categoryTone}`}
        >
          {connector.category}
        </Badge>
      </div>

      <div className="line-clamp-2 text-[10px] leading-relaxed text-muted-foreground/80">
        {connector.description}
      </div>

      <div className="flex items-center justify-between gap-2">
        <Stars rating={connector.rating} />
        <span className="font-mono text-[9px] text-muted-foreground/70">
          {connector.installs >= 1000
            ? `${(connector.installs / 1000).toFixed(1)}k installs`
            : `${connector.installs} installs`}
        </span>
      </div>

      <div className="flex items-center gap-1.5 font-mono text-[9px] text-muted-foreground/70">
        <AuthIcon className="h-2.5 w-2.5" />
        {auth.label}
      </div>

      {/* Status / Install action */}
      <div className="flex items-center gap-1.5">
        {connector.status === "installed" ? (
          <div className="flex h-7 flex-1 items-center justify-center gap-1 rounded border border-emerald-500/40 bg-emerald-500/10 px-2 font-mono text-[10px] font-medium text-emerald-200">
            <CheckCircle2 className="h-3 w-3" />
            Installed
          </div>
        ) : connector.status === "coming_soon" ? (
          <div className="flex h-7 flex-1 items-center justify-center gap-1 rounded border border-amber-500/40 bg-amber-500/10 px-2 font-mono text-[10px] font-medium text-amber-200">
            Coming Soon
          </div>
        ) : (
          <button
            type="button"
            onClick={onInstall}
            disabled={installing}
            className="flex h-7 flex-1 items-center justify-center gap-1 rounded border border-violet-500/40 bg-violet-500/10 px-2 font-mono text-[10px] font-medium text-violet-200 transition-colors hover:bg-violet-500/20 disabled:opacity-50"
          >
            {installing ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Download className="h-3 w-3" />
            )}
            {installing ? "Installing…" : "Install"}
          </button>
        )}
        <button
          type="button"
          onClick={() => setExpanded((p) => !p)}
          aria-label={expanded ? "Hide setup steps" : "Show setup steps"}
          aria-expanded={expanded}
          className="flex h-7 items-center rounded border border-border/60 bg-surface-2/60 px-2 font-mono text-[10px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
        >
          {expanded ? "Hide" : "Setup"}
        </button>
      </div>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <ol className="space-y-1 border-t border-border/40 pt-2">
              {connector.setupSteps.map((step, idx) => (
                <li
                  key={idx}
                  className="flex items-start gap-1.5 rounded border border-border/30 bg-surface-2/30 px-2 py-1"
                >
                  <span className="mt-0.5 font-mono text-[9px] font-bold text-muted-foreground/50">
                    {String(idx + 1).padStart(2, "0")}
                  </span>
                  <span className="text-[10px] text-foreground/90">{step}</span>
                </li>
              ))}
            </ol>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ─── Empty State ────────────────────────────────────────────────────
function EmptyState({
  icon: Icon,
  label,
  hint,
}: {
  icon: LucideIcon;
  label: string;
  hint?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-1.5 py-8 text-center">
      <Icon className="h-6 w-6 text-muted-foreground/40" />
      <div className="text-[11px] font-medium text-muted-foreground">{label}</div>
      {hint && (
        <div className="max-w-sm px-4 font-mono text-[9px] text-muted-foreground/60">
          {hint}
        </div>
      )}
    </div>
  );
}
