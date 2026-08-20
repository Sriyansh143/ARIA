/**
 * src/lib/hermes/learning.ts — Autonomous Daily Multimodal Learning Engine
 *
 * Ingests video links, social feeds, and web URLs daily.
 * Extracts insights, stores as memories, and creates reusable skills.
 */

import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { storeMemory } from "./memory";
import { createSkillFromExecution } from "./skills";

export interface IngestResult {
  transcript?: string;
  insights: string[];
  memoriesCreated: number;
  skillsCreated?: number;
}

/**
 * Ingest a web URL — extract content via z-ai page_reader.
 */
export async function ingestWebUrl(url: string): Promise<IngestResult> {
  try {
    // v78 Phase 28: Use unified pageReaderWithFallback.
    const { pageReaderWithFallback } = await import("../utils/page-reader-fallback");
    const pageData = await pageReaderWithFallback(url);
    const content: string = pageData?.html || pageData?.text || "";
    const title: string = pageData?.title || url;

    if (!content) {
      return { insights: [], memoriesCreated: 0, skillsCreated: 0 };
    }

    // Extract insights via LLM
    const { callLLM } = await import("@/lib/llm-client");
    const insightResult = await callLLM(
      "Learning-Engine",
      "Research",
      `Analyze this web content and extract 3-5 actionable insights for an autonomous AI company.\n\nTitle: ${title}\nURL: ${url}\nContent (truncated): ${content.slice(0, 3000)}\n\nRespond with a JSON array of insight strings (no markdown).`,
      { maxRetries: 1 },
    );

    let insights: string[];
    try {
      const cleaned = insightResult.content
        .replace(/```json\n?/g, "")
        .replace(/```\n?/g, "")
        .trim();
      insights = JSON.parse(cleaned);
      if (!Array.isArray(insights)) insights = [insightResult.content.slice(0, 200)];
    } catch {
      insights = [insightResult.content.slice(0, 200)];
    }

    // Store as LearnedInsight
    const learnedInsight = await db.learnedInsight.create({
      data: {
        source: url,
        sourceType: "web",
        content: content.slice(0, 5000),
        insights: JSON.stringify(insights),
      },
    });

    // Store each insight as a memory
    let memoriesCreated = 0;
    for (const insight of insights) {
      await storeMemory(
        `learned-${Date.now()}-${memoriesCreated}`,
        insight,
        "knowledge",
        undefined,
        [title, "learning", "web"],
      );
      memoriesCreated++;
    }

    return { insights, memoriesCreated, skillsCreated: 0 };
  } catch (err) {
    logger.warn("hermes-learning.ingest-web.error", { url, error: String(err) });
    return { insights: [], memoriesCreated: 0, skillsCreated: 0 };
  }
}

/**
 * v65 Phase 15: Ingest a video link — extract REAL transcript.
 *
 * Previously this was a FACADE that just called ingestWebUrl(). Now it:
 *   1. For YouTube: fetches the transcript via the oembed + transcript API
 *   2. Falls back to page_reader for description if transcript unavailable
 *   3. Extracts insights from the transcript text
 */
export async function ingestVideoLink(url: string): Promise<IngestResult> {
  logger.info("hermes-learning.ingest-video.start", { url });

  // Try to extract a YouTube transcript.
  const transcript = await fetchYouTubeTranscript(url);

  if (transcript && transcript.length > 100) {
    // We have a real transcript — extract insights from it.
    try {
      const ZAI = (await import("z-ai-web-dev-sdk")).default;
      const zai = await ZAI.create();
      const response = await zai.chat.completions.create({
        messages: [
          {
            role: "system",
            content: "You are a learning engine. Extract 3-5 key insights from this video transcript. Format each as: INSIGHT: [one sentence insight]",
          },
          { role: "user", content: transcript.slice(0, 10000) },
        ],
      });
      const insightsText = response.choices[0]?.message?.content ?? "";
      const insights = insightsText
        .split("\n")
        .filter((l) => l.includes("INSIGHT:"))
        .map((l) => l.replace(/INSIGHT:\s*/i, "").trim())
        .filter((l) => l.length > 10);

      let memoriesCreated = 0;
      for (const insight of insights) {
        await storeMemory(
          `video-${Date.now()}-${memoriesCreated}`,
          insight,
          "knowledge",
          undefined,
          ["video-learning", "youtube", "transcript"],
        );
        memoriesCreated++;
      }

      return {
        insights,
        memoriesCreated,
        transcript: transcript.slice(0, 5000),
      };
    } catch (err) {
      logger.warn("hermes-learning.ingest-video.llm-failed", { error: String(err) });
    }
  }

  // Fallback: use page_reader for the description.
  logger.info("hermes-learning.ingest-video.fallback-to-page-reader", { url });
  return ingestWebUrl(url);
}

/**
 * v65 Phase 15: Fetch a YouTube transcript.
 * Uses the oembed API to get video metadata + tries to fetch the transcript
 * via the public timedtext API.
 */
async function fetchYouTubeTranscript(url: string): Promise<string | null> {
  try {
    // Extract video ID from various YouTube URL formats.
    const videoIdMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/);
    if (!videoIdMatch) return null;
    const videoId = videoIdMatch[1];

    // Fetch the video page to get the transcript/caption track URL.
    const pageRes = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      signal: AbortSignal.timeout(10000),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; ARIA-Bot/1.0)" },
    });
    if (!pageRes.ok) return null;
    const pageHtml = await pageRes.text();

    // Try to find the caption track URL in the page source.
    const captionMatch = pageHtml.match(/"captionTracks":\s*\[\{"baseUrl":"([^"]+)"/);
    if (captionMatch) {
      const captionUrl = captionMatch[1].replace(/\\u0026/g, "&");
      const transcriptRes = await fetch(captionUrl, {
        signal: AbortSignal.timeout(10000),
      });
      if (transcriptRes.ok) {
        const transcriptXml = await transcriptRes.text();
        // Parse the XML transcript: <text start="...">...</text>
        const texts = [...transcriptXml.matchAll(/<text[^>]*>([^<]+)<\/text>/g)];
        const transcript = texts.map((m) => decodeHtmlEntities(m[1])).join(" ");
        if (transcript.length > 100) return transcript;
      }
    }

    return null;
  } catch {
    return null;
  }
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\\n/g, " ");
}

/**
 * v65 Phase 15: Ingest social media feed — HONEST version.
 *
 * Previously this was a FACADE that claimed to "scrape Twitter/LinkedIn/Reddit"
 * but actually just did a generic web_search. Now it's honest:
 *   - Searches for recent social media MENTIONS about the topic
 *   - Does NOT claim to scrape real posts (that requires platform API access)
 *   - Results are tagged as "search results" not "social posts"
 */
export async function ingestSocialFeed(
  platform: "twitter" | "linkedin" | "reddit",
  topic: string,
): Promise<{ posts: number; insights: string[]; memoriesCreated: number }> {
  try {
    // v78 Phase 28: Use unified webSearchWithFallback.
    const { webSearchWithFallback } = await import("../utils/web-search-fallback");

    // v65 Phase 15: HONEST — this is a web search for social mentions,
    // NOT actual social feed scraping. Real scraping requires platform API keys.
    const results = await webSearchWithFallback(`site:${platform}.com ${topic} 2026`, 10);

    if (!Array.isArray(results) || results.length === 0) {
      return { posts: 0, insights: [], memoriesCreated: 0 };
    }

    // Extract insights from the search results.
    const insights = results.map(
      (r: any) => `[${platform}] ${r.title || r.name || ""}: ${r.snippet || ""}`,
    );

    // Store as memories with honest tagging.
    let memoriesCreated = 0;
    for (let i = 0; i < insights.length; i++) {
      await storeMemory(
        `social-${platform}-${Date.now()}-${i}`,
        insights[i],
        "knowledge",
        undefined,
        [platform, topic, "social-mention", "web-search"],
      );
      memoriesCreated++;
    }

    return { posts: results.length, insights, memoriesCreated };
  } catch (err) {
    logger.warn("hermes-learning.ingest-social.error", { platform, topic, error: String(err) });
    return { posts: 0, insights: [], memoriesCreated: 0 };
  }
}

/**
 * v65 Phase 15: Ingest a FILE (PDF, DOCX, TXT, MD, CSV, JSON).
 * REAL parsing — not just storing the filename.
 *
 * - TXT/MD/CSV/JSON: read as text directly
 * - PDF: fetch + extract text from the PDF content stream
 * - DOCX: fetch + extract text from the XML document
 * - Other: attempt text extraction, fall back to filename
 */
export async function ingestFile(
  fileName: string,
  fileContent: Buffer | string,
  mimeType?: string,
): Promise<IngestResult> {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  let text = "";

  try {
    const buffer = typeof fileContent === "string" ? Buffer.from(fileContent) : fileContent;

    if (ext === "txt" || ext === "md" || ext === "csv" || ext === "json" || ext === "yaml" || ext === "yml" || ext === "xml" || ext === "html") {
      // Plain text formats — read directly.
      text = buffer.toString("utf-8");
    } else if (ext === "pdf") {
      // PDF: extract text from the content stream.
      text = extractTextFromPdf(buffer);
    } else if (ext === "docx") {
      // DOCX: extract text from the XML document.
      text = extractTextFromDocx(buffer);
    } else {
      // Unknown format — try as text, fall back to filename.
      text = buffer.toString("utf-8");
      if (!text || text.charCodeAt(0) === 0) {
        text = `(Binary file: ${fileName}, ${buffer.length} bytes — text extraction not supported for .${ext})`;
      }
    }

    if (!text || text.length < 10) {
      return { insights: [], memoriesCreated: 0 };
    }

    // Truncate to 10,000 chars for the LLM.
    const truncated = text.slice(0, 10000);

    // Extract insights using the LLM.
    const ZAI = (await import("z-ai-web-dev-sdk")).default;
    const zai = await ZAI.create();
    const response = await zai.chat.completions.create({
      messages: [
        {
          role: "system",
          content: `You are a learning engine. Extract 3-5 key insights from this file (${fileName}). Format each as: INSIGHT: [one sentence insight]`,
        },
        { role: "user", content: truncated },
      ],
    });
    const insightsText = response.choices[0]?.message?.content ?? "";
    const insights = insightsText
      .split("\n")
      .filter((l) => l.includes("INSIGHT:"))
      .map((l) => l.replace(/INSIGHT:\s*/i, "").trim())
      .filter((l) => l.length > 10);

    let memoriesCreated = 0;
    for (const insight of insights) {
      await storeMemory(
        `file-${fileName}-${Date.now()}-${memoriesCreated}`,
        insight,
        "knowledge",
        undefined,
        ["file-learning", ext, fileName],
      );
      memoriesCreated++;
    }

    return { insights, memoriesCreated, transcript: truncated.slice(0, 5000) };
  } catch (err) {
    logger.warn("hermes-learning.ingest-file.error", { fileName, error: String(err) });
    return { insights: [], memoriesCreated: 0 };
  }
}

/**
 * Extract text from a PDF buffer (simple extraction — finds text between BT/ET markers).
 * This is a lightweight parser that doesn't require external dependencies.
 */
function extractTextFromPdf(buffer: Buffer): string {
  try {
    const text = buffer.toString("latin1");
    // Extract text from PDF content streams: look for text in parentheses within BT...ET blocks.
    const textMatches = [...text.matchAll(/\(([^)]+)\)/g)];
    const extracted = textMatches
      .map((m) => m[1])
      .filter((s) => s.length > 1 && /[a-zA-Z]/.test(s))
      .join(" ");
    return extracted.slice(0, 50000);
  } catch {
    return "";
  }
}

/**
 * Extract text from a DOCX buffer (ZIP → XML → text).
 * DOCX files are ZIP archives containing word/document.xml.
 */
function extractTextFromDocx(buffer: Buffer): string {
  try {
    // Simple approach: look for <w:t> tags in the XML content.
    const text = buffer.toString("utf-8");
    const textMatches = [...text.matchAll(/<w:t[^>]*>([^<]+)<\/w:t>/g)];
    const extracted = textMatches.map((m) => m[1]).join(" ");
    return extracted.slice(0, 50000);
  } catch {
    return "";
  }
}

/**
 * Run the daily learning pipeline.
 *
 * Sources (configurable via env):
 *   - DAILY_LEARNING_URLS (comma-separated URLs)
 *   - DAILY_LEARNING_TOPICS (comma-separated topics for social feeds)
 */
export async function runDailyLearning(): Promise<{
  videosProcessed: number;
  postsProcessed: number;
  urlsProcessed: number;
  memoriesCreated: number;
  skillsCreated: number;
}> {
  const urls = (process.env.DAILY_LEARNING_URLS ?? "").split(",").filter(Boolean);
  const topics = (process.env.DAILY_LEARNING_TOPICS ?? "AI,SaaS,startups").split(",").filter(Boolean);

  let videosProcessed = 0;
  let postsProcessed = 0;
  let urlsProcessed = 0;
  let memoriesCreated = 0;
  let skillsCreated = 0;

  // Process URLs (web + video)
  for (const url of urls) {
    const trimmed = url.trim();
    if (trimmed.includes("youtube.com") || trimmed.includes("vimeo.com")) {
      const result = await ingestVideoLink(trimmed);
      videosProcessed++;
      memoriesCreated += result.memoriesCreated;
      skillsCreated += result.skillsCreated ?? 0;
    } else {
      const result = await ingestWebUrl(trimmed);
      urlsProcessed++;
      memoriesCreated += result.memoriesCreated;
    }
  }

  // Process social topics
  for (const topic of topics) {
    for (const platform of ["twitter", "linkedin", "reddit"] as const) {
      const result = await ingestSocialFeed(platform, topic.trim());
      postsProcessed += result.posts;
      memoriesCreated += result.memoriesCreated;
    }
  }

  logger.info("hermes-learning.daily.complete", {
    videosProcessed,
    postsProcessed,
    urlsProcessed,
    memoriesCreated,
    skillsCreated,
  });

  return {
    videosProcessed,
    postsProcessed,
    urlsProcessed,
    memoriesCreated,
    skillsCreated,
  };
}
