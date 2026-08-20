import { NextResponse } from "next/server";
import { getRouterStatus } from "@/lib/llm-router";
import { getLastOllamaLatency } from "@/lib/ollama-client";
import { getESLState } from "@/lib/freeswitch-esl";

export const dynamic = "force-dynamic";

/**
 * GET /api/llm-router/status — multi-provider LLM router + FreeSWITCH status.
 *
 * Returns the current state of all LLM providers (Z-AI, Groq, NVIDIA, Ollama),
 * including which are available, which are on cooldown, and the last Ollama
 * latency. Also returns FreeSWITCH ESL connection state.
 */
export async function GET() {
  try {

  const routerStatus = getRouterStatus();
  const ollamaLatency = getLastOllamaLatency();
  const eslState = getESLState();

  return NextResponse.json({
    providers: routerStatus.providers,
    ollama: {
      lastLatencyMs: ollamaLatency,
      host: process.env.OLLAMA_HOST || "http://127.0.0.1:11434",
      configuredModels: {
        strong: process.env.WORKFORCE_MODEL_STRONG || "qwen2.5:14b",
        balanced: process.env.WORKFORCE_MODEL_BALANCED || "qwen2.5:7b",
        fast: process.env.WORKFORCE_MODEL_FAST || "qwen2.5:3b",
      },
    },
    freeswitch: {
      connected: eslState.connected,
      authenticated: eslState.authenticated,
      reconnectAttempts: eslState.reconnectAttempts,
      lastEventAt: eslState.lastEventAt,
      activeCalls: eslState.activeCalls,
    },
    checkedAt: new Date().toISOString(),
  });

  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
