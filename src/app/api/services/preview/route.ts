/**
 * POST /api/services/preview — free preview build (rate-limited).
 *
 * For services with `freePreview: true`, this endpoint generates a
 * SMALL preview of the deliverable so users can see the quality before
 * buying. The preview is:
 *   - Rate-limited to 3 requests per IP per hour.
 *   - Uses "low" complexity (cheaper/faster model).
 *   - Returns only the first 2 files (truncated to 2000 chars each).
 *   - Does NOT create a ServiceOrder record.
 *
 * This is the "try before you buy" path — like LMArena's free tier.
 */
import { NextRequest, NextResponse } from "next/server";
import { routeLLM, type ChatMsg } from "@/lib/llm-router";
import { getService } from "@/lib/services/catalog";
import { parseMultiFileResponse } from "@/lib/services/builder";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface PreviewBucket {
  tokens: number;
  lastRefill: number;
}

const globalForPreview = globalThis as unknown as { __ariaPreviewLimiter?: Map<string, PreviewBucket> };
const buckets = globalForPreview.__ariaPreviewLimiter ?? new Map<string, PreviewBucket>();
if (!globalForPreview.__ariaPreviewLimiter) globalForPreview.__ariaPreviewLimiter = buckets;

const CAP = 3; // 3 previews per hour
const REFILL_PER_SEC = 3 / 3600;

function checkPreviewRateLimit(ip: string): { allowed: boolean; remaining: number } {
  const now = Date.now();
  let bucket = buckets.get(ip);
  if (!bucket) {
    bucket = { tokens: CAP, lastRefill: now };
    buckets.set(ip, bucket);
  }
  const elapsed = (now - bucket.lastRefill) / 1000;
  bucket.tokens = Math.min(CAP, bucket.tokens + elapsed * REFILL_PER_SEC);
  bucket.lastRefill = now;
  if (bucket.tokens < 1) return { allowed: false, remaining: 0 };
  bucket.tokens -= 1;
  return { allowed: true, remaining: Math.floor(bucket.tokens) };
}

function getClientIp(headers: Headers): string {
  return (
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    headers.get("x-real-ip")?.trim() ||
    "unknown"
  );
}

export async function POST(req: NextRequest) {
  let body: { serviceId?: unknown; spec?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const serviceId = typeof body.serviceId === "string" ? body.serviceId : "";
  const spec = typeof body.spec === "string" ? body.spec.trim() : "";

  const service = getService(serviceId);
  if (!service) {
    return NextResponse.json({ error: `unknown service: ${serviceId}` }, { status: 400 });
  }
  if (!service.freePreview) {
    return NextResponse.json(
      { error: "this service does not offer a free preview. Please purchase to build." },
      { status: 403 },
    );
  }
  if (!spec || spec.length < 10) {
    return NextResponse.json({ error: "spec must be at least 10 characters" }, { status: 400 });
  }
  if (spec.length > 1000) {
    return NextResponse.json({ error: "preview spec must be under 1000 characters" }, { status: 400 });
  }

  // Rate limit.
  const ip = getClientIp(req.headers);
  const rl = checkPreviewRateLimit(ip);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "preview rate limit exceeded (3/hour). Try again later or purchase for full build." },
      { status: 429 },
    );
  }

  // Build a smaller prompt for the preview.
  const messages: ChatMsg[] = [
    {
      role: "system",
      content:
        "You are Build-Bot, ARIA's service builder. This is a FREE PREVIEW — generate a small but complete sample of the deliverable. " +
        "Output 1-2 files maximum using the ---FILE: <path>--- delimiter format. Keep each file under 2000 characters. " +
        "Make it real and functional, not a placeholder. End with ---END---.",
    },
    {
      role: "user",
      content: `Preview build for "${service.name}".\n\nSpec: ${spec}\n\nGenerate 1-2 representative files (e.g., index.html + a brief README.md) that demonstrate the quality of a full build. Make them production-ready, not stubs.`,
    },
  ];

  let result;
  try {
    result = await routeLLM(messages, { complexity: "low" });
  } catch (err) {
    logger.error("services.preview.llm-failed", { error: String(err) });
    return NextResponse.json({ error: "LLM call failed" }, { status: 503 });
  }

  if (!result.success) {
    return NextResponse.json(
      { error: "no LLM provider available", detail: result.error },
      { status: 503 },
    );
  }

  const files = parseMultiFileResponse(result.completion);
  const fileNames = Object.keys(files);

  // Truncate each file to 2000 chars for the preview.
  const truncated: Record<string, string> = {};
  for (const [name, content] of Object.entries(files)) {
    truncated[name] = content.length > 2000 ? content.slice(0, 2000) + "\n\n<!-- truncated — purchase for full file -->" : content;
  }

  return NextResponse.json({
    preview: true,
    serviceId,
    serviceName: service.name,
    files: truncated,
    fileCount: fileNames.length,
    provider: result.provider,
    model: result.model,
    latencyMs: result.latencyMs,
    remaining: rl.remaining,
    upgradeUrl: `/services`,
  });
}
