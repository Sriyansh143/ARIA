"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Building2,
  Check,
  ChevronDown,
  Loader2,
  Plus,
  RefreshCw,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { CompanyProfile } from "@/lib/types";

/**
 * CompanySwitcher — multi-company dropdown.
 *
 * Sits in the mission header. Shows the active company name + opens a
 * dropdown to switch between companies under the same ARIA account.
 * Calls `/api/companies` to list + `/api/companies/[id]?switch=true` to
 * activate a company (the API writes the active-company cookie).
 *
 * If there are no companies yet (first run), surfaces a "create company"
 * link that POSTs a default company and switches to it.
 *
 * Used by MissionHeader — wired in `src/components/mission/mission-header.tsx`.
 */
export function CompanySwitcher() {
  const [companies, setCompanies] = useState<CompanyProfile[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState(false);
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState(false);

  async function refresh() {
    try {
      const res = await fetch("/api/companies", { cache: "no-store" });
      if (!res.ok) throw new Error("fetch failed");
      const data = (await res.json()) as { companies: CompanyProfile[]; activeCompanyId: string | null };
      setCompanies(data.companies);
      setActiveId(data.activeCompanyId ?? data.companies[0]?.id ?? null);
    } catch {
      // Silent — the switcher is non-critical; the dashboard works fine
      // even if multi-company is offline.
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function handleSwitch(id: string) {
    if (id === activeId) {
      setOpen(false);
      return;
    }
    setSwitching(true);
    try {
      const res = await fetch(`/api/companies/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ switch: true }),
      });
      if (!res.ok) throw new Error("switch failed");
      const data = (await res.json()) as { company: CompanyProfile; switched: boolean };
      if (data.switched) {
        setActiveId(id);
        toast.success("Company switched", { description: data.company.name });
      } else {
        toast.error("Could not switch — company may be inactive.");
      }
      setOpen(false);
    } catch {
      toast.error("Failed to switch company");
    } finally {
      setSwitching(false);
    }
  }

  async function handleCreate() {
    setCreating(true);
    try {
      const name = window.prompt("New company name", "Acme Robotics");
      if (!name || !name.trim()) return;
      const res = await fetch("/api/companies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), switchTo: true }),
      });
      if (!res.ok) throw new Error("create failed");
      const data = (await res.json()) as { company: CompanyProfile };
      await refresh();
      toast.success("Company created", { description: data.company.name });
      setOpen(false);
    } catch {
      toast.error("Failed to create company");
    } finally {
      setCreating(false);
    }
  }

  const active = companies.find((c) => c.id === activeId) ?? companies[0] ?? null;

  if (loading) {
    return (
      <div className="flex items-center gap-1.5 border border-border/60 px-2 py-1 font-mono text-[10px] text-muted-foreground" style={{ borderRadius: 0 }}>
        <Loader2 className="h-3 w-3 animate-spin" />
        <span className="hidden sm:inline">companies…</span>
      </div>
    );
  }

  if (companies.length === 0) {
    return (
      <button
        onClick={handleCreate}
        disabled={creating}
        className="flex items-center gap-1.5 border border-primary/40 bg-primary/10 px-2 py-1 font-mono text-[10px] font-semibold uppercase tracking-wider text-primary transition-colors hover:bg-primary/20 disabled:opacity-50"
        style={{ borderRadius: 0 }}
        title="No companies yet — click to create your first"
      >
        <Plus className="h-3 w-3" />
        <span className="hidden sm:inline">{creating ? "creating…" : "add company"}</span>
      </button>
    );
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        className="flex items-center gap-1.5 border border-border/60 bg-card/60 px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-foreground transition-colors hover:bg-card/80 focus:outline-none focus:ring-1 focus:ring-primary/40"
        style={{ borderRadius: 0 }}
        aria-label={`Switch company — current: ${active?.name ?? "none"}`}
      >
        <Building2 className="h-3 w-3 text-cyan-300" />
        <span className="max-w-[120px] truncate">{active?.name ?? "no company"}</span>
        <ChevronDown className="h-3 w-3 opacity-60" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="min-w-[220px] max-w-[280px] border-border/70 bg-card/95 backdrop-blur"
      >
        <DropdownMenuLabel className="font-mono text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
          Companies ({companies.length})
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <div className="mc-scroll max-h-72 overflow-y-auto">
          {companies.map((c) => (
            <DropdownMenuItem
              key={c.id}
              onSelect={(e) => {
                e.preventDefault();
                void handleSwitch(c.id);
              }}
              className="flex items-start gap-2 py-1.5"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-medium text-foreground">{c.name}</span>
                  {c.id === active?.id && (
                    <Check className="h-3 w-3 shrink-0 text-emerald-300" />
                  )}
                </div>
                {c.tagline && (
                  <p className="line-clamp-1 font-mono text-[9px] text-muted-foreground">
                    {c.tagline}
                  </p>
                )}
                <div className="mt-0.5 flex items-center gap-2 font-mono text-[9px] text-muted-foreground">
                  {c.industry && <span>{c.industry}</span>}
                  {c.currency && <span>· {c.currency}</span>}
                </div>
              </div>
              {switching && c.id === activeId && (
                <Loader2 className="h-3 w-3 animate-spin text-primary" />
              )}
            </DropdownMenuItem>
          ))}
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault();
            void handleCreate();
          }}
          className="font-mono text-[10px] uppercase tracking-wider text-primary"
        >
          <Plus className="h-3 w-3" /> new company
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault();
            void refresh();
          }}
          className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground"
        >
          <RefreshCw className="h-3 w-3" /> refresh
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
