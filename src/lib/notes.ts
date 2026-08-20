/**
 * src/lib/notes.ts — owner/agent notes CRUD on db.note.
 *
 * Server-only. Plain-text notes with optional tags (JSON array),
 * pinning, and an author agent id. Used by the dashboard's
 * NotesPanel for the owner's scratchpad + agent-posted observations.
 */

import type { Note } from "@prisma/client";
import { db } from "./db";
import { logger } from "./logger";

export interface ListNotesInput {
  tag?: string;
  pinned?: boolean;
  limit?: number;
}

export interface CreateNoteInput {
  title: string;
  body: string;
  tags?: string[];
  pinned?: boolean;
  authorAgent?: string;
}

export interface UpdateNoteInput {
  title?: string;
  body?: string;
  tags?: string[];
  pinned?: boolean;
}

// ─── listNotes ──────────────────────────────────────────────────────

export async function listNotes(input: ListNotesInput = {}): Promise<Note[]> {
  try {
    const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
    const rows = await db.note.findMany({
      where: {
        ...(input.pinned !== undefined ? { pinned: input.pinned } : {}),
      },
      orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }],
      take: limit,
    });
    if (!input.tag) return rows;
    // Filter by tag in-app (SQLite JSON ops are clunky).
    return rows.filter((r) => {
      try {
        const tags: string[] = JSON.parse(r.tags ?? "[]");
        return tags.includes(input.tag!);
      } catch {
        return false;
      }
    });
  } catch (err) {
    logger.error("notes.list.failed", { error: String(err) });
    return [];
  }
}

// ─── createNote ─────────────────────────────────────────────────────

export async function createNote(input: CreateNoteInput): Promise<{ id: string }> {
  try {
    const row = await db.note.create({
      data: {
        title: input.title,
        body: input.body,
        tags: JSON.stringify(input.tags ?? []),
        pinned: input.pinned ?? false,
        authorAgent: input.authorAgent ?? null,
      },
    });
    logger.success("notes.created", { id: row.id });
    return { id: row.id };
  } catch (err) {
    logger.error("notes.create.failed", { error: String(err) });
    throw err;
  }
}

// ─── updateNote ─────────────────────────────────────────────────────

export async function updateNote(
  id: string,
  input: UpdateNoteInput
): Promise<{ ok: boolean }> {
  try {
    const data: Record<string, unknown> = {};
    if (input.title !== undefined) data.title = input.title;
    if (input.body !== undefined) data.body = input.body;
    if (input.tags !== undefined) data.tags = JSON.stringify(input.tags);
    if (input.pinned !== undefined) data.pinned = input.pinned;
    await db.note.update({ where: { id }, data });
    return { ok: true };
  } catch (err) {
    logger.error("notes.update.failed", { id, error: String(err) });
    return { ok: false };
  }
}

// ─── deleteNote ─────────────────────────────────────────────────────

export async function deleteNote(id: string): Promise<{ ok: boolean }> {
  try {
    await db.note.delete({ where: { id } });
    return { ok: true };
  } catch (err) {
    logger.error("notes.delete.failed", { id, error: String(err) });
    return { ok: false };
  }
}

// ─── pinNote ────────────────────────────────────────────────────────

export async function pinNote(id: string, pinned: boolean): Promise<{ ok: boolean }> {
  try {
    await db.note.update({ where: { id }, data: { pinned } });
    return { ok: true };
  } catch (err) {
    logger.error("notes.pin.failed", { id, error: String(err) });
    return { ok: false };
  }
}
