/**
 * /dashboard/lead-hunt — v71 Phase 21 (RULE-69)
 *
 * Autonomous Lead Hunt dashboard. Shows:
 *   - Funnel: discovered → qualified → contacted → replied → converted
 *   - Recent leads (with platform, buying signal, matched service, verdict)
 *   - "Trigger hunt now" button (POST /api/lead-hunt/run)
 *
 * Auto-refreshes every 30s when there are recent leads.
 */

"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Target, TrendingUp, Search, MessageCircle, CheckCircle2, XCircle, HelpCircle } from "lucide-react";

interface Lead {
  id: string;
  source: string;
  platform: string;
  username: string;
  displayName: string;
  postContent: string;
  postUrl: string;
  profileUrl: string;
  likes: number;
  replies: number;
  followerCount: number;
  accountAgeDays: number;
  topMatchedService: string;
  qualificationVerdict: string;
  qualificationScore: number;
  qualificationReasoning: string;
  outreachStatus: string;
  outreachChannel: string;
  discoveredAt: string;
  qualifiedAt: string | null;
  contactedAt: string | null;
}

interface HuntResponse {
  ok: boolean;
  period?: string;
  funnel?: {
    discovered: number;
    qualified: number;
    investigated: number;
    skipped: number;
    contacted: number;
    replied: number;
    converted: number;
  };
  byPlatform?: Record<string, number>;
  byService?: Record<string, number>;
  leads?: Lead[];
  message?: string;
  error?: string;
}

const verdictBadge = (v: string) => {
  switch (v) {
    case "pursue": return <Badge className="bg-emerald-500 hover:bg-emerald-600">🎯 PURSUE</Badge>;
    case "investigate": return <Badge className="bg-amber-500 hover:bg-amber-600">🔍 INVESTIGATE</Badge>;
    case "skip": return <Badge className="bg-slate-500 hover:bg-slate-600">⛔ SKIP</Badge>;
    default: return <Badge variant="outline">⏳ PENDING</Badge>;
  }
};

const platformIcon = (p: string) => {
  switch (p) {
    case "twitter": return "𝕏";
    case "linkedin": return "in";
    case "reddit": return "r/";
    default: return "?";
  }
};

export default function LeadHuntDashboard() {
  const [data, setData] = useState<HuntResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);

  const fetchMetrics = useCallback(async () => {
    try {
      const res = await fetch("/api/lead-hunt/run", { cache: "no-store" });
      const json: HuntResponse = await res.json();
      setData(json);
    } catch (err) {
      console.error("Failed to fetch lead hunt metrics", err);
    } finally {
      setLoading(false);
    }
  }, []);

  const triggerHunt = useCallback(async () => {
    setRunning(true);
    try {
      const res = await fetch("/api/lead-hunt/run", { method: "POST" });
      const json: HuntResponse = await res.json();
      if (json.ok) {
        // Refresh metrics after the hunt completes.
        setTimeout(fetchMetrics, 500);
      } else {
        alert(json.error ?? "Hunt failed");
      }
    } catch (err) {
      alert(`Hunt failed: ${err}`);
    } finally {
      setRunning(false);
    }
  }, [fetchMetrics]);

  useEffect(() => {
    fetchMetrics();
    // Auto-refresh every 30s.
    const interval = setInterval(fetchMetrics, 30_000);
    return () => clearInterval(interval);
  }, [fetchMetrics]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const funnel = data?.funnel;
  const leads = data?.leads ?? [];
  const byPlatform = data?.byPlatform ?? {};
  const byService = data?.byService ?? {};

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Target className="h-8 w-8 text-primary" />
            Autonomous Lead Hunt
          </h1>
          <p className="text-muted-foreground">
            v71 Phase 21 (RULE-69) — the app hunts for leads 24/7 via Twitter / LinkedIn / Reddit
          </p>
        </div>
        <Button onClick={triggerHunt} disabled={running}>
          {running ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin mr-2" /> Hunting...
            </>
          ) : (
            <>
              <Search className="h-4 w-4 mr-2" /> Trigger Hunt Now
            </>
          )}
        </Button>
      </div>

      {/* Funnel */}
      {funnel && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground">Discovered</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{funnel.discovered}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium text-emerald-600">🎯 Pursued</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-emerald-600">{funnel.qualified}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium text-amber-600">🔍 Investigating</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-amber-600">{funnel.investigated}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium text-slate-500">⛔ Skipped</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-slate-500">{funnel.skipped}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground">✉️ Contacted</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{funnel.contacted}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground">💬 Replied</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{funnel.replied}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium text-emerald-600">💰 Converted</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-emerald-600">{funnel.converted}</div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Platform + service breakdown */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">By Platform (7d)</CardTitle>
          </CardHeader>
          <CardContent>
            {Object.keys(byPlatform).length === 0 ? (
              <p className="text-sm text-muted-foreground">No leads yet.</p>
            ) : (
              <div className="space-y-2">
                {Object.entries(byPlatform).map(([p, count]) => (
                  <div key={p} className="flex items-center justify-between">
                    <span className="text-sm capitalize flex items-center gap-2">
                      <Badge variant="outline">{platformIcon(p)}</Badge> {p}
                    </span>
                    <span className="font-bold">{count}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">By Matched Service (7d)</CardTitle>
          </CardHeader>
          <CardContent>
            {Object.keys(byService).length === 0 ? (
              <p className="text-sm text-muted-foreground">No matches yet.</p>
            ) : (
              <div className="space-y-2">
                {Object.entries(byService).sort(([, a], [, b]) => b - a).map(([s, count]) => (
                  <div key={s} className="flex items-center justify-between">
                    <span className="text-sm">{s}</span>
                    <span className="font-bold">{count}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent leads */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Leads (last 7 days)</CardTitle>
        </CardHeader>
        <CardContent>
          {leads.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Search className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p>No leads discovered yet.</p>
              <p className="text-xs mt-1">Click "Trigger Hunt Now" to run the daily-lead-hunt pipeline.</p>
              <p className="text-xs mt-1">Or wait for the 6 AM cron to run automatically.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {leads.slice(0, 50).map((lead) => (
                <div key={lead.id} className="border rounded-lg p-4 hover:bg-muted/50 transition-colors">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge variant="outline" className="text-xs">{platformIcon(lead.platform)}</Badge>
                        <span className="font-medium truncate">@{lead.username}</span>
                        <span className="text-xs text-muted-foreground">·</span>
                        <span className="text-xs text-muted-foreground">
                          {new Date(lead.discoveredAt).toLocaleString()}
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground line-clamp-2 mb-2">
                        &ldquo;{lead.postContent}&rdquo;
                      </p>
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        {lead.topMatchedService && (
                          <Badge variant="secondary">{lead.topMatchedService}</Badge>
                        )}
                        {lead.likes > 0 && <span className="text-muted-foreground">❤️ {lead.likes}</span>}
                        {lead.replies > 0 && <span className="text-muted-foreground">💬 {lead.replies}</span>}
                        {lead.followerCount > 0 && (
                          <span className="text-muted-foreground">👥 {lead.followerCount}</span>
                        )}
                        {lead.accountAgeDays > 0 && (
                          <span className="text-muted-foreground">📅 {lead.accountAgeDays}d old</span>
                        )}
                      </div>
                      {lead.qualificationReasoning && (
                        <p className="text-xs text-muted-foreground italic mt-2 line-clamp-2">
                          {lead.qualificationReasoning.slice(0, 200)}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-2 shrink-0">
                      {verdictBadge(lead.qualificationVerdict)}
                      {lead.qualificationScore > 0 && (
                        <span className="text-xs text-muted-foreground">
                          {lead.qualificationScore}% confidence
                        </span>
                      )}
                      {lead.outreachStatus !== "none" && (
                        <Badge variant="outline" className="text-xs">
                          {lead.outreachStatus}
                        </Badge>
                      )}
                      {lead.postUrl && (
                        <a
                          href={lead.postUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-primary hover:underline"
                        >
                          View post →
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
