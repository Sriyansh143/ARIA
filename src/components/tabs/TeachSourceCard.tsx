'use client';

import {
  Plus,
  X,
  Sparkles,
  TrendingUp,
  Type,
  Link2,
  Video,
  FileText,
  Mic,
  Archive,
  Upload,
  Trash2,
  Wand2,
  Loader2,
  Square,
} from 'lucide-react';
import { useCallback, useMemo, useRef, useState } from 'react';
import { postJson } from '@/lib/hooks/use-api';
import { JARVIS } from '@/lib/config';
import { useToast } from '@/hooks/use-toast';
import { motion } from 'framer-motion';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  autoCategorize,
  type TargetSection,
  TARGET_SECTIONS,
  TARGET_SECTION_LABELS,
} from '@/lib/categorize';

type TeachMode = 'text' | 'url' | 'video' | 'document' | 'audio' | 'zip';

interface ModeDef {
  id: TeachMode;
  label: string;
  icon: typeof Type;
  hint: string;
}

const MODES: ModeDef[] = [
  { id: 'text', label: 'Text', icon: Type, hint: 'Paste any text — notes, snippets, transcripts' },
  { id: 'url', label: 'URL', icon: Link2, hint: 'Fetch & ingest a web page (URL)' },
  { id: 'video', label: 'Video', icon: Video, hint: 'YouTube / Vimeo URL — transcription via video-understand skill' },
  { id: 'document', label: 'Document', icon: FileText, hint: 'PDF / DOCX / TXT / MD / CSV / JSON — multiple files' },
  { id: 'audio', label: 'Audio', icon: Mic, hint: 'Record speech — transcribed live via Web Speech API' },
  { id: 'zip', label: 'Zip', icon: Archive, hint: 'Bulk upload a .zip archive (routed to /api/upload)' },
];

const DOC_ACCEPT = '.pdf,.docx,.txt,.md,.csv,.json,text/plain,text/markdown,text/csv,application/json,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const SECTION_COLORS: Record<TargetSection, string> = {
  skill: JARVIS.colors.cyan,
  plugin: JARVIS.colors.violet,
  memory: JARVIS.colors.amber,
  knowledge: JARVIS.colors.green,
  intelligence: JARVIS.colors.red,
  learning: JARVIS.colors.cyanDim,
};

interface PendingFile {
  name: string;
  size: number;
  type: string;
  text?: string;        // extracted text (for txt/md/csv/json)
  pending?: boolean;    // true for PDF/DOCX where extraction is deferred
  error?: string;
}

// ---- Web Speech API typing shim ----
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: {
    length: number;
    [i: number]: {
      isFinal: boolean;
      0: { transcript: string };
    };
  };
}
interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}
function getSpeechRecognition(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

async function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsText(file);
  });
}

/**
 * TeachSourceCard — multi-mode teach panel. Supports Text / URL / Video /
 * Document / Audio / Zip. Each mode lets the operator pick the target
 * section (skill / plugin / memory / knowledge / intelligence / learning)
 * — defaults to "learning" which means auto-categorize on ingest.
 */
export default function TeachSourceCard({ onTaught }: { onTaught?: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<TeachMode>('text');
  const [agent, setAgent] = useState('ORION');
  const [skill, setSkill] = useState('');
  const [section, setSection] = useState<TargetSection | 'auto'>('auto');
  const [busy, setBusy] = useState(false);

  // Text / URL / Video inputs
  const [text, setText] = useState('');
  const [url, setUrl] = useState('');
  const [videoUrl, setVideoUrl] = useState('');

  // Document / Zip files
  const [files, setFiles] = useState<PendingFile[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Audio recording
  const [transcript, setTranscript] = useState('');
  const [recording, setRecording] = useState(false);
  const [interim, setInterim] = useState('');
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  // ---- live preview of suggested section for current input ----
  const previewContent = useMemo(() => {
    if (mode === 'text') return text;
    if (mode === 'url') return url;
    if (mode === 'video') return videoUrl;
    if (mode === 'audio') return transcript;
    if (mode === 'document' || mode === 'zip') {
      return files.map((f) => f.text ?? f.name).join('\n\n');
    }
    return '';
  }, [mode, text, url, videoUrl, transcript, files]);

  const suggestion = useMemo(() => autoCategorize(previewContent), [previewContent]);
  const effectiveSection: TargetSection =
    section === 'auto' ? suggestion.suggestedSection : section;

  const resetInputs = useCallback(() => {
    setText('');
    setUrl('');
    setVideoUrl('');
    setFiles([]);
    setTranscript('');
    setInterim('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  const handleModeChange = (m: TeachMode) => {
    setMode(m);
    resetInputs();
  };

  // ---- file handling ----
  const handleFilesPicked = useCallback(async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const picked: PendingFile[] = [];
    for (let i = 0; i < fileList.length; i++) {
      const f = fileList[i];
      const entry: PendingFile = { name: f.name, size: f.size, type: f.type };
      // Inline-extract text for plain-text formats; defer PDF/DOCX to backend.
      const lower = f.name.toLowerCase();
      const isText =
        lower.endsWith('.txt') ||
        lower.endsWith('.md') ||
        lower.endsWith('.csv') ||
        lower.endsWith('.json') ||
        f.type.startsWith('text/') ||
        f.type === 'application/json' ||
        f.type === 'text/csv';
      if (isText) {
        try {
          entry.text = await readFileAsText(f);
        } catch {
          entry.error = 'read failed';
        }
      } else if (
        lower.endsWith('.pdf') ||
        lower.endsWith('.docx') ||
        f.type === 'application/pdf' ||
        f.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      ) {
        entry.pending = true; // content extraction pending — backend note
      } else {
        entry.error = 'unsupported';
      }
      picked.push(entry);
    }
    setFiles((prev) => [...prev, ...picked]);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      if (mode !== 'document' && mode !== 'zip') return;
      handleFilesPicked(e.dataTransfer.files);
    },
    [mode, handleFilesPicked],
  );

  const removeFile = (idx: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  // ---- audio recording ----
  const startRecording = () => {
    const Rec = getSpeechRecognition();
    if (!Rec) {
      toast({
        title: 'Speech recognition unavailable',
        description: 'Use Chrome / Edge. webkitSpeechRecognition not found.',
        variant: 'destructive',
      });
      return;
    }
    const rec = new Rec();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = 'en-US';
    rec.onresult = (e) => {
      let finalText = '';
      let interimText = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else interimText += r[0].transcript;
      }
      if (finalText) setTranscript((prev) => (prev + ' ' + finalText).trim());
      setInterim(interimText);
    };
    rec.onerror = (e) => {
      toast({
        title: 'Recording error',
        description: e.error || 'unknown',
        variant: 'destructive',
      });
      setRecording(false);
    };
    rec.onend = () => {
      setRecording(false);
      setInterim('');
    };
    rec.start();
    recognitionRef.current = rec;
    setRecording(true);
  };

  const stopRecording = () => {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setRecording(false);
  };

  // ---- submit ----
  const submit = async () => {
    if (busy) return;
    setBusy(true);

    try {
      const targetSection = section === 'auto' ? undefined : section;
      const common = {
        agentCodename: agent || undefined,
        skillKey: skill || undefined,
        targetSection,
      };

      if (mode === 'text') {
        if (!text.trim()) throw new Error('text is empty');
        const r = await postJson('/api/learning/teach', { type: 'text', content: text, ...common });
        toast({
          title: `Ingested → ${r.targetSection ?? 'learning'}`,
          description: `${r.chunksStored} chunk(s) · suggested ${r.suggestedSection}`,
        });
      } else if (mode === 'url') {
        if (!url.trim()) throw new Error('URL is empty');
        // Lightweight: store the URL itself. A full fetch+extract can be
        // added later by a separate /api/learning/fetch route.
        const r = await postJson('/api/learning/teach', {
          type: 'url',
          content: url,
          ...common,
          meta: { url, fetchedAt: new Date().toISOString() },
        });
        toast({
          title: `URL ingested → ${r.targetSection ?? 'learning'}`,
          description: `${r.chunksStored} chunk(s)`,
        });
      } else if (mode === 'video') {
        if (!videoUrl.trim()) throw new Error('video URL is empty');
        const r = await postJson('/api/learning/teach', {
          type: 'video',
          content: videoUrl,
          ...common,
          meta: {
            url: videoUrl,
            transcriptionPending: true,
            note: 'Video understanding uses the video-understand skill (out-of-band).',
          },
        });
        toast({
          title: `Video queued → ${r.targetSection ?? 'learning'}`,
          description: 'Transcription pending — video-understand skill will process it.',
        });
      } else if (mode === 'document') {
        if (files.length === 0) throw new Error('pick at least one file');
        let totalChunks = 0;
        let targetSectionUsed: string | undefined;
        for (const f of files) {
          if (f.error === 'unsupported') continue;
          const content =
            f.text ??
            `[document:${f.name} · ${f.size} bytes · content extraction pending]`;
          const r = await postJson('/api/learning/teach', {
            type: 'document',
            content,
            ...common,
            meta: {
              filename: f.name,
              mime: f.type,
              size: f.size,
              extractionPending: Boolean(f.pending),
            },
          });
          totalChunks += r.chunksStored ?? 0;
          targetSectionUsed = r.targetSection ?? targetSectionUsed;
        }
        toast({
          title: `Documents ingested → ${targetSectionUsed ?? 'learning'}`,
          description: `${files.length} file(s) · ${totalChunks} chunk(s)`,
        });
      } else if (mode === 'audio') {
        if (!transcript.trim()) throw new Error('transcript is empty — record something first');
        const r = await postJson('/api/learning/teach', {
          type: 'audio',
          content: transcript,
          ...common,
          meta: {
            transcribedVia: 'webkitSpeechRecognition',
            durationSec: null,
          },
        });
        toast({
          title: `Transcript ingested → ${r.targetSection ?? 'learning'}`,
          description: `${r.chunksStored} chunk(s)`,
        });
      } else if (mode === 'zip') {
        // Redirect to /api/upload?scope=learning
        toast({
          title: 'Zip upload',
          description: 'Use /api/upload?scope=learning — multi-file zip ingestion is routed there.',
        });
      }

      resetInputs();
      setOpen(false);
      onTaught?.();
    } catch (e) {
      toast({
        title: 'Teach failed',
        description: e instanceof Error ? e.message : '',
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
    }
  };

  const accent = SECTION_COLORS[effectiveSection];

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="jarvis-panel p-4 relative overflow-hidden"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div
            className="flex h-8 w-8 items-center justify-center rounded-md"
            style={{
              background: `${JARVIS.colors.cyan}1a`,
              border: `1px solid ${JARVIS.colors.cyan}33`,
              color: JARVIS.colors.cyan,
            }}
          >
            <Sparkles className="h-4 w-4" />
          </div>
          <div>
            <div className="jarvis-mono text-xs uppercase tracking-widest text-[var(--j-text)]">
              Teach an Agent
            </div>
            <div className="text-[11px] text-[var(--j-text-dim)]">
              Text · URL · Video · Document · Audio · Zip
            </div>
          </div>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="jarvis-btn-accent border-0"
          onClick={() => setOpen((v) => !v)}
        >
          <Plus className="h-3.5 w-3.5 mr-1" /> Teach
        </Button>
      </div>

      {open && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          className="mt-4 pt-4 border-t border-[var(--j-border-soft)] space-y-4"
        >
          {/* Mode selector — 6 toggles */}
          <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
            {MODES.map((m) => {
              const active = mode === m.id;
              const Icon = m.icon;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => handleModeChange(m.id)}
                  className={`flex flex-col items-center gap-1 p-2 rounded-md border transition-all ${
                    active
                      ? 'border-[var(--j-cyan)] bg-[var(--j-cyan)]10'
                      : 'border-[var(--j-border-soft)] bg-[var(--j-panel-soft)] hover:border-[var(--j-cyan)]55'
                  }`}
                  style={active ? { boxShadow: `0 0 0 1px ${JARVIS.colors.cyan}33` } : undefined}
                  aria-pressed={active}
                  title={m.hint}
                >
                  <Icon
                    className="h-4 w-4"
                    style={{ color: active ? JARVIS.colors.cyan : JARVIS.colors.textDim }}
                  />
                  <span
                    className="jarvis-mono text-[10px] uppercase tracking-wider"
                    style={{ color: active ? JARVIS.colors.cyan : JARVIS.colors.textDim }}
                  >
                    {m.label}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="text-[11px] text-[var(--j-text-mute)] -mt-2">
            {MODES.find((m) => m.id === mode)?.hint}
          </div>

          {/* Common agent / skill row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">
                Agent (optional)
              </label>
              <Input
                value={agent}
                onChange={(e) => setAgent(e.target.value.toUpperCase())}
                className="bg-[var(--j-panel-soft)] border-[var(--j-border)] jarvis-mono"
                placeholder="ORION"
              />
            </div>
            <div>
              <label className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">
                Skill (optional)
              </label>
              <Input
                value={skill}
                onChange={(e) => setSkill(e.target.value)}
                className="bg-[var(--j-panel-soft)] border-[var(--j-border)] jarvis-mono"
                placeholder="web-search"
              />
            </div>
          </div>

          {/* Target section dropdown */}
          <div className="grid grid-cols-2 gap-3 items-end">
            <div>
              <label className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">
                Target Section
              </label>
              <Select
                value={section}
                onValueChange={(v) => setSection(v as TargetSection | 'auto')}
              >
                <SelectTrigger className="bg-[var(--j-panel-soft)] border-[var(--j-border)] jarvis-mono">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">
                    <span className="flex items-center gap-2">
                      <Wand2 className="h-3 w-3" /> Auto-categorize
                    </span>
                  </SelectItem>
                  {TARGET_SECTIONS.map((s) => (
                    <SelectItem key={s} value={s}>
                      <span className="flex items-center gap-2">
                        <span
                          className="inline-block h-2 w-2 rounded-full"
                          style={{ background: SECTION_COLORS[s] }}
                        />
                        {TARGET_SECTION_LABELS[s]}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div
              className="rounded-md border p-2 text-[11px]"
              style={{
                borderColor: `${accent}55`,
                background: `${accent}10`,
                color: accent,
              }}
            >
              <div className="jarvis-mono uppercase text-[9px] tracking-widest opacity-70">
                {section === 'auto' ? 'Auto-suggest' : 'Selected'}
              </div>
              <div className="jarvis-mono text-xs mt-0.5">
                → {TARGET_SECTION_LABELS[effectiveSection]}
              </div>
              <div className="text-[10px] mt-0.5 opacity-80">
                {section === 'auto'
                  ? `conf ${(suggestion.confidence * 100).toFixed(0)}% · ${suggestion.reason}`
                  : 'operator override'}
              </div>
            </div>
          </div>

          {/* Mode-specific input */}
          {mode === 'text' && (
            <div>
              <label className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">
                Text
              </label>
              <Textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Paste notes, transcripts, code, reference material…"
                className="bg-[var(--j-panel-soft)] border-[var(--j-border)] min-h-[120px]"
              />
            </div>
          )}

          {mode === 'url' && (
            <div>
              <label className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">
                URL
              </label>
              <Input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com/article"
                className="bg-[var(--j-panel-soft)] border-[var(--j-border)] jarvis-mono"
              />
            </div>
          )}

          {mode === 'video' && (
            <div className="space-y-2">
              <div>
                <label className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">
                  Video URL (YouTube / Vimeo / direct mp4)
                </label>
                <Input
                  value={videoUrl}
                  onChange={(e) => setVideoUrl(e.target.value)}
                  placeholder="https://www.youtube.com/watch?v=…"
                  className="bg-[var(--j-panel-soft)] border-[var(--j-border)] jarvis-mono"
                />
              </div>
              <div className="text-[11px] text-[var(--j-text-mute)] bg-[var(--j-panel-soft)] border border-[var(--j-border-soft)] rounded-md p-2">
                <Video className="inline h-3 w-3 mr-1" />
                Video understanding runs via the <span className="jarvis-mono text-[var(--j-violet)]">video-understand</span> skill —
                metadata is stored immediately and transcription is processed out-of-band.
              </div>
            </div>
          )}

          {(mode === 'document' || mode === 'zip') && (
            <div
              className="space-y-2"
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
            >
              <label className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">
                {mode === 'zip' ? 'Zip archive (single file)' : 'Documents (multiple)'}
              </label>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full flex flex-col items-center gap-2 p-6 rounded-md border-2 border-dashed border-[var(--j-border)] hover:border-[var(--j-cyan)] bg-[var(--j-panel-soft)] transition-colors"
              >
                <Upload className="h-5 w-5 text-[var(--j-text-dim)]" />
                <span className="jarvis-mono text-[11px] text-[var(--j-text-dim)]">
                  Click to pick {mode === 'document' ? 'files' : 'a zip'} or drag-drop here
                </span>
                {mode === 'document' && (
                  <span className="text-[10px] text-[var(--j-text-mute)]">
                    .pdf · .docx · .txt · .md · .csv · .json
                  </span>
                )}
                {mode === 'zip' && (
                  <span className="text-[10px] text-[var(--j-text-mute)]">.zip only</span>
                )}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                multiple={mode === 'document'}
                accept={mode === 'zip' ? '.zip,application/zip' : DOC_ACCEPT}
                className="hidden"
                onChange={(e) => handleFilesPicked(e.target.files)}
              />
              {files.length > 0 && (
                <div className="space-y-1 max-h-48 overflow-y-auto jarvis-scroll">
                  {files.map((f, i) => (
                    <div
                      key={`${f.name}-${i}`}
                      className="flex items-center gap-2 p-2 rounded-md border border-[var(--j-border-soft)] bg-[var(--j-panel-soft)]"
                    >
                      <FileText className="h-3.5 w-3.5 text-[var(--j-text-dim)] shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="jarvis-mono text-xs truncate text-[var(--j-text)]">
                          {f.name}
                        </div>
                        <div className="text-[10px] text-[var(--j-text-mute)]">
                          {formatBytes(f.size)}
                          {f.text && ` · ${f.text.length} chars extracted`}
                          {f.pending && ' · extraction pending'}
                          {f.error === 'unsupported' && ' · unsupported type'}
                          {f.error === 'read failed' && ' · read failed'}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeFile(i)}
                        className="p-1 rounded hover:bg-[var(--j-border-soft)] text-[var(--j-text-mute)] hover:text-[var(--j-red)]"
                        aria-label={`remove ${f.name}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {mode === 'audio' && (
            <div className="space-y-2">
              <label className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">
                Speech → Transcript
              </label>
              <div className="flex gap-2">
                {!recording ? (
                  <Button
                    type="button"
                    onClick={startRecording}
                    variant="outline"
                    className="border-[var(--j-border)] bg-[var(--j-panel-soft)]"
                  >
                    <Mic className="h-3.5 w-3.5 mr-1.5" /> Record
                  </Button>
                ) : (
                  <Button
                    type="button"
                    onClick={stopRecording}
                    variant="outline"
                    className="border-[var(--j-red)]55 text-[var(--j-red)]"
                  >
                    <Square className="h-3.5 w-3.5 mr-1.5" /> Stop
                  </Button>
                )}
                {transcript && (
                  <Button
                    type="button"
                    onClick={() => {
                      setTranscript('');
                      setInterim('');
                    }}
                    variant="ghost"
                    size="sm"
                  >
                    <Trash2 className="h-3.5 w-3.5 mr-1" /> Clear
                  </Button>
                )}
                {recording && (
                  <span className="flex items-center gap-1 jarvis-mono text-[11px] text-[var(--j-red)]">
                    <span
                      className="inline-block h-2 w-2 rounded-full jarvis-pulse-dot"
                      style={{ background: JARVIS.colors.red }}
                    />
                    live
                  </span>
                )}
              </div>
              <Textarea
                value={transcript + (interim ? ' ' + interim : '')}
                onChange={(e) => setTranscript(e.target.value)}
                placeholder="Press Record — your speech will appear here. Edit before ingest."
                className="bg-[var(--j-panel-soft)] border-[var(--j-border)] min-h-[100px]"
              />
              <div className="text-[10px] text-[var(--j-text-mute)]">
                Uses browser-native Web Speech API (Chrome / Edge). Transcript is editable before ingest.
              </div>
            </div>
          )}

          {/* Submit */}
          <div className="flex gap-2">
            <Button
              onClick={submit}
              disabled={busy}
              className="jarvis-btn-accent border-0 flex-1"
            >
              {busy ? (
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              ) : (
                <TrendingUp className="h-3.5 w-3.5 mr-1.5" />
              )}
              {busy ? 'Ingesting…' : `Ingest → ${TARGET_SECTION_LABELS[effectiveSection]}`}
            </Button>
            <Button onClick={() => setOpen(false)} variant="ghost" size="sm">
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </motion.div>
      )}

      <div
        className="absolute bottom-0 left-0 h-[2px]"
        style={{
          width: '40%',
          background: `linear-gradient(90deg, ${JARVIS.colors.cyan}, transparent)`,
        }}
      />
    </motion.div>
  );
}
