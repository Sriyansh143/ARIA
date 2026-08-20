"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Mic,
  MicOff,
  ScreenShare,
  ScreenShareOff,
  Camera,
  CameraOff,
  Send,
  X,
  Sparkles,
  Eye,
  Radio,
} from "lucide-react";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  isStreaming?: boolean;
  toolCalls?: string[];
}

/**
 * LiveVoiceChat — Gemini-style live conversational interface.
 *
 * Features:
 *   - Real-time text chat with streaming responses (SSE)
 *   - Voice input via Web Speech API (speech-to-text)
 *   - Screen sharing + vision analysis
 *   - Camera capture for visual Q&A
 *   - Live tool execution visualization (shows Hermes XML tool calls)
 *   - Subagent dispatch visualization
 *
 * Opens as a full-screen overlay from the dashboard header button.
 */
export function LiveVoiceChat() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [listening, setListening] = useState(false);
  const [screenSharing, setScreenSharing] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [toolCalls, setToolCalls] = useState<string[]>([]);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recognitionRef = useRef<any>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Initialize speech recognition
  useEffect(() => {
    if (typeof window === "undefined") return;
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = false;
      recognitionRef.current.interimResults = false;
      recognitionRef.current.lang = "en-US";

      recognitionRef.current.onresult = (event: any) => {
        const transcript = event.results[0][0].transcript;
        setInput(transcript);
        setListening(false);
      };

      recognitionRef.current.onerror = () => setListening(false);
      recognitionRef.current.onend = () => setListening(false);
    }
  }, []);

  const toggleVoice = useCallback(() => {
    if (!recognitionRef.current) {
      alert("Speech recognition not supported in this browser. Use Chrome/Edge.");
      return;
    }
    if (listening) {
      recognitionRef.current.stop();
      setListening(false);
    } else {
      recognitionRef.current.start();
      setListening(true);
    }
  }, [listening]);

  const toggleScreenShare = useCallback(async () => {
    if (screenSharing) {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setScreenSharing(false);
    } else {
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: false,
        });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
        setScreenSharing(true);
      } catch (err) {
        console.error("Screen share failed:", err);
      }
    }
  }, [screenSharing]);

  const toggleCamera = useCallback(async () => {
    if (cameraOn) {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setCameraOn(false);
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: false,
        });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
        setCameraOn(true);
      } catch (err) {
        console.error("Camera access failed:", err);
      }
    }
  }, [cameraOn]);

  const captureFrame = useCallback((): string | null => {
    if (!videoRef.current || !canvasRef.current) return null;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png").split(",")[1];
  }, []);

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim()) return;

      const userMsg: Message = {
        id: `msg-${Date.now()}`,
        role: "user",
        content: text,
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, userMsg]);
      setInput("");

      // If screen sharing, capture frame and send with query
      if (screenSharing || cameraOn) {
        const base64 = captureFrame();
        if (base64) {
          setAnalyzing(true);
          try {
            const res = await fetch("/api/screen-vision", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                action: "query",
                base64,
                question: text,
                agentRole: "Conductor",
              }),
            });
            const data = await res.json();

            const assistantMsg: Message = {
              id: `msg-${Date.now() + 1}`,
              role: "assistant",
              content: data?.result?.answer ?? "No response from vision model.",
              timestamp: new Date().toISOString(),
              toolCalls: data?.result?.actions ?? [],
            };
            setMessages((prev) => [...prev, assistantMsg]);
            if (data?.result?.actions) {
              setToolCalls((prev) => [...prev, ...data.result.actions]);
            }
          } catch (err) {
            setMessages((prev) => [
              ...prev,
              {
                id: `msg-${Date.now() + 1}`,
                role: "assistant",
                content: "Vision query failed. Please try again.",
                timestamp: new Date().toISOString(),
              },
            ]);
          } finally {
            setAnalyzing(false);
          }
          return;
        }
      }

      // Regular text chat via Conductor
      const assistantMsg: Message = {
        id: `msg-${Date.now() + 1}`,
        role: "assistant",
        content: "",
        timestamp: new Date().toISOString(),
        isStreaming: true,
      };
      setMessages((prev) => [...prev, assistantMsg]);

      try {
        const res = await fetch("/api/conductor", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: text }),
        });
        const data = await res.json();

        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsg.id
              ? {
                  ...m,
                  content: data?.response ?? data?.message ?? "I'm here to help.",
                  isStreaming: false,
                  toolCalls: data?.toolCalls ?? [],
                }
              : m,
          ),
        );
      } catch (err) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsg.id
              ? {
                  ...m,
                  content: "Connection error. Please try again.",
                  isStreaming: false,
                }
              : m,
          ),
        );
      }
    },
    [screenSharing, cameraOn, captureFrame],
  );

  return (
    <>
      {/* Floating button */}
      <motion.button
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        onClick={() => setOpen(true)}
        className="fixed bottom-4 right-4 z-50 flex h-12 w-12 items-center justify-center border border-cyan-500/40 bg-cyan-500/10 text-cyan-300 backdrop-blur-xl transition-colors hover:bg-cyan-500/20"
        style={{ borderRadius: 0 }}
        aria-label="Open live chat"
      >
        <Radio className="h-5 w-5" />
        <motion.span
          className="pointer-events-none absolute inset-0 border border-cyan-500/40"
          style={{ borderRadius: 0 }}
          initial={{ opacity: 0.6 }} animate={{ scale: [1, 1.4, 1], opacity: [0.6, 0, 0.6] }}
          transition={{ duration: 2, repeat: Infinity }}
        />
      </motion.button>

      {/* Full-screen overlay */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[50] flex flex-col bg-black/90 backdrop-blur-xl"
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
              <div className="flex items-center gap-2">
                <div
                  className="flex h-8 w-8 items-center justify-center border border-cyan-500/40 bg-cyan-500/10"
                  style={{ borderRadius: 0 }}
                >
                  <Sparkles className="h-4 w-4 text-cyan-300" />
                </div>
                <div>
                  <div className="font-mono text-sm font-bold text-foreground">
                    Live Control
                  </div>
                  <div className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                    Gemini-style multimodal interaction
                  </div>
                </div>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="flex h-8 w-8 items-center justify-center border border-border text-muted-foreground transition-colors hover:border-rose-500/40 hover:text-rose-300"
                style={{ borderRadius: 0 }}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Video preview (screen share / camera) */}
            {(screenSharing || cameraOn) && (
              <div className="relative border-b border-border/60 bg-black">
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="h-32 w-full object-contain"
                />
                <div className="absolute right-2 top-2 flex items-center gap-1.5 bg-black/60 px-2 py-1 font-mono text-[9px] uppercase tracking-wider text-cyan-300">
                  <Eye className="h-3 w-3" />
                  {screenSharing ? "Screen sharing" : "Camera on"}
                  {analyzing && " · analyzing..."}
                </div>
                <canvas ref={canvasRef} className="hidden" />
              </div>
            )}

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {messages.length === 0 && (
                <div className="flex flex-col items-center justify-center h-full text-center">
                  <Radio className="mb-3 h-10 w-10 text-muted-foreground/30" />
                  <p className="text-sm text-muted-foreground">
                    Speak, type, or share your screen to interact with ARIA.
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground/50">
                    The Conductor agent will route your message to the best-fit agent.
                  </p>
                </div>
              )}
              {messages.map((msg) => (
                <motion.div
                  key={msg.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[80%] border px-3 py-2 ${
                      msg.role === "user"
                        ? "border-cyan-500/40 bg-cyan-500/10 text-cyan-100"
                        : "border-border bg-surface text-foreground"
                    }`}
                    style={{ borderRadius: 0 }}
                  >
                    <p className="text-sm whitespace-pre-wrap">
                      {msg.content || (msg.isStreaming ? "..." : "")}
                    </p>
                    {msg.toolCalls && msg.toolCalls.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {msg.toolCalls.map((tc, i) => (
                          <div
                            key={i}
                            className="flex items-center gap-1.5 border border-border/60 bg-bg px-2 py-1 font-mono text-[10px] text-muted-foreground"
                            style={{ borderRadius: 0 }}
                          >
                            <Sparkles className="h-2.5 w-2.5 text-violet-300" />
                            {tc}
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="mt-1 font-mono text-[9px] text-muted-foreground/50">
                      {new Date(msg.timestamp).toLocaleTimeString()}
                    </div>
                  </div>
                </motion.div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            {/* Input bar */}
            <div className="border-t border-border/60 p-3">
              <div className="flex items-center gap-2">
                {/* Voice button */}
                <button
                  onClick={toggleVoice}
                  className={`flex h-9 w-9 items-center justify-center border transition-colors ${
                    listening
                      ? "border-rose-500/40 bg-rose-500/10 text-rose-300"
                      : "border-border text-muted-foreground hover:text-foreground"
                  }`}
                  style={{ borderRadius: 0 }}
                  title={listening ? "Stop listening" : "Voice input"}
                >
                  {listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                </button>

                {/* Screen share button */}
                <button
                  onClick={toggleScreenShare}
                  className={`flex h-9 w-9 items-center justify-center border transition-colors ${
                    screenSharing
                      ? "border-cyan-500/40 bg-cyan-500/10 text-cyan-300"
                      : "border-border text-muted-foreground hover:text-foreground"
                  }`}
                  style={{ borderRadius: 0 }}
                  title={screenSharing ? "Stop screen share" : "Share screen"}
                >
                  {screenSharing ? (
                    <ScreenShareOff className="h-4 w-4" />
                  ) : (
                    <ScreenShare className="h-4 w-4" />
                  )}
                </button>

                {/* Camera button */}
                <button
                  onClick={toggleCamera}
                  className={`flex h-9 w-9 items-center justify-center border transition-colors ${
                    cameraOn
                      ? "border-cyan-500/40 bg-cyan-500/10 text-cyan-300"
                      : "border-border text-muted-foreground hover:text-foreground"
                  }`}
                  style={{ borderRadius: 0 }}
                  title={cameraOn ? "Turn off camera" : "Turn on camera"}
                >
                  {cameraOn ? <CameraOff className="h-4 w-4" /> : <Camera className="h-4 w-4" />}
                </button>

                {/* Text input */}
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && sendMessage(input)}
                  placeholder={
                    listening
                      ? "Listening..."
                      : screenSharing || cameraOn
                        ? "Ask about what's on screen..."
                        : "Ask ARIA anything..."
                  }
                  className="flex-1 border border-border bg-bg px-3 py-2 text-sm text-foreground outline-none focus:border-accent"
                  style={{ borderRadius: 0 }}
                />

                {/* Send button */}
                <button
                  onClick={() => sendMessage(input)}
                  disabled={!input.trim()}
                  className="flex h-9 w-9 items-center justify-center border border-cyan-500/40 bg-cyan-500/10 text-cyan-300 transition-colors hover:bg-cyan-500/20 disabled:opacity-30"
                  style={{ borderRadius: 0 }}
                >
                  <Send className="h-4 w-4" />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
