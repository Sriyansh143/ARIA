"use client";

import { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import {
  KeyRound,
  Loader2,
  Plus,
  Trash2,
  Shield,
  Lock,
  Eye,
} from "lucide-react";
import { relTime } from "@/hooks/use-clock";

const CATEGORIES = ["llm", "payment", "crm", "email", "telephony", "custom"];

interface CredentialRow {
  id: string;
  key: string;
  label: string;
  category: string;
  metadata: { masked?: string; hint?: string; rotatedAt?: string; [k: string]: unknown };
  createdAt: string;
  updatedAt: string;
}

interface VaultResponse {
  credentials: CredentialRow[];
}

const CAT_TONE: Record<string, string> = {
  llm: "text-cyan-300 border-cyan-500/30 bg-cyan-500/5",
  payment: "text-emerald-300 border-emerald-500/30 bg-emerald-500/5",
  crm: "text-violet-300 border-violet-500/30 bg-violet-500/5",
  email: "text-amber-300 border-amber-500/30 bg-amber-500/5",
  telephony: "text-sky-300 border-sky-500/30 bg-sky-500/5",
  custom: "text-rose-300 border-rose-500/30 bg-rose-500/5",
};

export function CredentialVaultPanel() {
  const [creds, setCreds] = useState<CredentialRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [revealed, setRevealed] = useState<Record<string, string | null>>({});
  const [revealing, setRevealing] = useState<string | null>(null);

  // Form state
  const [formKey, setFormKey] = useState("");
  const [formLabel, setFormLabel] = useState("");
  const [formCategory, setFormCategory] = useState("llm");
  const [formPlaintext, setFormPlaintext] = useState("");
  const [saving, setSaving] = useState(false);

  const fetchCreds = useCallback(async () => {
    try {
      const res = await fetch("/api/credential-vault");
      if (!res.ok) throw new Error("fetch failed");
      const json = (await res.json()) as VaultResponse;
      setCreds(json.credentials ?? []);
    } catch {
      setCreds([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchCreds();
  }, [fetchCreds]);

  async function save() {
    if (!formKey.trim() || !formLabel.trim() || !formPlaintext.trim()) {
      toast.error("Key, label, and plaintext are required");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/credential-vault", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: formKey.trim(),
          label: formLabel.trim(),
          category: formCategory,
          plaintext: formPlaintext,
        }),
      });
      if (!res.ok) throw new Error("save failed");
      toast.success("Credential stored", {
        description: `${formKey} (encrypted at rest via AES-256-GCM)`,
      });
      setFormKey("");
      setFormLabel("");
      setFormPlaintext("");
      setShowForm(false);
      await fetchCreds();
    } catch {
      toast.error("Failed to store credential");
    } finally {
      setSaving(false);
    }
  }

  async function remove(key: string) {
    try {
      const res = await fetch(`/api/credential-vault/${encodeURIComponent(key)}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("delete failed");
      toast.success(`Credential "${key}" deleted`);
      await fetchCreds();
    } catch {
      toast.error("Failed to delete credential");
    }
  }

  async function reveal(key: string) {
    setRevealing(key);
    try {
      const res = await fetch(`/api/credential-vault/${encodeURIComponent(key)}`);
      if (!res.ok) throw new Error("reveal failed");
      const json = (await res.json()) as { plaintext?: string };
      setRevealed((prev) => ({ ...prev, [key]: json.plaintext ?? null }));
    } catch {
      toast.error("Failed to decrypt");
    } finally {
      setRevealing(null);
    }
  }

  return (
    <section className="mc-surface flex min-h-0 flex-col">
      <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
        <div className="flex items-center gap-2">
          <KeyRound className="h-4 w-4 text-amber-300" />
          <h2 className="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-foreground">
            Credential Vault
          </h2>
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="flex items-center gap-1 rounded border border-amber-500/30 bg-amber-500/5 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-amber-300 transition-colors hover:bg-amber-500/15"
        >
          <Plus className="h-2.5 w-2.5" />
          add credential
        </button>
      </div>

      <div className="mc-scroll max-h-96 flex-1 overflow-y-auto p-2.5">
        <AnimatePresence initial={false}>
          {showForm && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <div className="mb-3 rounded-md border border-amber-500/20 bg-amber-500/5 p-2.5">
                <div className="grid grid-cols-2 gap-2">
                  <input
                    value={formKey}
                    onChange={(e) => setFormKey(e.target.value)}
                    placeholder="key (e.g. openai_api_key)"
                    className="rounded border border-border/60 bg-background/60 px-2 py-1.5 font-mono text-[10px] text-foreground outline-none focus:border-amber-500/40"
                  />
                  <input
                    value={formLabel}
                    onChange={(e) => setFormLabel(e.target.value)}
                    placeholder="label (human-readable)"
                    className="rounded border border-border/60 bg-background/60 px-2 py-1.5 font-mono text-[10px] text-foreground outline-none focus:border-amber-500/40"
                  />
                </div>
                <select
                  value={formCategory}
                  onChange={(e) => setFormCategory(e.target.value)}
                  className="mt-2 w-full rounded border border-border/60 bg-background/60 px-2 py-1.5 font-mono text-[10px] text-foreground outline-none focus:border-amber-500/40"
                >
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
                <input
                  type="password"
                  value={formPlaintext}
                  onChange={(e) => setFormPlaintext(e.target.value)}
                  placeholder="plaintext secret"
                  className="mt-2 w-full rounded border border-border/60 bg-background/60 px-2 py-1.5 font-mono text-[10px] text-foreground outline-none focus:border-amber-500/40"
                />
                <button
                  onClick={() => void save()}
                  disabled={saving}
                  className="mt-2 flex items-center gap-1 rounded border border-emerald-500/30 bg-emerald-500/5 px-2 py-1 font-mono text-[9px] uppercase tracking-wider text-emerald-300 transition-colors hover:bg-emerald-500/15 disabled:opacity-50"
                >
                  {saving ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Shield className="h-2.5 w-2.5" />}
                  {saving ? "encrypting…" : "encrypt & store"}
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {loading ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-14 animate-pulse rounded bg-border/30" />
            ))}
          </div>
        ) : creds.length === 0 ? (
          <div className="flex h-24 flex-col items-center justify-center gap-1 font-mono text-xs text-muted-foreground">
            <Lock className="h-4 w-4 text-muted-foreground/50" />
            <span>vault is empty</span>
            <span className="text-[10px]">click "add credential" to store a secret</span>
          </div>
        ) : (
          <ul className="space-y-1.5">
            {creds.map((c) => {
              const revealedText = revealed[c.key];
              return (
                <motion.li
                  key={c.id}
                  layout
                  className="rounded-md border border-border/50 bg-card/50 p-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate font-mono text-xs font-medium text-foreground">
                          {c.label}
                        </span>
                        <span
                          className={`rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase ${
                            CAT_TONE[c.category] ?? CAT_TONE.custom
                          }`}
                        >
                          {c.category}
                        </span>
                      </div>
                      <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                        key: <span className="text-foreground/80">{c.key}</span> · {relTime(c.updatedAt)}
                      </div>
                      <div className="mt-1 flex items-center gap-1.5 font-mono text-[10px]">
                        <Lock className="h-2.5 w-2.5 text-muted-foreground" />
                        {revealedText !== undefined ? (
                          <span className="text-emerald-300">{revealedText ?? "(decryption failed)"}</span>
                        ) : (
                          <span className="text-muted-foreground">
                            {c.metadata.masked ?? "••••••••"}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col gap-1">
                      <button
                        onClick={() => void reveal(c.key)}
                        disabled={revealing === c.key}
                        className="flex items-center gap-1 rounded border border-border/60 px-1.5 py-0.5 font-mono text-[9px] uppercase text-muted-foreground transition-colors hover:border-cyan-500/40 hover:text-cyan-300 disabled:opacity-50"
                        title="Decrypt and reveal plaintext"
                      >
                        {revealing === c.key ? (
                          <Loader2 className="h-2.5 w-2.5 animate-spin" />
                        ) : (
                          <Eye className="h-2.5 w-2.5" />
                        )}
                      </button>
                      <button
                        onClick={() => void remove(c.key)}
                        className="flex items-center gap-1 rounded border border-border/60 px-1.5 py-0.5 font-mono text-[9px] uppercase text-muted-foreground transition-colors hover:border-rose-500/40 hover:text-rose-300"
                        title="Delete credential"
                      >
                        <Trash2 className="h-2.5 w-2.5" />
                      </button>
                    </div>
                  </div>
                </motion.li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
