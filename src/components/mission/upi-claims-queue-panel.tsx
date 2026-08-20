"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Inbox, Check, X, Clock, RefreshCw, IndianRupee, User, Mail, Hash } from "lucide-react";
import { toast } from "sonner";

interface UpiClaim {
  id: string;
  serviceName: string;
  priceCents: number;
  upiAmountInr: number | null;
  upiUtr: string | null;
  customerEmail: string | null;
  customerName: string | null;
  createdAt: string;
  status: string;
}

export function UpiClaimsQueuePanel() {
  const [claims, setClaims] = useState<UpiClaim[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState<string>("");

  const fetchClaims = useCallback(async () => {
    try {
      const res = await fetch("/api/services/upi/pending", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setClaims(data.orders || []);
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchClaims();
    const interval = setInterval(() => void fetchClaims(), 30_000);
    return () => clearInterval(interval);
  }, [fetchClaims]);

  const handleApprove = useCallback(async (orderId: string) => {
    setProcessing(orderId);
    try {
      const res = await fetch("/api/services/upi/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        toast.success("Payment approved — build triggered. Customer will be notified.");
        void fetchClaims();
      } else {
        toast.error(data.error || "Failed to approve");
      }
    } catch {
      toast.error("Network error");
    } finally {
      setProcessing(null);
    }
  }, [fetchClaims]);

  const handleReject = useCallback(async (orderId: string) => {
    if (!rejectReason.trim()) {
      toast.error("Please provide a reason for rejection");
      return;
    }
    setRejecting(orderId);
    try {
      const res = await fetch("/api/services/upi/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId, action: "reject", reason: rejectReason.trim() }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        toast.success("Payment rejected — customer will be notified.");
        setRejectReason("");
        void fetchClaims();
      } else {
        toast.error(data.error || "Failed to reject");
      }
    } catch {
      toast.error("Network error");
    } finally {
      setRejecting(null);
    }
  }, [rejectReason, fetchClaims]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Inbox className="w-4 h-4 text-amber-300" />
          <span className="text-sm font-medium text-zinc-200">UPI Payment Claims</span>
          <span className="text-xs text-zinc-500">·</span>
          <span className="text-xs text-zinc-400">{claims.length} pending</span>
        </div>
        <button
          onClick={() => void fetchClaims()}
          className="text-xs text-zinc-500 hover:text-zinc-300 flex items-center gap-1"
        >
          <RefreshCw className="w-3 h-3" />
          Refresh
        </button>
      </div>

      {/* Claims list */}
      <div className="space-y-2">
        <AnimatePresence initial={false}>
          {loading ? (
            <div className="text-center py-12 text-zinc-500 text-sm">
              <RefreshCw className="w-4 h-4 animate-spin mx-auto mb-2" />
              Loading claims…
            </div>
          ) : claims.length === 0 ? (
            <div className="text-center py-12 text-zinc-500 text-sm border border-dashed border-zinc-800 rounded-lg">
              <Inbox className="w-8 h-8 mx-auto mb-2 opacity-30" />
              No pending UPI claims. When a customer submits a UTR, it will appear here.
            </div>
          ) : (
            claims.map((claim) => (
              <motion.div
                key={claim.id}
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, height: 0 }}
                className="border border-amber-500/20 bg-amber-500/5 rounded-lg p-3 space-y-2"
              >
                {/* Top row: service + amount */}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-zinc-100 truncate">{claim.serviceName}</div>
                    <div className="text-xs text-zinc-500 font-mono mt-0.5">#{claim.id.slice(-8)}</div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="flex items-center justify-end gap-0.5 text-amber-300 font-bold">
                      <IndianRupee className="w-3.5 h-3.5" />
                      {claim.upiAmountInr?.toFixed(2) ?? "?"}
                    </div>
                    <div className="text-[10px] text-zinc-500 mt-0.5">
                      (${(claim.priceCents / 100).toFixed(2)} USD)
                    </div>
                  </div>
                </div>

                {/* Details grid */}
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="flex items-center gap-1.5 text-zinc-400">
                    <Hash className="w-3 h-3 flex-shrink-0" />
                    <span className="font-mono truncate">{claim.upiUtr || "—"}</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-zinc-400">
                    <Clock className="w-3 h-3 flex-shrink-0" />
                    <span>{new Date(claim.createdAt).toLocaleString([], { dateStyle: "short", timeStyle: "short" })}</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-zinc-400 col-span-2">
                    <Mail className="w-3 h-3 flex-shrink-0" />
                    <span className="truncate">{claim.customerEmail || "—"}</span>
                  </div>
                  {claim.customerName && (
                    <div className="flex items-center gap-1.5 text-zinc-400 col-span-2">
                      <User className="w-3 h-3 flex-shrink-0" />
                      <span className="truncate">{claim.customerName}</span>
                    </div>
                  )}
                </div>

                {/* Action buttons */}
                <div className="flex gap-2 pt-1">
                  <button
                    onClick={() => void handleApprove(claim.id)}
                    disabled={processing === claim.id || rejecting === claim.id}
                    className="flex-1 px-3 py-1.5 text-xs rounded border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1"
                  >
                    <Check className="w-3.5 h-3.5" />
                    {processing === claim.id ? "Approving…" : "Approve & Build"}
                  </button>
                  <button
                    onClick={() => setRejecting(claim.id === rejecting ? null : claim.id)}
                    disabled={processing === claim.id}
                    className="px-3 py-1.5 text-xs rounded border border-rose-500/30 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20 disabled:opacity-50 flex items-center gap-1"
                  >
                    <X className="w-3.5 h-3.5" />
                    Reject
                  </button>
                </div>

                {/* Reject reason input (expanded) */}
                {rejecting === claim.id && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    className="space-y-2 pt-1"
                  >
                    <textarea
                      value={rejectReason}
                      onChange={(e) => setRejectReason(e.target.value)}
                      placeholder="Reason for rejection (e.g. 'UTR not found in UPI app', 'amount mismatch')"
                      rows={2}
                      className="w-full px-2 py-1 text-xs bg-zinc-900/50 border border-zinc-700 rounded focus:outline-none focus:border-rose-500/50 text-zinc-200 resize-none"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => void handleReject(claim.id)}
                        disabled={rejecting === claim.id && !rejectReason.trim()}
                        className="flex-1 px-3 py-1 text-xs rounded border border-rose-500/40 bg-rose-500/20 text-rose-200 hover:bg-rose-500/30 disabled:opacity-50"
                      >
                        Confirm Reject
                      </button>
                      <button
                        onClick={() => {
                          setRejecting(null);
                          setRejectReason("");
                        }}
                        className="px-3 py-1 text-xs rounded border border-zinc-700 text-zinc-400 hover:bg-zinc-800/50"
                      >
                        Cancel
                      </button>
                    </div>
                  </motion.div>
                )}
              </motion.div>
            ))
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
