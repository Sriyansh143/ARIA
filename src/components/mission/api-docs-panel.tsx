"use client";

/**
 * ApiDocsPanel — interactive API documentation panel.
 *
 * Fetches `/api/openapi` on mount, renders a grouped, searchable table
 * of every API route in the central registry, and offers a "Download
 * OpenAPI Spec" button to save the raw JSON for use with Swagger UI /
 * Postman / Redoc.
 *
 * The panel matches the dark `mc-surface` aesthetic of every other
 * mission-control panel: monospace type, method-coloured badges, and
 * a scrollable body with a custom scrollbar.
 *
 * Task ID: HARDEN-SCALE-DOCS (Task 4).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import {
  FileText,
  Search,
  Download,
  RefreshCw,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import { FullScreenPanel } from "./full-screen-panel";
import { Input } from "@/components/ui/input";

// ─── Types (subset of OpenAPI 3.0 we consume) ────────────────────────

type HttpMethod = "get" | "post" | "put" | "patch" | "delete";

interface OpenApiOperation {
  summary?: string;
  description?: string;
  operationId?: string;
  tags?: string[];
}

interface OpenApiPathItem {
  [method: string]: OpenApiOperation;
}

interface OpenApiInfo {
  title: string;
  version: string;
  description?: string;
}

interface OpenApiSpec {
  openapi: string;
  info: OpenApiInfo;
  paths: Record<string, OpenApiPathItem>;
}

interface FlatRoute {
  method: HttpMethod;
  path: string;
  desc: string;
  tag: string;
}

// ─── Style maps ──────────────────────────────────────────────────────

const METHOD_TONE: Record<HttpMethod, string> = {
  get: "text-emerald-300 border-emerald-500/30 bg-emerald-500/10",
  post: "text-cyan-300 border-cyan-500/30 bg-cyan-500/10",
  patch: "text-amber-300 border-amber-500/30 bg-amber-500/10",
  put: "text-amber-300 border-amber-500/30 bg-amber-500/10",
  delete: "text-rose-300 border-rose-500/30 bg-rose-500/10",
};

const HTTP_METHODS: HttpMethod[] = ["get", "post", "put", "patch", "delete"];

// ─── Component ───────────────────────────────────────────────────────

export function ApiDocsPanel() {
  const [spec, setSpec] = useState<OpenApiSpec | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const fetchSpec = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/openapi", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json().catch(() => ({}))) as OpenApiSpec;
      if (!data.openapi || !data.paths) {
        throw new Error("invalid OpenAPI document");
      }
      setSpec(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load OpenAPI spec";
      setError(msg);
      if (!opts?.silent) {
        toast.error("Failed to load API docs", { description: msg });
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchSpec();
  }, [fetchSpec]);

  // Flatten the OpenAPI paths object into a sorted route list.
  const flatRoutes = useMemo<FlatRoute[]>(() => {
    if (!spec) return [];
    const out: FlatRoute[] = [];
    for (const [path, item] of Object.entries(spec.paths)) {
      for (const method of HTTP_METHODS) {
        const op = item[method];
        if (!op) continue;
        out.push({
          method,
          path,
          desc: op.summary ?? op.description ?? "",
          tag: op.tags?.[0] ?? "misc",
        });
      }
    }
    out.sort((a, b) => {
      if (a.tag !== b.tag) return a.tag.localeCompare(b.tag);
      if (a.path !== b.path) return a.path.localeCompare(b.path);
      return a.method.localeCompare(b.method);
    });
    return out;
  }, [spec]);

  // Group by tag (path prefix). Insertion order preserved by Map.
  const grouped = useMemo(() => {
    const map = new Map<string, FlatRoute[]>();
    for (const r of flatRoutes) {
      if (!map.has(r.tag)) map.set(r.tag, []);
      map.get(r.tag)!.push(r);
    }
    return map;
  }, [flatRoutes]);

  // Apply the search filter (path OR description, case-insensitive).
  const filteredGrouped = useMemo(() => {
    if (!query.trim()) return grouped;
    const q = query.trim().toLowerCase();
    const out = new Map<string, FlatRoute[]>();
    for (const [tag, routes] of grouped) {
      const matched = routes.filter(
        (r) =>
          r.path.toLowerCase().includes(q) ||
          r.desc.toLowerCase().includes(q) ||
          r.method.toLowerCase().includes(q),
      );
      if (matched.length > 0) out.set(tag, matched);
    }
    return out;
  }, [grouped, query]);

  const totalRoutes = flatRoutes.length;
  const visibleRoutes = Array.from(filteredGrouped.values()).reduce(
    (s, list) => s + list.length,
    0,
  );

  const handleDownload = useCallback(() => {
    if (!spec) {
      toast.info("No spec to download", { description: "Fetch the spec first" });
      return;
    }
    try {
      const blob = new Blob([JSON.stringify(spec, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `aria-mission-control-openapi-${new Date()
        .toISOString()
        .replace(/[:.]/g, "-")}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success("Downloaded OpenAPI spec", {
        description: `${totalRoutes} routes → ${a.download}`,
      });
    } catch (err) {
      toast.error("Failed to download spec", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }, [spec, totalRoutes]);

  return (
    <FullScreenPanel
      title="API Documentation"
      icon={<FileText className="h-3.5 w-3.5 text-cyan-300" />}
      actions={
        <>
          <button
            type="button"
            onClick={() => void fetchSpec()}
            disabled={loading}
            title="Refresh spec"
            className="flex h-7 w-7 items-center justify-center rounded-md border border-border/60 text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground disabled:opacity-50"
          >
            <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
          </button>
          <button
            type="button"
            onClick={handleDownload}
            disabled={!spec}
            title="Download OpenAPI JSON"
            className="flex h-7 items-center gap-1 rounded-md border border-border/60 bg-surface-2/60 px-2 font-mono text-[10px] font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground disabled:opacity-50"
          >
            <Download className="h-3 w-3" />
            <span className="hidden sm:inline">Download</span>
          </button>
        </>
      }
    >
      <div className="flex h-full flex-col">
        {/* Header: title + version + counts + search */}
        <div className="border-b border-border/60 px-4 py-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px]">
            <span className="font-semibold uppercase tracking-[0.18em] text-foreground">
              {spec?.info.title ?? "ARIA Mission Control API"}
            </span>
            {spec?.info.version && (
              <span className="rounded border border-border/60 bg-surface-2/60 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                {spec.info.version}
              </span>
            )}
            <span className="text-border">·</span>
            <span className="text-muted-foreground">
              {totalRoutes} routes
            </span>
            {query.trim() && (
              <>
                <span className="text-border">·</span>
                <span className="text-cyan-300">
                  {visibleRoutes} match
                </span>
              </>
            )}
          </div>
          {spec?.info.description && (
            <p className="mt-1.5 font-mono text-[10px] leading-relaxed text-muted-foreground/80">
              {spec.info.description}
            </p>
          )}
          <div className="relative mt-3">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground/60" />
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter routes by path or description…"
              className="h-8 rounded-md border-border/60 bg-surface-2/40 pl-8 font-mono text-[11px] text-foreground placeholder:text-muted-foreground/50"
            />
          </div>
        </div>

        {/* Body: loading / error / table */}
        <div className="mc-scroll relative min-h-0 flex-1 overflow-y-auto">
          {loading && (
            <div className="flex h-full min-h-[200px] items-center justify-center gap-2 font-mono text-[10px] text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              <span>loading spec…</span>
            </div>
          )}

          {!loading && error && (
            <div className="flex h-full min-h-[200px] flex-col items-center justify-center gap-2 px-4 text-center font-mono text-[10px] text-rose-300">
              <AlertTriangle className="h-4 w-4" />
              <span>failed to load spec</span>
              <span className="text-muted-foreground">{error}</span>
              <button
                type="button"
                onClick={() => void fetchSpec()}
                className="mt-1 rounded border border-border/60 px-2 py-1 text-muted-foreground hover:border-primary/40 hover:text-foreground"
              >
                retry
              </button>
            </div>
          )}

          {!loading && !error && filteredGrouped.size === 0 && (
            <div className="flex h-full min-h-[200px] items-center justify-center font-mono text-[10px] text-muted-foreground">
              no routes match &ldquo;{query}&rdquo;
            </div>
          )}

          {!loading && !error && filteredGrouped.size > 0 && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.2 }}
              className="divide-y divide-border/40"
            >
              {Array.from(filteredGrouped.entries()).map(([tag, routes]) => (
                <section key={tag} className="px-4 py-3">
                  <header className="mb-2 flex items-center gap-2">
                    <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-violet-300/80">
                      {tag}
                    </span>
                    <span className="font-mono text-[9px] text-muted-foreground/60">
                      ({routes.length})
                    </span>
                    <div className="ml-2 h-px flex-1 bg-border/40" />
                  </header>
                  <ul className="space-y-0.5">
                    {routes.map((r) => (
                      <li
                        key={`${r.method}-${r.path}`}
                        className="group flex items-start gap-2 rounded px-1.5 py-1 transition-colors hover:bg-surface-2/40"
                      >
                        <MethodBadge method={r.method} />
                        <code className="flex-1 break-all font-mono text-[10px] text-foreground/90">
                          {r.path}
                        </code>
                        <span className="ml-auto hidden max-w-[50%] shrink-0 truncate font-mono text-[9px] text-muted-foreground/70 group-hover:text-muted-foreground sm:block">
                          {r.desc}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </motion.div>
          )}
        </div>

        {/* Footer: legend + endpoint hint */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border/60 px-4 py-2 font-mono text-[9px] text-muted-foreground">
          <span>legend:</span>
          <LegendDot method="get" label="GET" />
          <LegendDot method="post" label="POST" />
          <LegendDot method="patch" label="PATCH" />
          <LegendDot method="delete" label="DELETE" />
          <span className="ml-auto hidden text-muted-foreground/60 sm:inline">
            spec at <code className="text-cyan-300">/api/openapi</code>
          </span>
        </div>
      </div>
    </FullScreenPanel>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────

function MethodBadge({ method }: { method: HttpMethod }) {
  const tone = METHOD_TONE[method] ?? "text-muted-foreground border-border/60 bg-surface-2/40";
  return (
    <span
      className={`inline-flex w-14 shrink-0 justify-center rounded border px-1 py-0.5 font-mono text-[9px] font-semibold uppercase ${tone}`}
    >
      {method}
    </span>
  );
}

function LegendDot({ method, label }: { method: HttpMethod; label: string }) {
  const tone = METHOD_TONE[method] ?? "text-muted-foreground border-border/60 bg-surface-2/40";
  return (
    <span className="flex items-center gap-1">
      <span className={`inline-flex h-2 w-2 rounded-sm border ${tone}`} />
      <span>{label}</span>
    </span>
  );
}

export default ApiDocsPanel;
