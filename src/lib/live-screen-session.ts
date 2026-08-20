/**
 * src/lib/live-screen-session.ts — v66 Phase 16 (Gemini-Style Live Screen Interaction)
 *
 * The agent can share a LIVE session: screenshot stream of the built product
 * + vision model answering questions about what's on screen in real time.
 *
 * Works during calls: agent describes what customer is seeing live.
 *
 * Architecture:
 *   1. WebSocket channel streams screen frames (base64 JPEG)
 *   2. Vision model (qwen2.5vl:3b via Ollama) analyzes what's on screen
 *   3. Customer asks via chat/voice, agent responds by navigating + explaining
 *   4. Works with the Pipecat voice pipeline for real-time narration
 */

import "server-only";
import { db } from "./db";
import { logger } from "./logger";
import { emit } from "./event-bus";
import crypto from "crypto";

export interface LiveScreenSession {
  sessionId: string;
  orderId: string;
  customerEmail: string;
  startedAt: string;
  status: "active" | "ended";
  framesStreamed: number;
  questionsAnswered: number;
}

export interface ScreenFrame {
  sessionId: string;
  frameId: string;
  timestamp: string;
  base64Jpeg: string;
  analysis?: string;
}

/**
 * Start a live screen sharing session for a built service.
 */
export async function startLiveScreenSession(
  orderId: string,
  customerEmail: string,
): Promise<LiveScreenSession> {
  const sessionId = crypto.randomUUID();

  const session: LiveScreenSession = {
    sessionId,
    orderId,
    customerEmail,
    startedAt: new Date().toISOString(),
    status: "active",
    framesStreamed: 0,
    questionsAnswered: 0,
  };

  // Store session metadata.
  await db.setting.upsert({
    where: { key: `live-session:${sessionId}` },
    create: {
      key: `live-session:${sessionId}`,
      value: JSON.stringify(session),
      category: "system",
    },
    update: {
      value: JSON.stringify(session),
    },
  });

  emit({
    type: "system",
    ts: session.startedAt,
    message: `🖥️ Live screen session started for order ${orderId} — viewer: ${customerEmail}`,
    level: "info",
  });

  logger.info("live-screen-session.started", { sessionId, orderId, customerEmail });
  return session;
}

/**
 * Analyze a screen frame using the vision model.
 * Returns a description of what's on screen + suggested talking points.
 *
 * v69 Phase 19 BLOCKER 4: CRITICAL FIX. The previous implementation called
 * `base64Image.slice(0, 100)` — corrupting the image payload to ~75 bytes
 * of JPEG data, which the vision model could not interpret. We now:
 *   1. Decode the base64 to a Buffer.
 *   2. Pass it through sharp to resize to max 1024×1024 + compress to JPEG.
 *   3. Re-encode the compressed JPEG to a FULL base64 string.
 *   4. Feed the full valid string to the vision model endpoint.
 */
export async function analyzeScreenFrame(
  base64Image: string,
  customerQuestion?: string,
): Promise<{ description: string; talkingPoints: string[]; suggestedAction: string }> {
  try {
    // ─── Image preprocessing via sharp (BLOCKER 4 fix) ───
    // Strip any data URI prefix the caller may have included.
    const stripped = base64Image.replace(/^data:image\/[a-z]+;base64,/, "");
    const rawBuffer = Buffer.from(stripped, "base64");

    // Validate that we actually got image bytes (not a 100-char stub).
    if (rawBuffer.length < 500) {
      logger.warn("live-screen-session.invalid-payload", {
        bufferBytes: rawBuffer.length,
        hint: "base64 image payload too small — vision model cannot analyze",
      });
      return {
        description: "(Unable to analyze screen — image payload too small)",
        talkingPoints: [],
        suggestedAction: "Continue manually",
      };
    }

    // Resize to max 1024×1024 + compress to JPEG (quality 80) for token efficiency.
    let processedBuffer: Buffer;
    try {
      const sharp = (await import("sharp")).default;
      processedBuffer = await sharp(rawBuffer)
        .resize(1024, 1024, { fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 80, mozjpeg: true })
        .toBuffer();
    } catch (sharpErr) {
      logger.warn("live-screen-session.sharp-failed-using-raw", { error: String(sharpErr).slice(0, 80) });
      processedBuffer = rawBuffer; // fallback: send the raw buffer
    }

    // Re-encode the processed image as a full base64 string — NO slicing.
    const fullBase64 = processedBuffer.toString("base64");
    logger.info("live-screen-session.frame-processed", {
      rawBytes: rawBuffer.length,
      processedBytes: processedBuffer.length,
      base64Chars: fullBase64.length,
    });

    const ZAI = (await import("z-ai-web-dev-sdk")).default;
    const zai = await ZAI.create();

    const prompt = customerQuestion
      ? `The customer is looking at a live demo and asks: "${customerQuestion}". Describe what's currently shown on screen and how to answer their question. Format: DESCRIPTION: [what's on screen] | TALKING_POINTS: [2-3 points to mention] | SUGGESTED_ACTION: [what to click/navigate to next]`
      : `Describe what's currently shown on this screen demo. Format: DESCRIPTION: [what's on screen] | TALKING_POINTS: [2-3 points to mention] | SUGGESTED_ACTION: [what to click/navigate to next]`;

    // Pass the FULL base64 string as an image_url data URL. No truncation.
    const response = await zai.chat.completions.create({
      model: "glm-4.6v",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            {
              type: "image_url",
              image_url: { url: `data:image/jpeg;base64,${fullBase64}` },
            },
          ],
        },
      ],
    } as any);

    const result = response.choices[0]?.message?.content ?? "";

    // Parse the structured response.
    const descMatch = result.match(/DESCRIPTION:\s*([^|]+)/);
    const talkingMatch = result.match(/TALKING_POINTS:\s*([^|]+)/);
    const actionMatch = result.match(/SUGGESTED_ACTION:\s*([^|]+)/);

    return {
      description: descMatch ? descMatch[1].trim() : result.slice(0, 200),
      talkingPoints: talkingMatch
        ? talkingMatch[1].split(/[;.]/).map((s) => s.trim()).filter((s) => s.length > 5)
        : [],
      suggestedAction: actionMatch ? actionMatch[1].trim() : "Continue the demo",
    };
  } catch (err) {
    logger.warn("live-screen-session.analyze-failed", { error: String(err).slice(0, 80) });
    return {
      description: "(Unable to analyze screen — vision model unavailable)",
      talkingPoints: [],
      suggestedAction: "Continue manually",
    };
  }
}

/**
 * End a live screen session.
 */
export async function endLiveScreenSession(sessionId: string): Promise<void> {
  try {
    const setting = await db.setting.findUnique({ where: { key: `live-session:${sessionId}` } });
    if (!setting) return;

    const session = JSON.parse(setting.value) as LiveScreenSession;
    session.status = "ended";
    session.framesStreamed = session.framesStreamed;

    await db.setting.update({
      where: { key: `live-session:${sessionId}` },
      data: { value: JSON.stringify(session) },
    });

    emit({
      type: "system",
      ts: new Date().toISOString(),
      message: `🖥️ Live screen session ended — ${session.framesStreamed} frames streamed, ${session.questionsAnswered} questions answered.`,
      level: "info",
    });

    logger.info("live-screen-session.ended", { sessionId, framesStreamed: session.framesStreamed });
  } catch (err) {
    logger.warn("live-screen-session.end-failed", { error: String(err) });
  }
}
