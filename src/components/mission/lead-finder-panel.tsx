"use client";

import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import {
  Target,
  TrendingUp,
  Check,
  X,
  ExternalLink,
  RefreshCw,
  Loader2,
  Mail,
} from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

// ─── Types ───────────────────────────────────────────────────────────
type LeadTab = "discovered" | "qualified";

interface Lead {
  id: string;
  title: string;
  status: string;
  confidenceScore: number;
  businessName: string;
  website: string;
  industry: string;
  serviceMatched: string;
  reasoning: string;
  suggestedOutreach: string;
  contactEmail: string | null;
  estimatedRevenue: number | null;
  discoveredAt: string;
}

interface LeadsResponse {
  leads: Lead[];
  count: number;
  error?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────
function timeAgo(date: Date | string): string {
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function confidenceColor(score: number): string {
  if (score >= 80) return "#34d399"; // emerald
  if (score >= 50) return "#fbbf24"; // amber
  return "#f87171"; // rose
}

function confidenceLabel(score: number): string {
  if (score >= 80) return "High";
  if (score >= 50) return "Medium";
  return "Low";
}

function formatRevenue(value: number | null): string {
  if (value == null) return "—";
  if (value >= 1000) {
    return `$${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)}k`;
  }
  return `$${value}`;
}

function normalizeWebsite(url: string): string | null {
  if (!url) return null;
  try {
    if (!/^https?:\/\//i.test(url)) {
      url = `https://${url}`;
    }
    const u = new URL(url);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

async function jsonOrThrow(res: Response): Promise<any> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error || `request failed (${res.status})`);
  }
  return data;
}

// ─── LeadCard ────────────────────────────────────────────────────────
function LeadCard({
  lead,
  onApprove,
  onDiscard,
  busy,
}: {
  lead: Lead;
  onApprove: (id: string) => void;
  onDiscard: (id: string) => void;
  busy: boolean;
}) {
  const score = Math.max(0, Math.min(100, Math.round(lead.confidenceScore || 0)));
  const color = confidenceColor(score);
  const host = normalizeWebsite(lead.website);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.2 }}
    >
      <Card className="aria-feature-card overflow-hidden">
        <CardContent className="space-y-3 p-4">
          {/* Top row: business + confidence */}
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="truncate text-sm font-semibold text-foreground">
                  {lead.businessName || lead.title}
                </h3>
                {lead.industry && lead.industry !== "unknown" && (
                  <Badge
                    variant="outline"
                    className="border-white/10 bg-white/[0.03] text-[10px] text-muted-foreground"
                  >
                    {lead.industry}
                  </Badge>
                )}
              </div>
              {host && (
                <a
                  href={
                    /^https?:\/\//i.test(lead.website)
                      ? lead.website
                      : `https://${lead.website}`
                  }
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 inline-flex items-center gap-1 text-xs text-emerald-300 hover:text-emerald-200 hover:underline"
                >
                  {host}
                  <ExternalLink className="size-3" />
                </a>
              )}
            </div>

            {/* Confidence badge */}
            <div className="flex shrink-0 items-center gap-2">
              <Badge
                variant="outline"
                style={{
                  color,
                  borderColor: `${color}55`,
                  backgroundColor: `${color}14`,
                }}
              >
                {confidenceLabel(score)} · {score}
              </Badge>
            </div>
          </div>

          {/* Confidence bar */}
          <div className="space-y-1">
            <Progress
              value={score}
              className="h-1.5 bg-white/5"
            />
            <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-muted-foreground">
              <span>Confidence</span>
              <span style={{ color }}>{score}/100</span>
            </div>
          </div>

          {/* Service matched */}
          {lead.serviceMatched && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Service
              </span>
              <Badge className="border-emerald-500/30 bg-emerald-500/10 text-emerald-300">
                {lead.serviceMatched}
              </Badge>
            </div>
          )}

          {/* Reasoning */}
          {lead.reasoning && (
            <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
              {lead.reasoning}
            </p>
          )}

          {/* Suggested outreach */}
          {lead.suggestedOutreach && (
            <blockquote className="border-l-2 border-emerald-500/40 bg-emerald-500/[0.04] py-2 pl-3 pr-2 text-xs italic text-emerald-100/80">
              &ldquo;{lead.suggestedOutreach}&rdquo;
            </blockquote>
          )}

          {/* Meta + actions */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/5 pt-3">
            <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
              {lead.estimatedRevenue != null && (
                <span className="inline-flex items-center gap-1">
                  <TrendingUp className="size-3 text-emerald-300/70" />
                  {formatRevenue(lead.estimatedRevenue)}
                </span>
              )}
              {lead.contactEmail && (
                <span className="inline-flex items-center gap-1">
                  <Mail className="size-3 text-emerald-300/70" />
                  <a
                    href={`mailto:${lead.contactEmail}`}
                    className="hover:text-emerald-300 hover:underline"
                  >
                    {lead.contactEmail}
                  </a>
                </span>
              )}
              <span>{timeAgo(lead.discoveredAt)}</span>
            </div>

            <div className="flex items-center gap-2">
              <Button
                size="sm"
                onClick={() => onApprove(lead.id)}
                disabled={busy}
                className="aria-btn-gradient h-8 px-3"
              >
                {busy ? (
                  <Loader2 className="mr-1 size-3.5 animate-spin" />
                ) : (
                  <Check className="mr-1 size-3.5" />
                )}
                Approve
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => onDiscard(lead.id)}
                disabled={busy}
                className="h-8 border-rose-500/40 px-3 text-rose-300 hover:bg-rose-500/10 hover:text-rose-200"
              >
                <X className="mr-1 size-3.5" />
                Discard
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

// ─── LeadFinderPanel ─────────────────────────────────────────────────
export function LeadFinderPanel() {
  const [tab, setTab] = useState<LeadTab>("discovered");
  const [discovered, setDiscovered] = useState<Lead[]>([]);
  const [qualified, setQualified] = useState<Lead[]>([]);
  const [discoveredCount, setDiscoveredCount] = useState(0);
  const [qualifiedCount, setQualifiedCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  // ─── Fetch both lists ───
  const refresh = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    try {
      const [discRes, qualRes] = await Promise.all([
        fetch("/api/leads?status=discovered"),
        fetch("/api/leads?status=qualified"),
      ]);

      const disc = (await jsonOrThrow(discRes)) as LeadsResponse;
      const qual = (await jsonOrThrow(qualRes)) as LeadsResponse;

      setDiscovered(Array.isArray(disc?.leads) ? disc.leads : []);
      setQualified(Array.isArray(qual?.leads) ? qual.leads : []);
      setDiscoveredCount(disc?.count ?? 0);
      setQualifiedCount(qual?.count ?? 0);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "failed to load leads");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // ─── Approve ───
  const handleApprove = useCallback(
    async (id: string) => {
      setBusyId(id);
      try {
        await jsonOrThrow(await fetch(`/api/leads/${id}/approve`, { method: "POST" }));
        toast.success("Outreach approved — lead moved to qualified");
        await refresh(true);
        setTab("qualified");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "failed to approve lead");
      } finally {
        setBusyId(null);
      }
    },
    [refresh],
  );

  // ─── Discard ───
  const handleDiscard = useCallback(
    async (id: string) => {
      setBusyId(id);
      const reason = window.prompt("Why discard this lead? (optional)") || "";
      try {
        await jsonOrThrow(
          await fetch(`/api/leads/${id}/discard`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ reason }),
          }),
        );
        toast.success("Lead discarded");
        await refresh(true);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "failed to discard lead");
      } finally {
        setBusyId(null);
      }
    },
    [refresh],
  );

  const renderEmpty = () => (
    <div className="flex flex-col items-center gap-2 py-16 text-center">
      <Target className="size-8 text-emerald-300/40" />
      <p className="text-sm text-muted-foreground">
        No leads discovered yet — the LeadFinder runs daily at 9am.
      </p>
    </div>
  );

  return (
    <Card className="aria-feature-card">
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-300">
              <Target className="size-5" />
            </div>
            <div>
              <CardTitle className="text-base">LeadFinder Pipeline</CardTitle>
              <CardDescription className="text-xs">
                Human-in-the-loop review of discovered business leads.
              </CardDescription>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void refresh(true)}
            disabled={refreshing || loading}
            className="border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/10"
          >
            <RefreshCw className={refreshing ? "mr-2 size-3.5 animate-spin" : "mr-2 size-3.5"} />
            Refresh
          </Button>
        </div>
      </CardHeader>

      <CardContent>
        <Tabs value={tab} onValueChange={(v) => setTab(v as LeadTab)} className="w-full">
          <TabsList className="bg-white/[0.03]">
            <TabsTrigger value="discovered" className="text-xs data-[state=active]:bg-emerald-500/15 data-[state=active]:text-emerald-300">
              Discovered ({discoveredCount})
            </TabsTrigger>
            <TabsTrigger value="qualified" className="text-xs data-[state=active]:bg-emerald-500/15 data-[state=active]:text-emerald-300">
              Qualified ({qualifiedCount})
            </TabsTrigger>
          </TabsList>

          {/* Discovered tab */}
          <TabsContent value="discovered" className="mt-4">
            {loading ? (
              <div className="flex items-center gap-2 py-12 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                Loading leads…
              </div>
            ) : discovered.length === 0 ? (
              renderEmpty()
            ) : (
              <div className="grid max-h-[36rem] gap-3 overflow-y-auto pr-1 sm:grid-cols-2">
                <AnimatePresence mode="popLayout">
                  {discovered.map((lead) => (
                    <LeadCard
                      key={lead.id}
                      lead={lead}
                      onApprove={handleApprove}
                      onDiscard={handleDiscard}
                      busy={busyId === lead.id}
                    />
                  ))}
                </AnimatePresence>
              </div>
            )}
          </TabsContent>

          {/* Qualified tab */}
          <TabsContent value="qualified" className="mt-4">
            {loading ? (
              <div className="flex items-center gap-2 py-12 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                Loading leads…
              </div>
            ) : qualified.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-16 text-center">
                <Check className="size-8 text-emerald-300/40" />
                <p className="text-sm text-muted-foreground">
                  No qualified leads yet. Approve discovered leads to move them here.
                </p>
              </div>
            ) : (
              <div className="grid max-h-[36rem] gap-3 overflow-y-auto pr-1 sm:grid-cols-2">
                <AnimatePresence mode="popLayout">
                  {qualified.map((lead) => (
                    <LeadCard
                      key={lead.id}
                      lead={lead}
                      onApprove={handleApprove}
                      onDiscard={handleDiscard}
                      busy={busyId === lead.id}
                    />
                  ))}
                </AnimatePresence>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

export default LeadFinderPanel;
