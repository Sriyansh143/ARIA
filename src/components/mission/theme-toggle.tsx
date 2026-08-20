"use client";

import { useSyncExternalStore, useState } from "react";
import { useTheme } from "next-themes";
import { motion, AnimatePresence } from "framer-motion";
import { Sun, Moon } from "lucide-react";

/**
 * ThemeToggle — dark/light mode switcher.
 *
 * Uses next-themes to toggle between dark (default, mission-control)
 * and light modes. Renders a compact icon button with a smooth icon
 * crossfade. SSR-safe (uses useSyncExternalStore to detect mount without
 * a setState-in-effect).
 */

// Empty external store — purely to signal "client has mounted" via
// useSyncExternalStore (the correct React 19 idiom; avoids the
// setState-in-effect lint rule).
const subscribe = () => () => {};
function getSnapshot() {
  return true;
}
function getServerSnapshot() {
  return false;
}

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  // Track local toggle state for instant feedback before next-themes hydrates.
  const [localDark, setLocalDark] = useState(true);
  const isDark = mounted ? theme === "dark" : localDark;

  if (!mounted) {
    // Avoid hydration mismatch — render a placeholder.
    return (
      <div className="flex h-7 w-7 items-center justify-center rounded-md border border-border/60">
        <Sun className="h-3.5 w-3.5 text-muted-foreground" />
      </div>
    );
  }

  return (
    <button
      onClick={() => {
        const next = !isDark;
        setLocalDark(next);
        setTheme(next ? "dark" : "light");
      }}
      className="relative flex h-7 w-7 items-center justify-center rounded-md border border-border/60 bg-card/40 text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
      title={isDark ? "Switch to light mode" : "Switch to dark mode"}
      aria-label="Toggle theme"
    >
      <AnimatePresence mode="wait" initial={false}>
        {isDark ? (
          <motion.span
            key="moon"
            initial={{ opacity: 0, rotate: -90, scale: 0.5 }}
            animate={{ opacity: 1, rotate: 0, scale: 1 }}
            exit={{ opacity: 0, rotate: 90, scale: 0.5 }}
            transition={{ duration: 0.2 }}
          >
            <Moon className="h-3.5 w-3.5 text-cyan-300" />
          </motion.span>
        ) : (
          <motion.span
            key="sun"
            initial={{ opacity: 0, rotate: -90, scale: 0.5 }}
            animate={{ opacity: 1, rotate: 0, scale: 1 }}
            exit={{ opacity: 0, rotate: 90, scale: 0.5 }}
            transition={{ duration: 0.2 }}
          >
            <Sun className="h-3.5 w-3.5 text-amber-300" />
          </motion.span>
        )}
      </AnimatePresence>
    </button>
  );
}
