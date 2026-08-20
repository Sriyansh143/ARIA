import { NextResponse } from "next/server";
import { getESLState } from "@/lib/freeswitch-esl";
import { getLastOllamaLatency } from "@/lib/ollama-client";
import { getDatabaseProvider } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/settings — runtime configuration status (no secrets exposed).
 *
 * Returns boolean flags for security kill-switches + telephony gate +
 * ollama reachability + database provider. Does NOT return any API keys,
 * passwords, or secret values — only whether each flag is enabled/disabled.
 */
export async function GET() {
  try {
    const eslState = getESLState();
    const ollamaLatency = getLastOllamaLatency();

    return NextResponse.json({
      flags: {
        AI_CALLER_ENABLED: process.env.AI_CALLER_ENABLED === "true",
        AI_CALLER_CONSENT_VERIFIED: process.env.AI_CALLER_CONSENT_VERIFIED === "true",
        ALLOW_CODE_EXEC: process.env.ALLOW_CODE_EXEC === "true",
        ALLOW_TERMINAL_EXEC: process.env.ALLOW_TERMINAL_EXEC === "true",
        UI_HEALER_AUTO_APPROVE: process.env.UI_HEALER_AUTO_APPROVE === "true",
        JARVIS_DEV_BYPASS_AUTH: process.env.JARVIS_DEV_BYPASS_AUTH === "true",
        JARVIS_MULTI_TENANT: process.env.JARVIS_MULTI_TENANT === "true",
        RATE_LIMIT_DISABLED: process.env.RATE_LIMIT_DISABLED === "true",
      },
      telephony: {
        freeswitchConnected: eslState.connected,
        freeswitchAuthenticated: eslState.authenticated,
        aiCallerEnabled:
          process.env.AI_CALLER_ENABLED === "true" &&
          process.env.AI_CALLER_CONSENT_VERIFIED === "true",
        consentVerified: process.env.AI_CALLER_CONSENT_VERIFIED === "true",
        activeCalls: eslState.activeCalls,
      },
      ollama: {
        reachable: (ollamaLatency ?? 0) > 0,
        lastLatencyMs: ollamaLatency ?? null,
        host: process.env.OLLAMA_HOST || "http://127.0.0.1:11434",
      },
      database: {
        provider: getDatabaseProvider(),
        url: process.env.DATABASE_URL ? "configured" : "missing",
      },
      app: {
        version: "v28.0-hermes-autonomous",
        authMode: process.env.JARVIS_AUTH_MODE || "multi-tenant",
        nodeEnv: process.env.NODE_ENV || "development",
      },
      checkedAt: new Date().toISOString(),
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
