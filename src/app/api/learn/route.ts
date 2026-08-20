/**
 * POST /api/learn — v65 Phase 15 (Unified Multi-Format Learning API)
 *
 * Accepts ANY format and routes to the appropriate learner:
 *   - text: raw text → LLM → insights → KnowledgeBase
 *   - file: PDF/DOCX/TXT/MD/CSV → parse → LLM → insights → KnowledgeBase
 *   - link: URL → page_reader → LLM → insights → KnowledgeBase
 *   - video: YouTube URL → transcript fetch → LLM → insights → KnowledgeBase
 *   - social: platform + topic → web_search → LLM → insights → KnowledgeBase
 *   - audio: (future — requires whisper/ASR integration)
 *
 * Auto-detects type if not specified.
 * Stores everything in KnowledgeBaseEntry with source provenance.
 * Triggers vector embedding (nomic-embed-text) for semantic search.
 */
export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { ingestWebUrl, ingestVideoLink, ingestSocialFeed, ingestFile } from "@/lib/hermes/learning";
import { storeMemoryWithEmbedding } from "@/lib/vector-memory";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { type, content, fileName, platform, topic, mimeType } = body;

    if (!content && !fileName) {
      return NextResponse.json({ error: "missing 'content' or 'fileName'" }, { status: 400 });
    }

    // Auto-detect type if not specified.
    const detectedType = type ?? detectType(content, fileName);

    let result: { insights: string[]; memoriesCreated: number; transcript?: string } = {
      insights: [],
      memoriesCreated: 0,
    };
    let sourceLabel = "manual";

    switch (detectedType) {
      case "text": {
        // Raw text → LLM → insights.
        const ZAI = (await import("z-ai-web-dev-sdk")).default;
        const zai = await ZAI.create();
        const response = await zai.chat.completions.create({
          messages: [
            {
              role: "system",
              content: "Extract 3-5 key insights from this text. Format: INSIGHT: [one sentence]",
            },
            { role: "user", content: content.slice(0, 12000) },
          ],
        });
        const insightsText = response.choices[0]?.message?.content ?? "";
        result.insights = insightsText
          .split("\n")
          .filter((l: string) => l.includes("INSIGHT:"))
          .map((l: string) => l.replace(/INSIGHT:\s*/i, "").trim())
          .filter((l: string) => l.length > 10);
        sourceLabel = "text-input";
        break;
      }

      case "file": {
        result = await ingestFile(fileName ?? "unknown.txt", content, mimeType);
        sourceLabel = `file:${fileName ?? "unknown"}`;
        break;
      }

      case "link": {
        result = await ingestWebUrl(content);
        sourceLabel = `url:${content.slice(0, 80)}`;
        break;
      }

      case "video": {
        result = await ingestVideoLink(content);
        sourceLabel = `video:${content.slice(0, 80)}`;
        break;
      }

      case "social": {
        const socialResult = await ingestSocialFeed(platform ?? "twitter", topic ?? content);
        result = {
          insights: socialResult.insights,
          memoriesCreated: socialResult.memoriesCreated,
        };
        sourceLabel = `social:${platform ?? "twitter"}:${topic ?? content}`;
        break;
      }

      default:
        return NextResponse.json({ error: `unknown type: ${detectedType}` }, { status: 400 });
    }

    // Store each insight in KnowledgeBaseEntry + create vector embedding.
    for (const insight of result.insights) {
      await db.knowledgeBaseEntry.create({
        data: {
          title: `Learning: ${insight.slice(0, 60)}`,
          category: "learned_insight",
          content: insight,
          source: sourceLabel,
          tags: JSON.stringify(["learned", detectedType, "api-learn"]),
          coreLogic: `Type: ${detectedType}\nInsight: ${insight}`,
        },
      });

      // Store in vector memory with embedding (for semantic search).
      await storeMemoryWithEmbedding(
        `learn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        insight,
        "knowledge",
        ["learned", detectedType, "api-learn"],
      );
    }

    return NextResponse.json({
      ok: true,
      type: detectedType,
      insights: result.insights,
      memoriesCreated: result.memoriesCreated,
      knowledgeBaseEntries: result.insights.length,
    });
  } catch (err) {
    logger.error("api.learn.failed", { error: String(err) });
    return NextResponse.json({ error: "learning failed" }, { status: 500 });
  }
}

/**
 * Auto-detect the content type from the content/fileName.
 */
function detectType(content: string, fileName?: string): string {
  // If fileName is provided with a known extension, it's a file.
  if (fileName) {
    const ext = fileName.split(".").pop()?.toLowerCase();
    if (ext && ["pdf", "docx", "txt", "md", "csv", "json", "yaml", "yml", "xml", "html"].includes(ext)) {
      return "file";
    }
  }
  // If content looks like a URL, detect the specific URL type.
  if (content && typeof content === "string") {
    if (/youtube\.com|youtu\.be/.test(content)) return "video";
    if (/^https?:\/\//.test(content)) return "link";
    if (/^(twitter|x)\.com|linkedin\.com|reddit\.com/.test(content)) return "social";
  }
  // Default: text.
  return "text";
}
