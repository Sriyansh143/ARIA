"use client";

import { useEffect, useState, useCallback } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import {
  StickyNote,
  Loader2,
  Plus,
  Star,
  Trash2,
  X,
  Tag,
} from "lucide-react";
import { relTime } from "@/hooks/use-clock";

interface Note {
  id: string;
  title: string;
  body: string;
  tags: string;
  pinned: boolean;
  authorAgent: string | null;
  createdAt: string;
  updatedAt: string;
}

interface NotesListResponse {
  notes: Note[];
}

function parseTags(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw ?? "[]");
    return Array.isArray(parsed) ? parsed.slice(0, 6) : [];
  } catch {
    return [];
  }
}

export function NotesPanel() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  // Form
  const [formTitle, setFormTitle] = useState("");
  const [formBody, setFormBody] = useState("");
  const [formTags, setFormTags] = useState("");
  const [saving, setSaving] = useState(false);

  const fetchNotes = useCallback(async () => {
    try {
      const res = await fetch("/api/notes");
      if (!res.ok) throw new Error("fetch failed");
      const json = (await res.json()) as NotesListResponse;
      setNotes(json.notes ?? []);
    } catch {
      setNotes([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchNotes();
  }, [fetchNotes]);

  async function create() {
    if (!formTitle.trim()) {
      toast.error("Title is required");
      return;
    }
    setSaving(true);
    try {
      const tags = formTags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      const res = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: formTitle.trim(),
          body: formBody.trim(),
          tags,
        }),
      });
      if (!res.ok) throw new Error("create failed");
      toast.success("Note created");
      setFormTitle("");
      setFormBody("");
      setFormTags("");
      setShowForm(false);
      await fetchNotes();
    } catch {
      toast.error("Failed to create note");
    } finally {
      setSaving(false);
    }
  }

  async function togglePin(id: string, pinned: boolean) {
    try {
      await fetch(`/api/notes/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pinned: !pinned }),
      });
      await fetchNotes();
    } catch {
      toast.error("Failed to pin note");
    }
  }

  async function remove(id: string) {
    try {
      await fetch(`/api/notes/${id}`, { method: "DELETE" });
      toast.success("Note deleted");
      await fetchNotes();
    } catch {
      toast.error("Failed to delete note");
    }
  }

  return (
    <section className="mc-surface flex min-h-0 flex-col">
      <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
        <div className="flex items-center gap-2">
          <StickyNote className="h-4 w-4 text-amber-300" />
          <h2 className="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-foreground">
            Notes
          </h2>
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="flex items-center gap-1 rounded border border-amber-500/30 bg-amber-500/5 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-amber-300 transition-colors hover:bg-amber-500/15"
        >
          {showForm ? <X className="h-2.5 w-2.5" /> : <Plus className="h-2.5 w-2.5" />}
          {showForm ? "cancel" : "new note"}
        </button>
      </div>

      <div className="mc-scroll max-h-96 flex-1 overflow-y-auto p-2.5">
        {showForm && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            className="mb-3 overflow-hidden"
          >
            <div className="rounded-md border border-amber-500/20 bg-amber-500/5 p-2.5">
              <input
                value={formTitle}
                onChange={(e) => setFormTitle(e.target.value)}
                placeholder="title"
                className="w-full rounded border border-border/60 bg-background/60 px-2 py-1.5 font-mono text-[11px] text-foreground outline-none focus:border-amber-500/40"
              />
              <textarea
                value={formBody}
                onChange={(e) => setFormBody(e.target.value)}
                placeholder="body"
                rows={3}
                className="mt-2 w-full resize-none rounded border border-border/60 bg-background/60 px-2 py-1.5 font-mono text-[10px] text-foreground outline-none focus:border-amber-500/40"
              />
              <input
                value={formTags}
                onChange={(e) => setFormTags(e.target.value)}
                placeholder="tags (comma-separated)"
                className="mt-2 w-full rounded border border-border/60 bg-background/60 px-2 py-1.5 font-mono text-[10px] text-foreground outline-none focus:border-amber-500/40"
              />
              <button
                onClick={() => void create()}
                disabled={saving}
                className="mt-2 flex items-center gap-1 rounded border border-emerald-500/30 bg-emerald-500/5 px-2 py-1 font-mono text-[9px] uppercase tracking-wider text-emerald-300 transition-colors hover:bg-emerald-500/15 disabled:opacity-50"
              >
                {saving ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Plus className="h-2.5 w-2.5" />}
                {saving ? "saving…" : "save note"}
              </button>
            </div>
          </motion.div>
        )}

        {loading ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-16 animate-pulse rounded bg-border/30" />
            ))}
          </div>
        ) : notes.length === 0 ? (
          <div className="flex h-24 flex-col items-center justify-center gap-1 font-mono text-xs text-muted-foreground">
            <StickyNote className="h-4 w-4 text-muted-foreground/50" />
            <span>no notes yet</span>
          </div>
        ) : (
          <ul className="space-y-1.5">
            {notes.map((n) => {
              const tags = parseTags(n.tags);
              return (
                <motion.li
                  key={n.id}
                  layout
                  className={`rounded-md border p-2 ${
                    n.pinned
                      ? "border-amber-500/30 bg-amber-500/5"
                      : "border-border/50 bg-card/50"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => void togglePin(n.id, n.pinned)}
                          className="shrink-0"
                          title={n.pinned ? "Unpin" : "Pin"}
                        >
                          <Star
                            className={`h-3 w-3 ${
                              n.pinned
                                ? "fill-amber-300 text-amber-300"
                                : "text-muted-foreground hover:text-amber-300"
                            }`}
                          />
                        </button>
                        <span className="truncate font-mono text-xs font-medium text-foreground">
                          {n.title}
                        </span>
                      </div>
                      {n.body && (
                        <p className="mt-0.5 line-clamp-3 pl-4 font-mono text-[10px] text-muted-foreground">
                          {n.body}
                        </p>
                      )}
                      <div className="mt-1 flex flex-wrap items-center gap-1 pl-4">
                        {tags.map((t) => (
                          <span
                            key={t}
                            className="flex items-center gap-0.5 rounded border border-border/40 bg-background/40 px-1 py-0 font-mono text-[9px] text-muted-foreground"
                          >
                            <Tag className="h-2 w-2" />
                            {t}
                          </span>
                        ))}
                        <span className="ml-auto font-mono text-[9px] text-muted-foreground">
                          {relTime(n.updatedAt)}
                        </span>
                      </div>
                    </div>
                    <button
                      onClick={() => void remove(n.id)}
                      className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:text-rose-300"
                      title="Delete"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
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
