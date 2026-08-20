"use client";

import { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Keyboard, X } from "lucide-react";

interface ShortcutEntry {
  keys: string[];
  description: string;
  category: string;
}

const SHORTCUTS: ShortcutEntry[] = [
  // Global
  { keys: ["⌘", "K"], description: "Open command palette", category: "Global" },
  { keys: ["?"], description: "Toggle this shortcuts help", category: "Global" },
  { keys: ["N"], description: "Inject a new task into the pipeline", category: "Global" },
  { keys: ["Esc"], description: "Close any open overlay / modal", category: "Global" },

  // Navigation
  { keys: ["1"], description: "Jump to Overview tab", category: "Navigation" },
  { keys: ["2"], description: "Jump to Operations tab", category: "Navigation" },
  { keys: ["3"], description: "Jump to Agents tab", category: "Navigation" },
  { keys: ["4"], description: "Jump to Comms tab", category: "Navigation" },
  { keys: ["5"], description: "Jump to Intelligence tab", category: "Navigation" },
  { keys: ["6"], description: "Jump to Finance tab", category: "Navigation" },
  { keys: ["7"], description: "Jump to System tab", category: "Navigation" },
  { keys: ["8"], description: "Jump to Training tab", category: "Navigation" },
  { keys: ["9"], description: "Jump to Advanced tab", category: "Navigation" },
  { keys: ["G", "A"], description: "Jump to Agent Fleet", category: "Navigation" },
  { keys: ["G", "D"], description: "Jump to Task Dependency Graph", category: "Navigation" },
  { keys: ["G", "T"], description: "Jump to Task Pipeline", category: "Navigation" },
  { keys: ["G", "F"], description: "Jump to Financial Operations", category: "Navigation" },
  { keys: ["G", "L"], description: "Jump to Live Log Stream", category: "Navigation" },
  { keys: ["G", "C"], description: "Jump to Agent Communication", category: "Navigation" },

  // Log stream
  { keys: ["/"], description: "Focus log filter (when in log stream)", category: "Logs" },
  { keys: ["Space"], description: "Pause / resume log auto-scroll", category: "Logs" },

  // Actions
  { keys: ["⌘", "↵"], description: "Submit task composer (when open)", category: "Actions" },
  { keys: ["A"], description: "Approve focused approval (in queue)", category: "Actions" },
  { keys: ["D"], description: "Deny focused approval (in queue)", category: "Actions" },
];

/**
 * KeyboardShortcutsHelp — `?`-key overlay listing all shortcuts.
 *
 * Renders a centered modal with grouped shortcuts. Opens on `?` (when not
 * typing), closes on Escape or click-outside. The shortcut list is the
 * single source of truth for operator ergonomics documentation.
 */
export function KeyboardShortcutsHelp() {
  const [open, setOpen] = useState(false);

  const toggle = useCallback(() => setOpen((v) => !v), []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "?" && !isTypingTarget(e.target)) {
        e.preventDefault();
        toggle();
      }
      if (e.key === "Escape" && open) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, toggle]);

  const categories = Array.from(new Set(SHORTCUTS.map((s) => s.category)));

  return (
    <>
      {/* Floating hint button — always visible, subtle */}
      <button
        onClick={toggle}
        className="fixed bottom-4 right-4 z-30 flex h-9 w-9 items-center justify-center rounded-full border border-border/60 bg-card/80 text-muted-foreground backdrop-blur transition-colors hover:border-primary/40 hover:text-primary"
        title="Keyboard shortcuts (?)"
        aria-label="Keyboard shortcuts"
      >
        <Keyboard className="h-4 w-4" />
      </button>

      <AnimatePresence>
        {open && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={() => setOpen(false)}
              className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
            />
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <motion.div
                initial={{ opacity: 0, scale: 0.96, y: 8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, y: 8 }}
                transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                className="mc-surface-elevated w-full max-w-lg overflow-hidden"
                role="dialog"
                aria-label="Keyboard shortcuts"
              >
                {/* Header */}
                <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className="flex h-7 w-7 items-center justify-center rounded-md border border-violet-500/40 bg-violet-500/10">
                      <Keyboard className="h-3.5 w-3.5 text-violet-300" />
                    </div>
                    <h2 className="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-foreground">
                      Keyboard Shortcuts
                    </h2>
                  </div>
                  <button
                    onClick={() => setOpen(false)}
                    className="flex h-7 w-7 items-center justify-center rounded-md border border-border/60 text-muted-foreground transition-colors hover:border-rose-500/40 hover:text-rose-300"
                    aria-label="Close"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                {/* Shortcut groups */}
                <div className="mc-scroll max-h-[60vh] overflow-y-auto p-4">
                  <div className="space-y-4">
                    {categories.map((cat) => (
                      <div key={cat}>
                        <div className="mb-2 font-mono text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
                          {cat}
                        </div>
                        <div className="space-y-1">
                          {SHORTCUTS.filter((s) => s.category === cat).map((s, i) => (
                            <div
                              key={`${cat}-${i}`}
                              className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 hover:bg-card/40"
                            >
                              <span className="text-xs text-foreground/80">{s.description}</span>
                              <div className="flex shrink-0 items-center gap-1">
                                {s.keys.map((key, j) => (
                                  <kbd
                                    key={j}
                                    className="rounded border border-border/60 bg-background/80 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-foreground shadow-[0_1px_0_0_oklch(1_0_0_/_0.05)_inset]"
                                  >
                                    {key}
                                  </kbd>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Footer */}
                <div className="border-t border-border/60 px-4 py-2.5 font-mono text-[9px] text-muted-foreground">
                  Press <kbd className="rounded border border-border/60 px-1 py-0.5">?</kbd> anytime to toggle this overlay
                </div>
              </motion.div>
            </div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}

function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  const tag = t.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || t.isContentEditable;
}
