/**
 * src/lib/utils/page-reader-fallback.ts — v78 Phase 28
 *
 * Unified page_reader wrapper with Z-AI fallback to direct fetch.
 * Prevents crashes when Z-AI page_reader is unavailable.
 */

const FETCH_TIMEOUT_MS = 15_000;

export interface PageData {
  title: string;
  text: string;
  html: string;
}

export async function pageReaderWithFallback(url: string): Promise<PageData | null> {
  // Try Z-AI page_reader first
  try {
    const ZAI = (await import("z-ai-web-dev-sdk")).default;
    const zai = await ZAI.create();
    const result: any = await Promise.race([
      zai.functions.invoke("page_reader", { url }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Z-AI page_reader timeout")), FETCH_TIMEOUT_MS),
      ),
    ]);
    if (result?.data?.html || result?.data?.text) {
      return {
        title: result.data.title ?? "",
        text: result.data.text ?? "",
        html: result.data.html ?? "",
      };
    }
    return null;
  } catch (zaiErr: any) {
    if (process.env.ARIA_LOG_LEVEL === "debug") {
      console.warn(`[page-reader-fallback] Z-AI failed for "${url.slice(0, 60)}": ${String(zaiErr).slice(0, 80)}`);
    }
    // Fallback: direct fetch + basic HTML parsing
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { "User-Agent": "ARIA-Mission-Control/78.0" },
      });
      clearTimeout(timeoutId);
      if (response.ok) {
        const html = await response.text();
        const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
        const title = titleMatch?.[1]?.trim() ?? url;
        // Basic text extraction: strip tags
        const text = html
          .replace(/<script[\s\S]*?<\/script>/gi, "")
          .replace(/<style[\s\S]*?<\/style>/gi, "")
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 10000);
        return { title, text, html };
      }
    } catch (fetchErr: any) {
      if (process.env.ARIA_LOG_LEVEL === "debug") {
        console.warn(`[page-reader-fallback] Direct fetch also failed: ${String(fetchErr).slice(0, 80)}`);
      }
    }
    return null;
  }
}
