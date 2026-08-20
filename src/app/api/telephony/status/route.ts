import { NextResponse } from "next/server";
import { getTelephonyStatus } from "@/lib/telephony";
import { isOllamaAvailable, listOllamaModels } from "@/lib/ollama-client";
import { getEnvLoaderStatus } from "@/lib/env-loader";

export const dynamic = "force-dynamic";

/**
 * GET /api/telephony/status — combined telephony + LLM provider status.
 *
 * Returns the current configuration for:
 *   - FreeSWITCH (ESL host, port, configured)
 *   - Dograh (base URL, configured)
 *   - AI Caller safety gate (enabled, consent verified)
 *   - Ollama (available, models)
 *   - Env loader (started, interval)
 *
 * Useful for the operator to verify telephony + LLM configuration
 * without making a test call.
 */
export async function GET() {
  try {

  const telephony = getTelephonyStatus();
  const envLoader = getEnvLoaderStatus();
  const ollamaAvailable = await isOllamaAvailable();
  const ollamaModels = ollamaAvailable ? await listOllamaModels() : [];

  return NextResponse.json({
    telephony,
    llm: {
      ollama: {
        available: ollamaAvailable,
        host: process.env.OLLAMA_HOST || "http://127.0.0.1:11434",
        models: ollamaModels,
        configuredModels: {
          strong: process.env.WORKFORCE_MODEL_STRONG || "qwen2.5:14b",
          balanced: process.env.WORKFORCE_MODEL_BALANCED || "qwen2.5:7b",
          fast: process.env.WORKFORCE_MODEL_FAST || "qwen2.5:3b",
        },
      },
      zai: {
        configured: !!process.env.ZAI_API_KEY,
        baseUrl: process.env.ZAI_BASE_URL || "https://api.z.ai/api/paas/v4",
      },
    },
    envLoader,
    checkedAt: new Date().toISOString(),
  });

  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
