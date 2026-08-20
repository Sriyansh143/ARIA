/**
 * POST /api/vision/ingest — Phase 31
 *
 * Upload an image for vision analysis. Accepts multipart/form-data with
 * an image file + a prompt, OR JSON with a base64 image + prompt.
 *
 * The image is analyzed by the multi-provider vision chain (Z-AI GLM-4V →
 * OpenAI GPT-4o → Ollama LLaVA → Mock). The first successful provider's
 * analysis is returned.
 *
 * USE CASES
 * --------
 *   1. UI bug screenshot → "Generate a bug-fix patch for this React component"
 *   2. Competitor site screenshot → "Extract the layout structure as React/Tailwind"
 *   3. Hand-drawn sketch → "Convert this wireframe to a React component"
 *   4. General image → "Describe what's in this image"
 *
 * REQUEST
 * -------
 *   multipart/form-data:
 *     - image: File (PNG/JPEG, max 10MB)
 *     - prompt: string (what to do with the image)
 *     - source?: "ui-bug" | "competitor-screenshot" | "hand-drawn-sketch" | "general"
 *
 *   OR application/json:
 *     {
 *       "imageBase64": "iVBORw0KGgo...",  // no data: prefix
 *       "prompt": "Generate React/Tailwind code for this UI",
 *       "source": "competitor-screenshot"
 *     }
 *
 * RESPONSE
 * --------
 *   {
 *     "ok": true,
 *     "provider": "zai",
 *     "description": "...",
 *     "extractedText": "...",
 *     "suggestedCode": "...",
 *     "confidence": 0.85
 *   }
 */
import { NextRequest, NextResponse } from "next/server";
import { analyzeImage } from "@/lib/vision/vision-provider";
import { recordAudit } from "@/lib/audit-log";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10 MB

export async function POST(req: NextRequest) {
  try {
    let imageBase64: string | undefined;
    let imageUrl: string | undefined;
    let prompt: string = "";
    let source: string = "general";

    const contentType = req.headers.get("content-type") ?? "";

    if (contentType.includes("multipart/form-data")) {
      // Multipart upload — extract the image file + prompt.
      const formData = await req.formData();
      const imageFile = formData.get("image") as File | null;
      prompt = (formData.get("prompt") as string) ?? "";
      source = (formData.get("source") as string) ?? "general";

      if (!imageFile) {
        return NextResponse.json({ error: "missing 'image' file in form data" }, { status: 400 });
      }
      if (imageFile.size > MAX_IMAGE_SIZE) {
        return NextResponse.json({ error: `image too large (${imageFile.size} bytes, max ${MAX_IMAGE_SIZE})` }, { status: 413 });
      }
      if (!prompt) {
        return NextResponse.json({ error: "missing 'prompt' field" }, { status: 400 });
      }

      const buffer = Buffer.from(await imageFile.arrayBuffer());
      imageBase64 = buffer.toString("base64");
    } else if (contentType.includes("application/json")) {
      // JSON body — base64 image OR image URL.
      const body = await req.json();
      imageBase64 = body.imageBase64;
      imageUrl = body.imageUrl;
      prompt = body.prompt ?? "";
      source = body.source ?? "general";

      if (!imageBase64 && !imageUrl) {
        return NextResponse.json({ error: "missing 'imageBase64' or 'imageUrl'" }, { status: 400 });
      }
      if (!prompt) {
        return NextResponse.json({ error: "missing 'prompt'" }, { status: 400 });
      }
    } else {
      return NextResponse.json({ error: `unsupported content-type: ${contentType}` }, { status: 415 });
    }

    // Strip data: prefix if present (some clients send it).
    if (imageBase64?.startsWith("data:")) {
      imageBase64 = imageBase64.split(",")[1];
    }

    const result = await analyzeImage({
      imageBase64,
      imageUrl,
      prompt,
      source,
      uploadedBy: "owner",
    });

    // Record audit log entry.
    await recordAudit({
      actor: "owner",
      actorRole: "owner",
      action: "vision-ingest",
      resource: "VisionAnalysis",
      after: {
        provider: result.provider,
        source,
        prompt: prompt.slice(0, 200),
        confidence: result.confidence,
        ok: result.ok,
      },
      source: "api",
      context: {
        ip: req.headers.get("x-forwarded-for") ?? undefined,
        userAgent: req.headers.get("user-agent") ?? undefined,
      },
    });

    if (!result.ok) {
      logger.warn("api.vision.ingest-failed", { provider: result.provider, error: result.error });
      return NextResponse.json({ ok: false, error: result.error, provider: result.provider }, { status: 502 });
    }

    return NextResponse.json({
      ok: true,
      provider: result.provider,
      description: result.description,
      extractedText: result.extractedText,
      suggestedCode: result.suggestedCode,
      confidence: result.confidence,
    });
  } catch (err) {
    logger.error("api.vision.ingest-failed", { error: String(err) });
    return NextResponse.json({ error: "internal_error", detail: String(err) }, { status: 500 });
  }
}

/**
 * GET /api/vision/ingest — returns the status of all vision providers.
 */
export async function GET() {
  const { getVisionProviderStatus } = await import("@/lib/vision/vision-provider");
  const providers = getVisionProviderStatus();
  return NextResponse.json({
    providers,
    supportedSources: ["ui-bug", "competitor-screenshot", "hand-drawn-sketch", "general"],
    maxImageSize: MAX_IMAGE_SIZE,
  });
}
