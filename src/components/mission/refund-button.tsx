"use client";

/**
 * RefundButton — triggers /api/services/refund with a confirmation modal.
 *
 * Usage: <RefundButton orderId="abc123" orderName="Landing Page" onRefunded={() => refetch()} />
 */

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { RotateCcw, Loader2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

interface RefundButtonProps {
  orderId: string;
  orderName?: string;
  onRefunded?: () => void;
  variant?: "outline" | "ghost" | "destructive";
  size?: "sm" | "default";
}

export function RefundButton({
  orderId,
  orderName,
  onRefunded,
  variant = "outline",
  size = "sm",
}: RefundButtonProps) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);

  const handleRefund = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/services/refund", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId,
          reason: reason.trim() || "Refund processed by owner",
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Refund failed");
      }

      const data = await res.json();
      toast.success(`Refund processed for ${orderName || orderId}`, {
        description: "Download access revoked. Customer notified.",
      });
      setOpen(false);
      setReason("");
      onRefunded?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Refund failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button
          variant={variant}
          size={size}
          className="border-rose-500/30 text-rose-300 hover:bg-rose-500/10"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Refund
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-400" />
            Process Refund?
          </AlertDialogTitle>
          <AlertDialogDescription>
            This will mark order <strong>{orderName || orderId}</strong> as refunded,
            revoke the customer&apos;s download access (delete deliverable files),
            and send a &quot;Refund Processed&quot; email to the customer.
            This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="py-2">
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
            Reason (optional)
          </label>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Customer not satisfied with deliverable"
            className="text-sm"
            rows={3}
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={loading}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              void handleRefund();
            }}
            disabled={loading}
            className="bg-rose-600 hover:bg-rose-700 text-white"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 mr-1 animate-spin" /> Processing…
              </>
            ) : (
              <>
                <RotateCcw className="h-4 w-4 mr-1" /> Confirm Refund
              </>
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
