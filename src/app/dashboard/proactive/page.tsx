/**
 * /dashboard/proactive — v72 Phase 22 (RULE-70 + RULE-71)
 *
 * Proactive Lead Generation dashboard. Shows:
 *   - Google Maps businesses without websites (discovered today)
 *   - Imported contacts (from Excel uploads)
 *   - Free offer status (X/100 claimed)
 *   - Scheduled social media posts (per-pattern approval state)
 *   - Approval patterns (pending / approved / revoked)
 *   - "Trigger Proactive Promo Now" button (POST /api/proactive-promo/run)
 *
 * Auto-refreshes every 60s.
 */

"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Megaphone, MapPin, FileSpreadsheet, Gift, MessageSquare, CheckCircle2, XCircle, Clock } from "lucide-react";

interface PromoMetrics {
  ok: boolean;
  funnel?: {
    googleMapsBusinesses: number;
    importedContacts: number;
    socialPostsScheduled: number;
    freeOfferRedemptions: number;
  };
  outreach?: {
    sent: number;
    replied: number;
    converted: number;
  };
}

interface FreeOfferStatus {
  ok: boolean;
  status?: {
    cap: number;
    claimed: number;
    pending: number;
    delivered: number;
    rejected: number;
    remaining: number;
  };
  offerText?: string;
}

interface ApprovalPattern {
  id: string;
  patternName: string;
  channel: string;
  category: string;
  status: string;
  approvedAt: string | null;
  expiresAt: string | null;
  usageCount: number;
  maxUsage: number;
}

export default function ProactiveDashboard() {
  const [metrics, setMetrics] = useState<PromoMetrics | null>(null);
  const [offer, setOffer] = useState<FreeOfferStatus | null>(null);
  const [patterns, setPatterns] = useState<ApprovalPattern[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);

  const fetchAll = useCallback(async () => {
    try {
      const [m, o, p] = await Promise.all([
        fetch("/api/proactive-promo/run", { cache: "no-store" }).then((r) => r.json()),
        fetch("/api/free-offers", { cache: "no-store" }).then((r) => r.json()),
        fetch("/api/approval-patterns", { cache: "no-store" }).then((r) => r.json()),
      ]);
      setMetrics(m);
      setOffer(o);
      setPatterns(p?.patterns ?? []);
    } catch (err) {
      console.error("Failed to fetch proactive metrics", err);
    } finally {
      setLoading(false);
    }
  }, []);

  const triggerPromo = useCallback(async () => {
    setRunning(true);
    try {
      const res = await fetch("/api/proactive-promo/run", { method: "POST" });
      const json = await res.json();
      if (!json.ok) alert(json.error ?? "Proactive promo failed");
      setTimeout(fetchAll, 1000);
    } catch (err) {
      alert(`Proactive promo failed: ${err}`);
    } finally {
      setRunning(false);
    }
  }, [fetchAll]);

  useEffect(() => {
    fetchAll();
    const interval = setInterval(fetchAll, 60_000);
    return () => clearInterval(interval);
  }, [fetchAll]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const funnel = metrics?.funnel;
  const outreach = metrics?.outreach;
  const offerStatus = offer?.status;

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Megaphone className="h-8 w-8 text-primary" />
            Proactive Lead Generation
          </h1>
          <p className="text-muted-foreground">
            v72 Phase 22 (RULE-70 + RULE-71) — the app creates leads, doesn't just find them.
          </p>
        </div>
        <Button onClick={triggerPromo} disabled={running}>
          {running ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin mr-2" /> Running...
            </>
          ) : (
            <>
              <Megaphone className="h-4 w-4 mr-2" /> Trigger Promo Now
            </>
          )}
        </Button>
      </div>

      {/* Funnel */}
      {funnel && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                <MapPin className="h-3 w-3" /> GMB No-Website
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{funnel.googleMapsBusinesses}</div>
              <p className="text-xs text-muted-foreground">7d discovered</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                <FileSpreadsheet className="h-3 w-3" /> Imported Contacts
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{funnel.importedContacts}</div>
              <p className="text-xs text-muted-foreground">7d imported</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                <MessageSquare className="h-3 w-3" /> Social Posts
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{funnel.socialPostsScheduled}</div>
              <p className="text-xs text-muted-foreground">7d scheduled</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium text-emerald-600 flex items-center gap-1">
                <Gift className="h-3 w-3" /> Free Offer Redemptions
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-emerald-600">{funnel.freeOfferRedemptions}</div>
              <p className="text-xs text-muted-foreground">7d redeemed</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Free Offer + Outreach */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <Gift className="h-4 w-4" /> Free Offer Status (first 100 customers)
            </CardTitle>
          </CardHeader>
          <CardContent>
            {offerStatus && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm">Claimed</span>
                  <span className="font-bold text-emerald-600">{offerStatus.claimed}/{offerStatus.cap}</span>
                </div>
                <div className="w-full bg-muted rounded-full h-2">
                  <div
                    className="bg-emerald-500 h-2 rounded-full"
                    style={{ width: `${(offerStatus.claimed / offerStatus.cap) * 100}%` }}
                  />
                </div>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <div className="text-muted-foreground">Pending</div>
                    <div className="font-bold">{offerStatus.pending}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Delivered</div>
                    <div className="font-bold text-emerald-600">{offerStatus.delivered}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Remaining</div>
                    <div className="font-bold">{offerStatus.remaining}</div>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Outreach Funnel (all-time)</CardTitle>
          </CardHeader>
          <CardContent>
            {outreach && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm">Sent</span>
                  <span className="font-bold">{outreach.sent}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm">Replied</span>
                  <span className="font-bold">{outreach.replied}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm">Converted</span>
                  <span className="font-bold text-emerald-600">{outreach.converted}</span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Approval Patterns */}
      <Card>
        <CardHeader>
          <CardTitle>Approval Patterns (RULE-71: approve once per pattern, reuse forever)</CardTitle>
        </CardHeader>
        <CardContent>
          {patterns.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Megaphone className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p>No patterns yet.</p>
              <p className="text-xs mt-1">
                When the app plans outreach (WhatsApp blast, Instagram post, call), it requests a pattern approval.
                Approve once per (channel, category) and the app can reuse it for all matching sends.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {patterns.slice(0, 20).map((p) => (
                <div key={p.id} className="border rounded-lg p-3 hover:bg-muted/50">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge variant="outline" className="text-xs capitalize">{p.channel}</Badge>
                        <span className="font-medium text-sm">{p.patternName}</span>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Category: {p.category} · Used {p.usageCount}/{p.maxUsage} times
                      </div>
                      {p.approvedAt && (
                        <div className="text-xs text-muted-foreground mt-1">
                          Approved: {new Date(p.approvedAt).toLocaleDateString()}
                          {p.expiresAt && ` · Expires: ${new Date(p.expiresAt).toLocaleDateString()}`}
                        </div>
                      )}
                    </div>
                    {p.status === "approved" && <Badge className="bg-emerald-500"><CheckCircle2 className="h-3 w-3 mr-1" /> Approved</Badge>}
                    {p.status === "pending" && <Badge className="bg-amber-500"><Clock className="h-3 w-3 mr-1" /> Pending</Badge>}
                    {p.status === "rejected" && <Badge variant="destructive"><XCircle className="h-3 w-3 mr-1" /> Rejected</Badge>}
                    {p.status === "revoked" && <Badge variant="secondary">Revoked</Badge>}
                    {p.status === "expired" && <Badge variant="outline">Expired</Badge>}
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
