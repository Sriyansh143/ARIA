"use client";

/**
 * LiveScreenPanel — Gemini-style screen sharing + VLM interaction.
 *
 * This is the missing "live screen sharing and interaction animation"
 * component. The backend (src/lib/screen-vision.ts + /api/screen-vision)
 * already existed but had NO UI.
 *
 * Features:
 *   1. User clicks "Share Screen" → browser getDisplayMedia() prompt
 *   2. Live video preview of the shared screen
 *   3. "Capture & Analyze" button → grabs a frame, sends to VLM
 *   4. VLM analysis displayed with professional scanning animation:
 *      - Summary of what's on screen
 *      - Detected elements (UI components, text, objects)
 *      - Actionable suggestions
 *      - Relevant agents that could help
 *   5. Chat input → ask follow-up questions about the current frame
 *   6. Auto-capture mode (every 30s) for continuous monitoring
 *
 * Backend: POST /api/screen-vision { action, base64, question, agentRole }
 */

import { useState, useRef, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Monitor,
  MonitorOff,
  Camera,
  Sparkles,
  Send,
  Loader2,
  Eye,
  Zap,
  Brain,
  RefreshCw,
  X,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

interface ScreenAnalysis {
  summary: string;
  elements: string[];
  suggestions: string[];
  relevantAgents: string[];
}

interface ChatMsg {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

export function LiveScreenPanel() {
  const [sharing, setSharing] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<ScreenAnalysis | null>(null);
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [autoCapture, setAutoCapture] = useState(false);
  const [lastCapture, setLastCapture] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const autoCaptureTimer = useRef<NodeJS.Timeout | null>(null);

  // ─── Start screen sharing ───
  const startSharing = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 30 },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setSharing(true);
      toast.success("Screen sharing started");

      // Stop when user ends sharing via browser UI
      stream.getVideoTracks()[0].onended = () => {
        stopSharing();
      };
    } catch (err) {
      if (String(err).includes("NotAllowedError")) {
        toast.error("Screen sharing permission denied");
      } else {
        toast.error("Failed to start screen sharing");
      }
    }
  }, []);

  // ─── Stop screen sharing ───
  const stopSharing = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setSharing(false);
    setAutoCapture(false);
    toast.info("Screen sharing stopped");
  }, []);

  // ─── Capture a frame from the video stream ───
  const captureFrame = useCallback((): string | null => {
    if (!videoRef.current || !canvasRef.current) return null;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png");
  }, []);

  // ─── Analyze the current frame via VLM ───
  const analyzeFrame = useCallback(async () => {
    const dataUrl = captureFrame();
    if (!dataUrl) {
      toast.error("No screen to capture — start sharing first");
      return;
    }
    const base64 = dataUrl.split(",")[1];
    setLastCapture(dataUrl);
    setAnalyzing(true);
    setAnalysis(null);

    try {
      const res = await fetch("/api/screen-vision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "analyze",
          base64,
          context: "Analyze this screen and provide a summary, key elements, suggestions, and relevant ARIA agent roles.",
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Analysis failed");
      }
      const data = await res.json();
      setAnalysis(data.analysis);
      toast.success("Screen analyzed");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Analysis failed");
    } finally {
      setAnalyzing(false);
    }
  }, [captureFrame]);

  // ─── Ask a follow-up question about the current frame ───
  const askQuestion = useCallback(async () => {
    if (!chatInput.trim() || !lastCapture) return;
    const question = chatInput.trim();
    const base64 = lastCapture.split(",")[1];
    setChatInput("");
    setChat((prev) => [...prev, { role: "user", content: question, timestamp: Date.now() }]);

    try {
      const res = await fetch("/api/screen-vision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "query",
          base64,
          question,
          agentRole: "Conductor",
        }),
      });
      if (!res.ok) throw new Error("Query failed");
      const data = await res.json();
      setChat((prev) => [
        ...prev,
        {
          role: "assistant",
          content: data.result?.answer || "No response",
          timestamp: Date.now(),
        },
      ]);
    } catch (err) {
      setChat((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `Error: ${err instanceof Error ? err.message : "query failed"}`,
          timestamp: Date.now(),
        },
      ]);
    }
  }, [chatInput, lastCapture]);

  // ─── Auto-capture every 30s ───
  useEffect(() => {
    if (autoCapture && sharing) {
      autoCaptureTimer.current = setInterval(() => {
        void analyzeFrame();
      }, 30_000);
    } else {
      if (autoCaptureTimer.current) {
        clearInterval(autoCaptureTimer.current);
        autoCaptureTimer.current = null;
      }
    }
    return () => {
      if (autoCaptureTimer.current) clearInterval(autoCaptureTimer.current);
    };
  }, [autoCapture, sharing, analyzeFrame]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  return (
    <div className="space-y-3">
      {/* Header card */}
      <Card className="aria-feature-card p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 aria-glow-emerald">
              <Monitor className="h-5 w-5 text-white" />
            </div>
            <div>
              <h3 className="text-sm font-bold">Live Screen Sharing</h3>
              <p className="text-xs text-muted-foreground">
                Share your screen — AI agents can see, analyze, and interact with it
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {!sharing ? (
              <Button
                onClick={startSharing}
                className="aria-btn-gradient"
                size="sm"
              >
                <Monitor className="h-4 w-4" /> Share Screen
              </Button>
            ) : (
              <>
                <Button
                  onClick={analyzeFrame}
                  disabled={analyzing}
                  className="aria-btn-gradient"
                  size="sm"
                >
                  {analyzing ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Camera className="h-4 w-4" />
                  )}
                  {analyzing ? "Analyzing…" : "Capture & Analyze"}
                </Button>
                <Button
                  onClick={stopSharing}
                  variant="outline"
                  size="sm"
                  className="border-rose-500/30 text-rose-300 hover:bg-rose-500/10"
                >
                  <MonitorOff className="h-4 w-4" /> Stop
                </Button>
              </>
            )}
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {/* ─── Screen preview ─── */}
        <Card className="aria-feature-card overflow-hidden p-0">
          <div className="border-b border-border/40 px-4 py-2.5">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-xs font-semibold">
                <Eye className="h-3.5 w-3.5 text-emerald-400" />
                Screen Preview
              </span>
              {sharing && (
                <div className="flex items-center gap-2">
                  <div className="aria-live-dot" />
                  <span className="text-[10px] text-emerald-300">LIVE</span>
                  <label className="flex items-center gap-1 text-[10px] text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={autoCapture}
                      onChange={(e) => setAutoCapture(e.target.checked)}
                      className="h-3 w-3 accent-emerald-500"
                    />
                    Auto (30s)
                  </label>
                </div>
              )}
            </div>
          </div>
          <div className="relative aspect-video bg-black/40">
            {sharing ? (
              <video
                ref={videoRef}
                className="h-full w-full object-contain"
                autoPlay
                playsInline
                muted
              />
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
                <Monitor className="h-12 w-12 opacity-30" />
                <p className="text-xs">Click "Share Screen" to start</p>
                <p className="text-[10px] text-muted-foreground/60">
                  Your screen is never recorded — frames are sent to the VLM only on capture
                </p>
              </div>
            )}

            {/* Scanning animation overlay during analysis */}
            <AnimatePresence>
              {analyzing && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm"
                >
                  <div className="flex flex-col items-center gap-3">
                    {/* Scanning line */}
                    <div className="relative h-16 w-16">
                      <motion.div
                        className="absolute inset-0 rounded-full border-2 border-emerald-500/30"
                        animate={{ scale: [1, 1.2, 1] }}
                        transition={{ duration: 2, repeat: Infinity }}
                      />
                      <motion.div
                        className="absolute inset-0 rounded-full border-t-2 border-emerald-400"
                        animate={{ rotate: 360 }}
                        transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                      />
                      <Brain className="absolute inset-0 m-auto h-6 w-6 text-emerald-400" />
                    </div>
                    <p className="text-xs font-medium text-emerald-300">
                      VLM analyzing screen…
                    </p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Scan line sweep on capture */}
            <AnimatePresence>
              {analyzing && (
                <motion.div
                  initial={{ top: "0%" }}
                  animate={{ top: "100%" }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
                  className="absolute left-0 right-0 h-0.5 bg-gradient-to-r from-transparent via-emerald-400 to-transparent"
                  style={{ boxShadow: "0 0 10px rgba(52, 211, 153, 0.8)" }}
                />
              )}
            </AnimatePresence>
          </div>
          <canvas ref={canvasRef} className="hidden" />
        </Card>

        {/* ─── Analysis results ─── */}
        <Card className="aria-feature-card p-0">
          <div className="border-b border-border/40 px-4 py-2.5">
            <span className="flex items-center gap-2 text-xs font-semibold">
              <Sparkles className="h-3.5 w-3.5 text-violet-400" />
              VLM Analysis
            </span>
          </div>
          <div className="max-h-[400px] overflow-y-auto scrollbar-custom p-4">
            <AnimatePresence mode="wait">
              {!analysis && !analyzing && (
                <motion.div
                  key="empty"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex h-full flex-col items-center justify-center gap-2 py-12 text-muted-foreground"
                >
                  <Brain className="h-10 w-10 opacity-30" />
                  <p className="text-xs">Capture a frame to see AI analysis</p>
                </motion.div>
              )}

              {analyzing && (
                <motion.div
                  key="loading"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="space-y-2"
                >
                  {[...Array(4)].map((_, i) => (
                    <div
                      key={i}
                      className="aria-shimmer h-4 rounded"
                      style={{ width: `${100 - i * 15}%` }}
                    />
                  ))}
                </motion.div>
              )}

              {analysis && (
                <motion.div
                  key="results"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="space-y-3"
                >
                  {/* Summary */}
                  <div>
                    <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-400">
                      <CheckCircle2 className="h-3 w-3" /> Summary
                    </div>
                    <p className="text-xs leading-relaxed text-foreground">
                      {analysis.summary}
                    </p>
                  </div>

                  {/* Elements */}
                  {analysis.elements?.length > 0 && (
                    <div>
                      <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-cyan-400">
                        Detected Elements
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {analysis.elements.map((el, i) => (
                          <Badge
                            key={i}
                            variant="outline"
                            className="border-cyan-500/30 bg-cyan-500/10 text-[10px] text-cyan-300"
                          >
                            {el}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Suggestions */}
                  {analysis.suggestions?.length > 0 && (
                    <div>
                      <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-amber-400">
                        <Zap className="h-3 w-3" /> Suggestions
                      </div>
                      <ul className="space-y-1">
                        {analysis.suggestions.map((s, i) => (
                          <li
                            key={i}
                            className="flex items-start gap-1.5 text-xs text-muted-foreground"
                          >
                            <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-amber-400" />
                            {s}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Relevant agents */}
                  {analysis.relevantAgents?.length > 0 && (
                    <div>
                      <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-violet-400">
                        Relevant Agents
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {analysis.relevantAgents.map((a, i) => (
                          <Badge
                            key={i}
                            variant="outline"
                            className="border-violet-500/30 bg-violet-500/10 text-[10px] text-violet-300"
                          >
                            {a}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </Card>
      </div>

      {/* ─── Chat with the screen ─── */}
      {lastCapture && (
        <Card className="aria-feature-card p-0">
          <div className="border-b border-border/40 px-4 py-2.5">
            <span className="flex items-center gap-2 text-xs font-semibold">
              <Brain className="h-3.5 w-3.5 text-emerald-400" />
              Ask about this screen
            </span>
          </div>
          <div className="max-h-[200px] overflow-y-auto scrollbar-custom p-3">
            {chat.length === 0 ? (
              <p className="py-4 text-center text-xs text-muted-foreground">
                Ask a question about what's currently on screen — the VLM can see your last capture.
              </p>
            ) : (
              <div className="space-y-2">
                {chat.map((msg, i) => (
                  <div
                    key={i}
                    className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-[80%] rounded-lg px-3 py-1.5 text-xs ${
                        msg.role === "user"
                          ? "bg-emerald-600/20 text-emerald-100"
                          : "bg-muted/40 text-foreground"
                      }`}
                    >
                      {msg.content}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="flex gap-2 border-t border-border/40 p-2">
            <Input
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && askQuestion()}
              placeholder="What do you see? What should I do next?"
              className="text-xs"
              disabled={!lastCapture}
            />
            <Button
              onClick={askQuestion}
              disabled={!chatInput.trim() || !lastCapture}
              size="sm"
              className="aria-btn-gradient shrink-0"
            >
              <Send className="h-3.5 w-3.5" />
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
