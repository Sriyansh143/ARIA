import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { updateNote, deleteNote } from "@/lib/notes";

export const dynamic = "force-dynamic";

/**
 * PUT /api/notes/[id]
 * Body: { title?, body?, tags?, pinned? }
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json();
    const result = await updateNote(id, {
      title: body?.title !== undefined ? String(body.title) : undefined,
      body: body?.body !== undefined ? String(body.body) : undefined,
      tags: Array.isArray(body?.tags) ? body.tags : undefined,
      pinned: body?.pinned !== undefined ? Boolean(body.pinned) : undefined,
    });
    if (!result.ok) {
      return NextResponse.json(
        { error: "note not found or update failed" },
        { status: 404 }
      );
    }
    return NextResponse.json(result);
  } catch (err) {
    logger.error("api.notes.update.failed", { error: String(err) });
    return NextResponse.json(
      { error: "failed to update note" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/notes/[id]
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const result = await deleteNote(id);
    if (!result.ok) {
      return NextResponse.json(
        { error: "note not found or delete failed" },
        { status: 404 }
      );
    }
    return NextResponse.json(result);
  } catch (err) {
    logger.error("api.notes.delete.failed", { error: String(err) });
    return NextResponse.json(
      { error: "failed to delete note" },
      { status: 500 }
    );
  }
}
