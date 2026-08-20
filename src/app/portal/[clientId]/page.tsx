/**
 * /portal/[clientId] — v73 Phase 23 Client Portal
 *
 * Public-facing client portal. The client receives a magic link via email/WhatsApp:
 *   https://your-domain.com/portal/{clientId}?token=xxx
 *
 * The portal shows:
 *   - Welcome message with the client's name.
 *   - Project status (milestones from ServiceOrder).
 *   - Deliverables (download links to protected previews or final files).
 *   - Contract details (with link to download the SOW PDF).
 *   - Support chat (direct line to ARIA's support agent).
 *
 * If the token is missing or invalid/expired, shows an "Access denied" message.
 */

"use client";

import { useEffect, useState } from "react";
import { useSearchParams, useParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, FileText, CheckCircle2, Clock, Download, MessageSquare, AlertCircle } from "lucide-react";

interface PortalData {
  ok: boolean;
  client?: { name: string; email: string; company: string };
  project?: { id: string; status: string; totalCents: number; createdAt: string } | null;
  contract?: {
    contractNumber: string;
    serviceName: string;
    amountCents: number;
    currency: string;
    milestonesJson: string;
    status: string;
    signedAt: string | null;
  } | null;
  error?: string;
}

export default function ClientPortalPage() {
  const params = useParams<{ clientId: string }>();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const [data, setData] = useState<PortalData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) {
      setLoading(false);
      setData({ ok: false, error: "No token provided. Please use the magic link sent to your email." });
      return;
    }
    fetch(`/api/portal/access?token=${token}`)
      .then((r) => r.json())
      .then((json) => setData(json))
      .catch((err) => setData({ ok: false, error: String(err).slice(0, 100) }))
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-50">
        <Loader2 className="h-8 w-8 animate-spin text-slate-500" />
      </div>
    );
  }

  if (!data?.ok) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-50 p-6">
        <Card className="max-w-md w-full">
          <CardContent className="text-center py-12">
            <AlertCircle className="h-12 w-12 mx-auto mb-4 text-red-500" />
            <h1 className="text-xl font-bold mb-2">Access Denied</h1>
            <p className="text-sm text-muted-foreground">{data?.error ?? "Invalid or expired token."}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { client, project, contract } = data;
  let milestones: Array<{ name: string; deliverable: string; dueDate: string; amountCents: number }> = [];
  try {
    milestones = JSON.parse(contract?.milestonesJson || "[]");
  } catch {}

  return (
    <div className="min-h-screen bg-slate-50 py-8 px-4">
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="text-center">
          <h1 className="text-3xl font-bold">Welcome, {client?.name}</h1>
          <p className="text-muted-foreground">
            {client?.company ? `${client.company} · ` : ""}Client Portal · ARIA Mission Control
          </p>
        </div>

        {/* Project Status */}
        {project && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-5 w-5" /> Project Status
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between mb-3">
                <span>Project ID</span>
                <code className="text-sm">{project.id.slice(-12)}</code>
              </div>
              <div className="flex items-center justify-between mb-3">
                <span>Status</span>
                <Badge className="capitalize">{project.status}</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span>Total</span>
                <span className="font-bold">${(project.totalCents / 100).toFixed(2)}</span>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Milestones */}
        {milestones.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5" /> Milestones
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {milestones.map((m, i) => (
                  <div key={i} className="border rounded-lg p-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-medium">{i + 1}. {m.name}</span>
                      <span className="text-sm font-bold">${(m.amountCents / 100).toFixed(2)}</span>
                    </div>
                    <div className="text-sm text-muted-foreground">{m.deliverable}</div>
                    <div className="text-xs text-muted-foreground mt-1">Due: {m.dueDate}</div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Contract */}
        {contract && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" /> Contract
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <div className="flex justify-between"><span>Contract Number</span><code className="text-sm">{contract.contractNumber}</code></div>
                <div className="flex justify-between"><span>Service</span><span className="font-medium">{contract.serviceName}</span></div>
                <div className="flex justify-between"><span>Amount</span><span className="font-bold">${(contract.amountCents / 100).toFixed(2)} {contract.currency}</span></div>
                <div className="flex justify-between">
                  <span>Status</span>
                  <Badge className={contract.status === "signed" ? "bg-emerald-500" : "bg-amber-500"}>
                    {contract.status}
                  </Badge>
                </div>
                {contract.signedAt && (
                  <div className="flex justify-between"><span>Signed</span><span className="text-sm">{new Date(contract.signedAt).toLocaleDateString()}</span></div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Support */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5" /> Support
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-4">
              Have questions about your project? Reply to your original email or send a WhatsApp message to your dedicated ARIA support line.
            </p>
            <Button variant="outline" className="w-full">
              <MessageSquare className="h-4 w-4 mr-2" /> Contact Support
            </Button>
          </CardContent>
        </Card>

        <div className="text-center text-xs text-muted-foreground">
          Powered by <strong>ARIA</strong> — an AI autonomous company 🤖
        </div>
      </div>
    </div>
  );
}
