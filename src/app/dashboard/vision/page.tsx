"use client";

/**
 * src/app/dashboard/vision/page.tsx — Phase 32
 *
 * Vision upload UI. Drag-and-drop an image (or pick a file) + write a
 * prompt → POST to /api/vision/ingest → display the analysis (description,
 * extracted text, suggested code).
 *
 * SUPPORTED SOURCES (preset prompts)
 * - UI Bug: "Analyze this bug screenshot + generate a fix patch"
 * - Competitor Screenshot: "Extract the layout structure as React/Tailwind"
 * - Hand-drawn Sketch: "Convert this wireframe to a React component"
 * - General: "Describe what's in this image"
 *
 * INFRASTRUCTURE (from v81)
 * - /api/vision/ingest endpoint (multipart + JSON, 10MB max)
 * - vision-provider.ts (Z-AI GLM-4V → OpenAI GPT-4o → Ollama LLaVA → Mock)
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Upload,
  ImageIcon,
  Loader2,
  Code2,
  FileText,
  Eye,
  Copy,
  Check,
} from "lucide-react";

interface VisionResult {
  ok: boolean;
  provider: string;
  description: string;
  extractedText: string;
  suggestedCode: string;
  confidence: number;
  error?: string;
}

const PRESETS = [
  {
    id: "ui-bug",
    label: "UI Bug Fix",
    prompt: "Analyze this bug screenshot. Identify the issue + generate a React/Tailwind code fix.",
    icon: Code2,
  },
  {
    id: "competitor-screenshot",
    label: "Competitor Screenshot",
    prompt: "Extract the layout structure of this screenshot as a React/Tailwind component tree.",
    icon: ImageIcon,
  },
  {
    id: "hand-drawn-sketch",
    label: "Hand-drawn Sketch",
    prompt: "Convert this wireframe sketch into a working React component with Tailwind CSS.",
    icon: FileText,
  },
  {
    id: "general",
    label: "General Analysis",
    prompt: "Describe what's in this image in detail.",
    icon: Eye,
  },
];

export default function VisionPage() {
  const router = useRouter();
  const [selectedFile, setSelectedFile] = React.useState<File | null>(null);
  const [preview, setPreview] = React.useState<string>("");
  const [prompt, setPrompt] = React.useState(PRESETS[0].prompt);
  const [source, setSource] = React.useState("ui-bug");
  const [analyzing, setAnalyzing] = React.useState(false);
  const [result, setResult] = React.useState<VisionResult | null>(null);
  const [copied, setCopied] = React.useState(false);
  const [dragActive, setDragActive] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  function handleFileSelect(file: File) {
    if (!file.type.startsWith("image/")) {
      alert("Please select an image file (PNG, JPEG, etc.)");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      alert("Image too large. Max 10 MB.");
      return;
    }
    setSelectedFile(file);
    const reader = new FileReader();
    reader.onload = (e) => setPreview(e.target?.result as string);
    reader.readAsDataURL(file);
    setResult(null);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFileSelect(file);
  }

  function handlePresetSelect(presetId: string) {
    const preset = PRESETS.find((p) => p.id === presetId);
    if (preset) {
      setSource(presetId);
      setPrompt(preset.prompt);
    }
  }

  async function handleAnalyze() {
    if (!selectedFile || !prompt) return;
    setAnalyzing(true);
    setResult(null);

    try {
      const formData = new FormData();
      formData.append("image", selectedFile);
      formData.append("prompt", prompt);
      formData.append("source", source);

      const res = await fetch("/api/vision/ingest", {
        method: "POST",
        body: formData,
      });

      const data = (await res.json()) as VisionResult;
      setResult(data);
    } catch (err) {
      setResult({
        ok: false,
        provider: "none",
        description: "",
        extractedText: "",
        suggestedCode: "",
        confidence: 0,
        error: String(err),
      });
    } finally {
      setAnalyzing(false);
    }
  }

  function handleCopyCode() {
    if (result?.suggestedCode) {
      navigator.clipboard.writeText(result.suggestedCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <div className="min-h-[calc(100vh-4rem)] max-w-6xl mx-auto w-full px-4 py-6">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Vision Ingestion</h1>
          <p className="text-xs text-muted-foreground">
            Upload an image → get React/Tailwind code · 4-provider fallback (Z-AI → OpenAI → Ollama → Mock)
          </p>
        </div>
        <button
          onClick={() => router.push("/dashboard")}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          ← Back to Dashboard
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ─── Left: Upload + Prompt ─── */}
        <div className="space-y-4">
          {/* Dropzone */}
          <div
            onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
            onDragLeave={() => setDragActive(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`relative cursor-pointer rounded-2xl border-2 border-dashed p-8 transition-colors ${
              dragActive ? "border-emerald-500 bg-emerald-500/5" : "border-white/10 hover:border-white/20"
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFileSelect(file);
              }}
            />
            {preview ? (
              <div className="flex flex-col items-center gap-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={preview} alt="Selected" className="max-h-48 rounded-lg" />
                <p className="text-xs text-muted-foreground">
                  {selectedFile?.name} ({((selectedFile?.size ?? 0) / 1024).toFixed(0)} KB) — click to change
                </p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2 text-center">
                <Upload className="h-8 w-8 text-muted-foreground" />
                <p className="text-sm font-medium">Drop an image or click to upload</p>
                <p className="text-xs text-muted-foreground">PNG, JPEG, WebP · max 10 MB</p>
              </div>
            )}
          </div>

          {/* Presets */}
          <div>
            <label className="mb-2 block text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Source Type
            </label>
            <div className="grid grid-cols-2 gap-2">
              {PRESETS.map((preset) => {
                const Icon = preset.icon;
                return (
                  <button
                    key={preset.id}
                    onClick={() => handlePresetSelect(preset.id)}
                    className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs transition-colors ${
                      source === preset.id
                        ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
                        : "border-white/10 hover:border-white/20"
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {preset.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Prompt */}
          <div>
            <label className="mb-2 block text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Prompt
            </label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={4}
              className="w-full resize-none rounded-lg border border-white/10 bg-background/60 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-emerald-500/40"
            />
          </div>

          {/* Analyze button */}
          <button
            onClick={handleAnalyze}
            disabled={!selectedFile || !prompt || analyzing}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-2.5 text-sm font-medium text-emerald-400 hover:bg-emerald-500/20 disabled:opacity-50"
          >
            {analyzing ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Analyzing…
              </>
            ) : (
              <>
                <Eye className="h-4 w-4" />
                Analyze Image
              </>
            )}
          </button>
        </div>

        {/* ─── Right: Result ─── */}
        <div className="space-y-4">
          {result ? (
            <>
              {/* Provider + confidence */}
              <div className="flex items-center gap-3 rounded-lg border border-white/10 bg-background/40 p-3">
                <div className="flex-1">
                  <p className="text-xs text-muted-foreground">Provider</p>
                  <p className="text-sm font-medium capitalize">{result.provider}</p>
                </div>
                <div className="flex-1">
                  <p className="text-xs text-muted-foreground">Confidence</p>
                  <p className="text-sm font-medium">
                    {(result.confidence * 100).toFixed(0)}%
                  </p>
                </div>
              </div>

              {result.error && (
                <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">
                  Error: {result.error}
                </div>
              )}

              {/* Description */}
              {result.description && (
                <div>
                  <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Description
                  </h3>
                  <div className="rounded-lg border border-white/10 bg-background/40 p-3 text-sm">
                    {result.description}
                  </div>
                </div>
              )}

              {/* Extracted Text */}
              {result.extractedText && (
                <div>
                  <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Extracted Text (OCR)
                  </h3>
                  <div className="rounded-lg border border-white/10 bg-background/40 p-3 text-sm font-mono whitespace-pre-wrap">
                    {result.extractedText}
                  </div>
                </div>
              )}

              {/* Suggested Code */}
              {result.suggestedCode && (
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      Suggested Code
                    </h3>
                    <button
                      onClick={handleCopyCode}
                      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                    >
                      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                      {copied ? "Copied" : "Copy"}
                    </button>
                  </div>
                  <pre className="overflow-x-auto rounded-lg border border-white/10 bg-black/40 p-3 text-xs">
                    <code>{result.suggestedCode}</code>
                  </pre>
                </div>
              )}
            </>
          ) : (
            <div className="flex h-full min-h-[300px] items-center justify-center rounded-2xl border border-dashed border-white/10">
              <div className="text-center">
                <Eye className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  Upload an image + click "Analyze" to see the result
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
