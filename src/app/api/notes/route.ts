import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { listNotes, createNote } from "@/lib/notes";

export const dynamic = "force-dynamic";

/**
 * GET /api/notes?tag=foo&pinned=true&limit=50
 */
export async function GET(req: NextRequest) {
  try {
    const tag = req.nextUrl.searchParams.get("tag") ?? undefined;
    const pinnedRaw = req.nextUrl.searchParams.get("pinned");
    const limitRaw = req.nextUrl.searchParams.get("limit");
    const pinned =
      pinnedRaw === "true" ? true : pinnedRaw === "false" ? false : undefined;
    const limit = limitRaw ? parseInt(limitRaw, 10) : 50;
    const notes = await listNotes({
      tag,
      pinned,
      limit: Number.isFinite(limit) ? limit : 50,
    });
    return NextResponse.json({ notes, count: notes.length });
  } catch (err) {
    logger.error("api.notes.list.failed", { error: String(err) });
    return NextResponse.json(
      { error: "failed to list notes" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/notes
 * Body: { title, body, tags?, pinned?, authorAgent? }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (!body?.title) {
      return NextResponse.json(
        { error: "title required" },
        { status: 400 }
      );
    }
    const result = await createNote({
      title: String(body.title),
      body: String(body.body ?? ""),
      tags: Array.isArray(body.tags) ? body.tags : [],
      pinned: Boolean(body.pinned ?? false),
      authorAgent: body.authorAgent ? String(body.authorAgent) : undefined,
    });
    return NextResponse.json(result);
  } catch (err) {
    logger.error("api.notes.create.failed", { error: String(err) });
    return NextResponse.json(
      { error: "failed to create note" },
      { status: 500 }
    );
  }
}
