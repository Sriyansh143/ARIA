'use client';

import { useState, ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';

/**
 * MergedTab — a wrapper that combines multiple related tab components into
 * a single tab with a sub-view toggle. This reduces sidebar clutter by
 * merging similar tabs (e.g. Tasks + Kanban + DAG → one "Tasks" tab).
 *
 * Usage:
 * <MergedTab
 *   views={[
 *     { key: 'list', label: 'List', component: <TasksTab /> },
 *     { key: 'kanban', label: 'Kanban', component: <KanbanTab /> },
 *   ]}
 * />
 */

export interface MergedTabView {
  key: string;
  label: string;
  icon?: ReactNode;
  component: ReactNode;
}

export function MergedTab({
  views,
  defaultView,
  accent = 'var(--j-cyan)',
}: {
  views: MergedTabView[];
  defaultView?: string;
  accent?: string;
}) {
  const [active, setActive] = useState(defaultView ?? views[0]?.key ?? '');

  return (
    <div className="space-y-4">
      {/* Sub-view toggle */}
      <div className="flex items-center gap-1 p-1 rounded-lg border border-[var(--j-border)] bg-[var(--j-panel-soft)]/50 w-fit">
        {views.map((v) => {
          const isActive = active === v.key;
          return (
            <button
              key={v.key}
              onClick={() => setActive(v.key)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs jarvis-mono uppercase tracking-wide transition-all',
                isActive
                  ? 'text-white shadow-sm'
                  : 'text-[var(--j-text-mute)] hover:text-[var(--j-text)]',
              )}
              style={isActive ? { background: accent } : undefined}
            >
              {v.icon}
              {v.label}
            </button>
          );
        })}
      </div>

      {/* Active sub-view */}
      <AnimatePresence mode="wait">
        <motion.div
          key={active}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.15 }}
        >
          {views.find((v) => v.key === active)?.component}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
