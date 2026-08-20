"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ShieldOff, Plus, Trash2, MailX, AlertCircle, RefreshCw } from "lucide-react";
import { toast } from "sonner";

interface SuppressionData {
  emails: string[];
  count: number;
  blockedToday: {
    suppression: number;
    dailyLimit: number;
    total: number;
  };
}

export function SuppressionManagerPanel() {
  const [data, setData] = useState<SuppressionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [newEmail, setNewEmail] = useState("");
  const [adding, setAdding] = useState(false);

  const fetchSuppression = useCallback(async () => {
    try {
      const res = await fetch("/api/outreach/suppression", { cache: "no-store" });
      if (res.ok) {
        const d = await res.json();
        setData(d);
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchSuppression();
    // Refresh every 30s to update blocked-today counters
    const interval = setInterval(() => void fetchSuppression(), 30_000);
    return () => clearInterval(interval);
  }, [fetchSuppression]);

  const handleAdd = useCallback(async () => {
    if (!newEmail.trim()) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail.trim())) {
      toast.error("Invalid email format");
      return;
    }
    setAdding(true);
    try {
      const res = await fetch("/api/outreach/suppression", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: newEmail.trim() }),
      });
      if (res.ok) {
        toast.success(`Added ${newEmail.trim()} to suppression list`);
        setNewEmail("");
        void fetchSuppression();
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || "Failed to add");
      }
    } catch {
      toast.error("Network error");
    } finally {
      setAdding(false);
    }
  }, [newEmail, fetchSuppression]);

  const handleRemove = useCallback(async (email: string) => {
    try {
      const res = await fetch("/api/outreach/suppression", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (res.ok) {
        toast.success(`Removed ${email} from suppression list`);
        void fetchSuppression();
      } else {
        toast.error("Failed to remove");
      }
    } catch {
      toast.error("Network error");
    }
  }, [fetchSuppression]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-zinc-500 text-sm">
        <RefreshCw className="w-4 h-4 animate-spin mr-2" />
        Loading suppression list…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-3 gap-2">
        <div className="border border-zinc-800 rounded-lg p-3 bg-zinc-900/30">
          <div className="text-2xl font-bold text-rose-300">{data?.count ?? 0}</div>
          <div className="text-xs text-zinc-500 mt-1">Suppressed Emails</div>
        </div>
        <div className="border border-zinc-800 rounded-lg p-3 bg-zinc-900/30">
          <div className="text-2xl font-bold text-amber-300">{data?.blockedToday?.suppression ?? 0}</div>
          <div className="text-xs text-zinc-500 mt-1">Blocked Today (opt-out)</div>
        </div>
        <div className="border border-zinc-800 rounded-lg p-3 bg-zinc-900/30">
          <div className="text-2xl font-bold text-zinc-300">{data?.blockedToday?.dailyLimit ?? 0}</div>
          <div className="text-xs text-zinc-500 mt-1">Blocked Today (limit)</div>
        </div>
      </div>

      {/* Add form */}
      <div className="flex gap-2">
        <input
          type="email"
          value={newEmail}
          onChange={(e) => setNewEmail(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void handleAdd()}
          placeholder="email@example.com"
          className="flex-1 px-3 py-1.5 text-sm bg-zinc-900/50 border border-zinc-700 rounded focus:outline-none focus:border-emerald-500/50 text-zinc-200"
          disabled={adding}
        />
        <button
          onClick={() => void handleAdd()}
          disabled={adding || !newEmail.trim()}
          className="px-3 py-1.5 text-sm rounded border border-rose-500/30 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
        >
          <Plus className="w-3.5 h-3.5" />
          Suppress
        </button>
      </div>

      {/* List */}
      <div className="border border-zinc-800 rounded-lg overflow-hidden">
        <div className="px-3 py-2 border-b border-zinc-800 bg-zinc-900/50 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldOff className="w-4 h-4 text-rose-400" />
            <span className="text-sm font-medium text-zinc-200">Suppression List</span>
          </div>
          <button
            onClick={() => void fetchSuppression()}
            className="text-xs text-zinc-500 hover:text-zinc-300"
          >
            <RefreshCw className="w-3 h-3" />
          </button>
        </div>

        <div className="max-h-[400px] overflow-y-auto">
          {data?.emails.length === 0 ? (
            <div className="px-3 py-8 text-center text-zinc-500 text-sm">
              <MailX className="w-8 h-8 mx-auto mb-2 opacity-30" />
              No suppressed emails. Leads who reply "Not-Interested" or "Bounce" will appear here automatically.
            </div>
          ) : (
            <AnimatePresence initial={false}>
              {data?.emails.map((email) => (
                <motion.div
                  key={email}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0, height: 0 }}
                  className="flex items-center justify-between px-3 py-2 border-b border-zinc-800/50 hover:bg-zinc-800/30"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <MailX className="w-3.5 h-3.5 text-zinc-500 flex-shrink-0" />
                    <span className="text-sm text-zinc-300 font-mono truncate">{email}</span>
                  </div>
                  <button
                    onClick={() => void handleRemove(email)}
                    className="text-zinc-500 hover:text-rose-400 flex-shrink-0 ml-2"
                    title="Remove from suppression list"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </motion.div>
              ))}
            </AnimatePresence>
          )}
        </div>
      </div>

      <div className="flex items-start gap-2 text-xs text-zinc-500">
        <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
        <div>
          Emails in this list will never receive outreach. Leads are added automatically when they reply
          "Not-Interested" or "Bounce", or when they click the unsubscribe link in an outreach email.
          You can also manually add emails above.
        </div>
      </div>
    </div>
  );
}
