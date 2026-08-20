import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * POST /api/image-gen
 * Body: { prompt: string, size?: string }
 *
 * Uses the z-ai-web-dev-sdk `images.generations.create` API (server-only).
 * Returns `{ url, status:"ok" }` on success or
 * `{ status:"unsupported", error }` if the SDK isn't configured.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (!body?.prompt || typeof body.prompt !== "string") {
      return NextResponse.json(
        { error: "prompt required" },
        { status: 400 }
      );
    }

    const ZAI = (await import("z-ai-web-dev-sdk")).default;
    const zai = await ZAI.create();

    const size = body.size ? String(body.size) : "1024x1024";

    const result = await (zai as {
      images: {
        generations: {
          create: (opts: {
            prompt: string;
            size?: string;
          }) => Promise<{ data?: Array<{ url?: string }> }>;
        };
      };
    }).images.generations.create({
      prompt: body.prompt,
      size,
    });

    const url = result.data?.[0]?.url;
    if (!url) {
      return NextResponse.json(
        { status: "unsupported", error: "no image url returned" },
        { status: 502 }
      );
    }

    logger.success("api.image-gen.created", { prompt: body.prompt.slice(0, 40) });
    return NextResponse.json({ url, status: "ok" });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    logger.error("api.image-gen.failed", { error: detail });
    return NextResponse.json(
      { status: "unsupported", error: detail },
      { status: 500 }
    );
  }
}
