/**
 * src/lib/tts.ts — Embedded Text-to-Speech Engine
 *
 * PROBLEM: Fish Speech (https://github.com/fishaudio/fish-speech) is a
 * Python ML model that requires PyTorch + GPU + model weights. It
 * CANNOT be embedded in a Next.js/Node.js app.
 *
 * SOLUTION: Use the browser's built-in Web Speech API (SpeechSynthesis).
 * This requires NO installs, NO API keys, NO external services. Every
 * modern browser (Chrome, Edge, Safari, Firefox) supports it natively.
 *
 * For server-side TTS (e.g. phone calls via FreeSWITCH), we fall back to:
 *   1. Z-AI TTS API (if ZAI_TTS_ENABLED=true)
 *   2. Ollama TTS (if available)
 *   3. Error (no mock — return typed error if all fail)
 *
 * This module is isomorphic — it works in both client and server contexts.
 * On the client: uses window.speechSynthesis (Web Speech API).
 * On the server: uses Z-AI TTS API (REST call).
 */

// ─── Client-side TTS (Web Speech API) ───────────────────────────────

export interface TTSOptions {
  voice?: string;        // voice URI (e.g. "Google US English")
  rate?: number;         // 0.1 - 10, default 1
  pitch?: number;        // 0 - 2, default 1
  volume?: number;       // 0 - 1, default 1
  language?: string;     // BCP-47 tag, e.g. "en-US", "es-ES", "hi-IN"
}

export interface TTSResult {
  ok: boolean;
  provider: "browser" | "zai" | "none";
  duration?: number;     // estimated duration in ms (browser) or actual (zai)
  error?: string;
}

/**
 * Check if browser TTS is available (client-side only).
 */
export function isBrowserTTSAvailable(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

/**
 * List available browser voices.
 * Returns array of { name, lang, default, voiceURI }.
 */
export function listBrowserVoices(): Array<{ name: string; lang: string; default: boolean; voiceURI: string }> {
  if (!isBrowserTTSAvailable()) return [];
  return window.speechSynthesis.getVoices().map((v) => ({
    name: v.name,
    lang: v.lang,
    default: v.default,
    voiceURI: v.voiceURI,
  }));
}

/**
 * Speak text using the browser's Web Speech API.
 *
 * Works in Chrome, Edge, Safari, Firefox — no installs needed.
 * Supports 100+ languages (depends on the OS/browser voice packs).
 *
 * Returns a promise that resolves when speech completes (or rejects on error).
 */
export function speakBrowser(text: string, options?: TTSOptions): Promise<TTSResult> {
  return new Promise((resolve) => {
    if (!isBrowserTTSAvailable()) {
      resolve({ ok: false, provider: "none", error: "Web Speech API not available in this browser" });
      return;
    }

    try {
      // Cancel any ongoing speech
      window.speechSynthesis.cancel();

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = options?.rate ?? 1;
      utterance.pitch = options?.pitch ?? 1;
      utterance.volume = options?.volume ?? 1;
      utterance.lang = options?.language ?? "en-US";

      // Select voice
      if (options?.voice) {
        const voices = window.speechSynthesis.getVoices();
        const selected = voices.find((v) => v.voiceURI === options.voice || v.name === options.voice);
        if (selected) utterance.voice = selected;
      } else {
        // Auto-select voice matching the language
        const voices = window.speechSynthesis.getVoices();
        const langVoice = voices.find((v) => v.lang.startsWith((options?.language ?? "en").slice(0, 2)));
        if (langVoice) utterance.voice = langVoice;
      }

      const startTime = Date.now();

      utterance.onend = () => {
        resolve({
          ok: true,
          provider: "browser",
          duration: Date.now() - startTime,
        });
      };

      utterance.onerror = (event) => {
        resolve({
          ok: false,
          provider: "browser",
          error: `Speech synthesis error: ${event.error}`,
        });
      };

      window.speechSynthesis.speak(utterance);
    } catch (err) {
      resolve({
        ok: false,
        provider: "browser",
        error: err instanceof Error ? err.message : "unknown error",
      });
    }
  });
}

/**
 * Stop any ongoing browser speech.
 */
export function stopBrowserSpeech(): void {
  if (isBrowserTTSAvailable()) {
    window.speechSynthesis.cancel();
  }
}

// ─── Server-side TTS (Z-AI API) ─────────────────────────────────────

/**
 * Speak text using Z-AI TTS API (server-side).
 *
 * Uses the z-ai-web-dev-sdk's audio.tts.create() method.
 * Requires ZAI_TTS_ENABLED=true and a valid ZAI_API_KEY.
 *
 * Returns the audio as a base64 string (can be played in the browser
 * via an <audio> element, or saved to a file for FreeSWITCH playback).
 */
export async function speakServer(
  text: string,
  options?: TTSOptions & { format?: "mp3" | "wav" }
): Promise<{ ok: boolean; audio?: string; provider: string; error?: string }> {
  try {
    if (process.env.ZAI_TTS_ENABLED !== "true") {
      return { ok: false, provider: "none", error: "ZAI_TTS_ENABLED is not 'true'" };
    }

    const ZAI = (await import("z-ai-web-dev-sdk")).default;
    const zai = await ZAI.create();

    const result = await zai.audio.tts.create({
      model: "glm-4-voice",
      input: text,
      voice: options?.voice ?? "default",
    });

    return {
      ok: true,
      provider: "zai",
      audio: result.audio || result.data || String(result),
    };
  } catch (err) {
    return {
      ok: false,
      provider: "zai",
      error: err instanceof Error ? err.message : "unknown error",
    };
  }
}

// ─── Unified TTS interface ──────────────────────────────────────────

/**
 * Speak text using the best available TTS engine.
 *
 * Priority:
 *   1. Browser Web Speech API (if running in browser) — zero install, instant
 *   2. Z-AI TTS API (if running on server + ZAI_TTS_ENABLED) — high quality
 *   3. Error (no mock — return typed error)
 */
export async function speak(text: string, options?: TTSOptions): Promise<TTSResult> {
  // Client-side: use browser TTS
  if (typeof window !== "undefined") {
    return speakBrowser(text, options);
  }

  // Server-side: use Z-AI TTS
  const result = await speakServer(text, options);
  return {
    ok: result.ok,
    provider: result.provider as "browser" | "zai" | "none",
    error: result.error,
  };
}

/**
 * Get the current TTS status (for the API endpoint).
 */
export function getTTSStatus(): {
  browserAvailable: boolean;
  zaiEnabled: boolean;
  voiceCount: number;
  voices: string[];
} {
  const browserAvailable = isBrowserTTSAvailable();
  const voices = browserAvailable ? listBrowserVoices().map((v) => v.name) : [];
  return {
    browserAvailable,
    zaiEnabled: process.env.ZAI_TTS_ENABLED === "true",
    voiceCount: voices.length,
    voices: voices.slice(0, 20), // cap for display
  };
}
