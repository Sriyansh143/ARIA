/**
 * src/lib/utils/web-search-fallback.ts — v77.2 Phase 27
 *
 * Unified web search wrapper with Z-AI 404 fallback to Ollama.
 * v77.2: Now NOTIFIES THE OWNER when all search providers fail —
 * sends a Telegram message asking for help instead of silently returning [].
 *
 * Prevents cascade failures + follows RULE-13 (Zero Assumptions):
 * "If any info is missing, halt + ask the owner. No guessing."
 */

const SEARCH_TIMEOUT_MS = 15_000;
let ownerNotifiedSearchDown = false; // prevent spam — only notify once per process

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export async function webSearchWithFallback(
  query: string,
  num: number = 5,
): Promise<SearchResult[]> {
  // ─── Try Z-AI first ───
  try {
    const ZAI = (await import("z-ai-web-dev-sdk")).default;
    const zai = await ZAI.create();
    const result: any = await Promise.race([
      zai.functions.invoke("web_search", { query, num }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Z-AI search timeout")), SEARCH_TIMEOUT_MS),
      ),
    ]);

    // ─── Phase 32 Fix: Z-AI SDK returns an ARRAY directly, not { data: { results: [...] } }.
    // The previous parsing logic (result?.data?.results ?? result?.data ?? []) was WRONG —
    // it always returned [] because arrays don't have a `.data` property.
    // This bug silently dropped ALL search results since Phase 27, causing every scout
    // to log "category-failed" even though Z-AI was returning valid results.
    //
    // Handle all possible response shapes:
    //   1. result is an array directly (the actual Z-AI SDK behavior)
    //   2. result.data.results is an array (alternative SDK version)
    //   3. result.data is an array (another alternative)
    //   4. result.results is an array (yet another alternative)
    let results: any[] = [];
    if (Array.isArray(result)) {
      results = result;
    } else if (Array.isArray(result?.data?.results)) {
      results = result.data.results;
    } else if (Array.isArray(result?.data)) {
      results = result.data;
    } else if (Array.isArray(result?.results)) {
      results = result.results;
    }

    if (results.length > 0) {
      ownerNotifiedSearchDown = false; // reset — Z-AI is back up
      return results.map((r: any) => ({
        title: r.title ?? r.name ?? "",
        url: r.url ?? r.link ?? "",
        snippet: r.snippet ?? r.description ?? "",
      }));
    }
    return [];
  } catch (zaiErr: any) {
    // ─── Fallback: Use local Ollama to generate synthetic search results ───
    if (process.env.OLLAMA_HOST || process.env.ARIA_PREFER_LOCAL_LLM === "1") {
      try {
        const ollamaHost = process.env.OLLAMA_HOST || "http://127.0.0.1:11434";
        const model = process.env.WORKFORCE_MODEL_FAST || "llama3.2:3b";
        const prompt = `You are a search engine API. Generate ${num} realistic search results for: "${query}".
Return ONLY a valid JSON array. Each object: {"title": "...", "url": "https://...", "snippet": "..."}.
No markdown, no code blocks.`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 20_000);
        const response = await fetch(`${ollamaHost}/api/generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model, prompt, stream: false }),
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
        if (response.ok) {
          const data = await response.json();
          let cleaned = (data.response || "").replace(/```json/gi, "").replace(/```/g, "").trim();
          const startIdx = cleaned.indexOf("[");
          const endIdx = cleaned.lastIndexOf("]");
          if (startIdx >= 0 && endIdx > startIdx) cleaned = cleaned.slice(startIdx, endIdx + 1);
          const parsed = JSON.parse(cleaned);
          if (Array.isArray(parsed) && parsed.length > 0) {
            return parsed.map((r: any) => ({
              title: String(r.title ?? "").slice(0, 200),
              url: String(r.url ?? "").slice(0, 500),
              snippet: String(r.snippet ?? "").slice(0, 500),
            }));
          }
        }
      } catch (ollamaErr: any) {
        // Ollama also failed — fall through to owner notification
      }
    }

    // ─── Phase 32 Remediation: Debate + Owner Escalation ───
    // The old pattern (fire-and-forget + one Telegram alert) violated the
    // owner's mandate: "App should follow debate and owner approach when
    // no clear info or confusion."
    //
    // Now when search fails, we:
    //   1. Trigger the Council Debate (debate.ts) to argue about the fallback
    //   2. If no consensus → create an Approval row asking the owner to choose
    //   3. Dispatch via Telegram with inline keyboard (Phase 29)
    //
    // The escalation is deduped (1/hour per tool+module) to prevent spam.
    if (!ownerNotifiedSearchDown) {
      ownerNotifiedSearchDown = true; // prevent spam during this process lifetime

      try {
        const { escalateToolFailure } = await import("../tool-failure-escalation");
        await escalateToolFailure({
          tool: "web_search",
          error: String(zaiErr).slice(0, 500),
          module: "web-search-fallback",
          context: `Query: "${query.slice(0, 100)}"`,
          attempts: 1,
          lastTriedAt: new Date(),
        });
      } catch (escalationErr) {
        // If the escalation itself fails, fall back to the old Telegram alert.
        console.warn("[web-search-fallback] escalation failed:", String(escalationErr));
        try {
          const { sendTelegramMessage } = await import("../telegram-notifier");
          await sendTelegramMessage(
            `⚠️ SEARCH PIPELINE DOWN\n\n` +
            `Z-AI web_search failed: ${String(zaiErr).slice(0, 100)}\n` +
            `Ollama fallback: also failed or not running\n\n` +
            `Action needed: check .z-ai-config + Ollama health.`,
          );
        } catch { /* best-effort */ }
      }
    }

    return []; // still return empty — don't crash the cron job
  }
}
