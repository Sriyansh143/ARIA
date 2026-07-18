'use client';

/**
 * SettingsDialog.tsx — IDE settings dialog.
 * Controls: fontSize, tabSize, wordWrap, minimap, autoSave, formatOnSave, linting, theme.
 */

import { Settings, X } from 'lucide-react';
import { JARVIS } from '@/lib/config';
import { cn } from '@/lib/utils';

export interface IdeSettings {
  theme: string;
  fontSize: number;
  tabSize: number;
  wordWrap: boolean;
  minimap: boolean;
  autoSave: boolean;
  formatOnSave: boolean;
  linting: boolean;
}

interface Props {
  settings: IdeSettings;
  onChange: (next: IdeSettings) => void;
  onClose: () => void;
}

export default function SettingsDialog({ settings, onChange, onClose }: Props) {
  const set = <K extends keyof IdeSettings>(k: K, v: IdeSettings[K]) => onChange({ ...settings, [k]: v });

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center px-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-[480px] rounded-lg border border-[var(--j-border)] bg-[var(--j-panel)] shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--j-border)]">
          <Settings className="h-4 w-4 text-[var(--j-cyan)]" />
          <span className="jarvis-mono text-xs uppercase text-[var(--j-text)]">IDE Settings</span>
          <button onClick={onClose} className="ml-auto p-1 rounded hover:bg-[var(--j-panel-soft)] text-[var(--j-text-mute)]">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="p-4 space-y-4">
          {/* Font size */}
          <Row label="Font Size">
            <div className="flex items-center gap-2">
              <button
                onClick={() => set('fontSize', Math.max(10, settings.fontSize - 1))}
                className="h-6 w-6 rounded border border-[var(--j-border)] text-[var(--j-text)] hover:bg-[var(--j-panel-soft)]"
              >-</button>
              <span className="jarvis-mono text-xs text-[var(--j-text)] w-8 text-center">{settings.fontSize}px</span>
              <button
                onClick={() => set('fontSize', Math.min(24, settings.fontSize + 1))}
                className="h-6 w-6 rounded border border-[var(--j-border)] text-[var(--j-text)] hover:bg-[var(--j-panel-soft)]"
              >+</button>
            </div>
          </Row>

          {/* Tab size */}
          <Row label="Tab Size">
            <div className="flex items-center gap-1">
              {[2, 4, 8].map((n) => (
                <button
                  key={n}
                  onClick={() => set('tabSize', n)}
                  className={cn(
                    'jarvis-mono text-[10px] px-2 py-1 rounded border',
                    settings.tabSize === n
                      ? 'border-[var(--j-cyan)] text-[var(--j-cyan)] bg-[var(--j-cyan)]/10'
                      : 'border-[var(--j-border)] text-[var(--j-text-mute)] hover:bg-[var(--j-panel-soft)]',
                  )}
                >
                  {n}
                </button>
              ))}
            </div>
          </Row>

          {/* Theme */}
          <Row label="Theme">
            <div className="flex items-center gap-1">
              {[
                { v: 'jarvis-dark', l: 'Jarvis Dark' },
                { v: 'light', l: 'Light' },
              ].map((opt) => (
                <button
                  key={opt.v}
                  onClick={() => set('theme', opt.v)}
                  className={cn(
                    'jarvis-mono text-[10px] px-2 py-1 rounded border',
                    settings.theme === opt.v
                      ? 'border-[var(--j-cyan)] text-[var(--j-cyan)] bg-[var(--j-cyan)]/10'
                      : 'border-[var(--j-border)] text-[var(--j-text-mute)] hover:bg-[var(--j-panel-soft)]',
                  )}
                >
                  {opt.l}
                </button>
              ))}
            </div>
          </Row>

          {/* Toggles */}
          <Toggle label="Word Wrap" checked={settings.wordWrap} onChange={(v) => set('wordWrap', v)} />
          <Toggle label="Minimap" checked={settings.minimap} onChange={(v) => set('minimap', v)} />
          <Toggle label="Auto Save (30s)" checked={settings.autoSave} onChange={(v) => set('autoSave', v)} />
          <Toggle label="Format On Save" checked={settings.formatOnSave} onChange={(v) => set('formatOnSave', v)} />
          <Toggle label="Linting (tsc/eslint)" checked={settings.linting} onChange={(v) => set('linting', v)} />
        </div>
        <div className="px-4 py-2 border-t border-[var(--j-border)] flex items-center justify-between">
          <span className="text-[10px] jarvis-mono text-[var(--j-text-mute)]">Settings persist on the active project.</span>
          <button
            onClick={onClose}
            className="jarvis-mono text-[10px] uppercase px-3 py-1.5 rounded border"
            style={{ borderColor: `${JARVIS.colors.cyan}40`, color: JARVIS.colors.cyan, background: `${JARVIS.colors.cyan}10` }}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-[var(--j-text)]">{label}</span>
      {children}
    </div>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-[var(--j-text)]">{label}</span>
      <button
        onClick={() => onChange(!checked)}
        className={cn(
          'relative h-5 w-9 rounded-full transition-colors',
          checked ? 'bg-[var(--j-cyan)]/40' : 'bg-[var(--j-panel-soft)]',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 h-4 w-4 rounded-full transition-transform',
            checked ? 'translate-x-4 bg-[var(--j-cyan)]' : 'translate-x-0.5 bg-[var(--j-text-mute)]',
          )}
        />
      </button>
    </div>
  );
}
