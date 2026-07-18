'use client';

import { useCallback, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  UploadCloud,
  File as FileIcon,
  X,
  Loader2,
  CheckCircle2,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import { useApi, deleteJson } from '@/lib/hooks/use-api';
import { JARVIS } from '@/lib/config';
import { useToast } from '@/hooks/use-toast';
import { Progress } from '@/components/ui/progress';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

type Scope = 'memory' | 'skill' | 'plugin' | 'knowledge' | 'learning';

interface UploadMeta {
  scope: Scope;
  originalName: string;
  mime: string;
  ext: string;
  title?: string;
  description?: string;
  path: string;
  url: string;
}

interface ArtifactRow {
  id: string;
  name: string;
  type: string;
  size: number;
  meta: string;
  createdAt: string;
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function metaOf(row: ArtifactRow): UploadMeta | null {
  try {
    return JSON.parse(row.meta) as UploadMeta;
  } catch {
    return null;
  }
}

export interface FileUploadProps {
  scope: Scope;
  onUploaded?: (artifact: ArtifactRow, meta: UploadMeta) => void;
  accept?: string;
  compact?: boolean;
}

export default function FileUpload({ scope, onUploaded, accept, compact }: FileUploadProps) {
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [lastUploaded, setLastUploaded] = useState<{ name: string; size: number } | null>(null);

  // Poll recent uploads for this scope — 5 items, 6s interval.
  const { data, refresh } = useApi<{ items: ArtifactRow[] }>(`/api/upload?scope=${scope}`, 6000);
  const recent = (data?.items ?? []).slice(0, 5);

  const onFiles = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      const file = files[0];
      if (file.size === 0) {
        toast({ title: 'Empty file', variant: 'destructive' });
        return;
      }
      if (file.size > 50 * 1024 * 1024) {
        toast({ title: 'File too large', description: '50MB max', variant: 'destructive' });
        return;
      }
      setBusy(true);
      setProgress(5);
      // Fake progress to give visual feedback — actual upload is single-shot.
      const fakeTimer = setInterval(() => {
        setProgress((p) => (p < 90 ? p + Math.max(1, Math.round((90 - p) / 6)) : p));
      }, 120);
      try {
        const form = new FormData();
        form.append('file', file);
        form.append('scope', scope);
        if (title) form.append('title', title);
        if (description) form.append('description', description);

        const res = await fetch('/api/upload', { method: 'POST', body: form });
        if (!res.ok) {
          const txt = await res.text().catch(() => '');
          throw new Error(`HTTP ${res.status}: ${txt}`);
        }
        const json = (await res.json()) as { artifact: ArtifactRow; meta: UploadMeta };
        setProgress(100);
        setLastUploaded({ name: file.name, size: file.size });
        toast({
          title: 'Upload complete',
          description: `${file.name} · ${fmtSize(file.size)} → ${scope}`,
        });
        onUploaded?.(json.artifact, json.meta);
        setTitle('');
        setDescription('');
        refresh();
      } catch (e) {
        toast({
          title: 'Upload failed',
          description: e instanceof Error ? e.message : '',
          variant: 'destructive',
        });
      } finally {
        clearInterval(fakeTimer);
        setBusy(false);
        setTimeout(() => setProgress(0), 800);
        if (inputRef.current) inputRef.current.value = '';
      }
    },
    [scope, title, description, toast, onUploaded, refresh],
  );

  const onDelete = async (id: string) => {
    try {
      await deleteJson(`/api/upload?id=${id}`);
      toast({ title: 'Upload deleted' });
      refresh();
    } catch (e) {
      toast({
        title: 'Delete failed',
        description: e instanceof Error ? e.message : '',
        variant: 'destructive',
      });
    }
  };

  const accentColor = JARVIS.colors.cyan;

  return (
    <div className={cn('space-y-3', compact ? '' : '')}>
      {/* Drop zone */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragEnter={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          void onFiles(e.dataTransfer.files);
        }}
        className={cn(
          'relative rounded-lg border-2 border-dashed transition-colors cursor-pointer outline-none',
          'border-[var(--j-border)] bg-[var(--j-panel-soft)] hover:border-[var(--j-cyan)] hover:bg-[var(--j-panel)]',
          dragOver && 'border-[var(--j-cyan)] bg-[var(--j-panel)]',
          compact ? 'p-4' : 'p-6',
        )}
        style={dragOver ? { borderColor: accentColor, boxShadow: `0 0 0 4px ${accentColor}1a` } : undefined}
        aria-label="Upload a file"
      >
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          accept={accept}
          onChange={(e) => void onFiles(e.target.files)}
        />
        <div className="flex flex-col items-center justify-center text-center pointer-events-none">
          <div
            className="flex h-10 w-10 items-center justify-center rounded-lg mb-2"
            style={{ background: `${accentColor}1a`, border: `1px solid ${accentColor}33`, color: accentColor }}
          >
            <UploadCloud className="h-5 w-5" />
          </div>
          <div className="text-xs font-medium text-[var(--j-text)]">
            Drop a file here, or click to browse
          </div>
          <div className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)] mt-1">
            scope={scope} · 50MB max · any file type
          </div>
        </div>
        <AnimatePresence>
          {busy && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="mt-3 px-3 pointer-events-none"
            >
              <div className="flex items-center gap-2 mb-1.5">
                <Loader2 className="h-3 w-3 animate-spin text-[var(--j-cyan)]" />
                <span className="jarvis-mono text-[10px] uppercase text-[var(--j-text-dim)]">
                  uploading… {progress}%
                </span>
              </div>
              <Progress value={progress} className="h-1.5 bg-[var(--j-border)]" />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Optional title / description (skip in compact mode) */}
      {!compact && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label htmlFor={`fu-title-${scope}`} className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)]">
              Title (optional)
            </Label>
            <Input
              id={`fu-title-${scope}`}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Q4 strategy notes"
              className="bg-[var(--j-panel-soft)] border-[var(--j-border)] text-[var(--j-text)] text-xs h-9"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`fu-desc-${scope}`} className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)]">
              Description (optional)
            </Label>
            <Input
              id={`fu-desc-${scope}`}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What's this file for?"
              className="bg-[var(--j-panel-soft)] border-[var(--j-border)] text-[var(--j-text)] text-xs h-9"
            />
          </div>
        </div>
      )}

      {/* Success toast inline */}
      <AnimatePresence>
        {lastUploaded && !busy && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className="flex items-center gap-2 text-[11px] text-[var(--j-green)] jarvis-mono uppercase"
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            <span>
              {lastUploaded.name} ({fmtSize(lastUploaded.size)})
            </span>
            <button
              onClick={() => setLastUploaded(null)}
              className="ml-auto text-[var(--j-text-mute)] hover:text-[var(--j-text)]"
              aria-label="Dismiss"
            >
              <X className="h-3 w-3" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Recent uploads (5 items, polled) */}
      <div>
        <div className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)] mb-1.5">
          Recent uploads ({recent.length})
        </div>
        {recent.length === 0 ? (
          <div className="text-[11px] text-[var(--j-text-mute)] italic px-1 py-2">
            No uploads yet for this scope.
          </div>
        ) : (
          <div className="space-y-1.5 max-h-64 overflow-y-auto jarvis-scroll pr-1">
            {recent.map((row) => {
              const m = metaOf(row);
              const Icon: LucideIcon = FileIcon;
              return (
                <div
                  key={row.id}
                  className="flex items-center gap-2 px-2 py-1.5 rounded-md border border-[var(--j-border-soft)] bg-[var(--j-panel)]"
                >
                  <div
                    className="flex h-7 w-7 items-center justify-center rounded shrink-0"
                    style={{ background: `${accentColor}1a`, border: `1px solid ${accentColor}33`, color: accentColor }}
                  >
                    <Icon className="h-3 w-3" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs text-[var(--j-text)] truncate">
                      {m?.title || m?.originalName || row.name}
                    </div>
                    <div className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)]">
                      {fmtSize(row.size)} · {m?.ext ?? '?'} · {new Date(row.createdAt).toLocaleString('en-US', { hour12: false })}
                    </div>
                  </div>
                  <button
                    onClick={() => onDelete(row.id)}
                    className="text-[var(--j-text-mute)] hover:text-[var(--j-red)] p-1"
                    aria-label="Delete upload"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
