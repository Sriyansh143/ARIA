import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { emit } from "@/lib/event-bus";
import { serializeAgent } from "@/lib/simulation";
import { toIso, parseJsonArray, type Task, type TaskPriority, type TaskKind } from "@/lib/types";
import { parsePagination, paginatedResponse } from "@/lib/pagination";
import { z } from "zod";

export const dynamic = "force-dynamic";

const CreateTaskSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional().nullable(),
  priority: z.enum(["low", "medium", "high", "critical"]).default("medium"),
  kind: z.enum(["work", "tool_call", "research", "review", "decision"]).default("work"),
  assignedToId: z.string().optional().nullable(),
  dependsOn: z.array(z.string()).default([]),
});

/**
 * Map a raw DB task row (with Prisma types) to the API `Task` contract
 * (with string datetimes + parsed JSON `dependsOn`). Centralised so the
 * GET list and POST create paths produce identical payloads.
 */
function serializeTask(
  row: {
    id: string;
    title: string;
    description: string | null;
    status: string;
    priority: string;
    assignedToId: string | null;
    dependsOn: string | null;
    result: string | null;
    progress: number;
    kind: string;
    createdAt: Date;
    startedAt: Date | null;
    completedAt: Date | null;
    updatedAt: Date;
    assignedTo?: unknown;
  }
): Task {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status as Task["status"],
    priority: row.priority as TaskPriority,
    assignedToId: row.assignedToId,
    dependsOn: parseJsonArray<string>(row.dependsOn, []),
    result: row.result,
    progress: row.progress,
    kind: row.kind as TaskKind,
    createdAt: toIso(row.createdAt)!,
    startedAt: toIso(row.startedAt),
    completedAt: toIso(row.completedAt),
    updatedAt: toIso(row.updatedAt)!,
    assignedTo: row.assignedTo ? serializeAgent(row.assignedTo as never) : null,
  };
}

/**
 * GET /api/tasks — list tasks in the pipeline.
 *
 * Supports optional query params for filtering + pagination:
 *   ?status=pending|running|completed|failed|blocked
 *   ?assignedToId=<agentId>
 *   ?limit=50  (capped to 200) — backward-compat cap; ignored when ?page= is present
 *   ?page=1    — when present, response uses the paginated envelope:
 *                  { data, pagination: { page, limit, total, totalPages, hasMore } }
 *                when absent, response is the legacy { tasks, count } envelope.
 *
 * Returns newest-first by default. Used by the central registry + any
 * future "task list" admin views.
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl;
    const status = searchParams.get("status");
    const assignedToId = searchParams.get("assignedToId");
    const hasPage = searchParams.has("page");

    // Build a strongly-typed where clause — only include keys that have
    // a non-null filter value so we don't accidentally match `null`.
    const where: { status?: string; assignedToId?: string } = {};
    if (status) where.status = status;
    if (assignedToId) where.assignedToId = assignedToId;

    if (hasPage) {
      const { take, skip, page, limit } = parsePagination(req);
      const [rows, total] = await Promise.all([
        db.task.findMany({
          where,
          include: { assignedTo: true },
          orderBy: { createdAt: "desc" },
          take,
          skip,
        }),
        db.task.count({ where }),
      ]);
      const tasks = rows.map(serializeTask);
      return NextResponse.json(paginatedResponse<Task>(tasks, total, page, limit));
    }

    // Legacy path (no ?page=) — return all (cap at 200) with the
    // original envelope so existing callers don't break.
    const limitRaw = searchParams.get("limit");
    const limit = Math.min(Math.max(parseInt(limitRaw ?? "50", 10) || 50, 1), 200);

    const rows = await db.task.findMany({
      where,
      include: { assignedTo: true },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    const tasks = rows.map(serializeTask);
    return NextResponse.json({ tasks, count: tasks.length });
  } catch (err) {
    return NextResponse.json(
      { error: "failed to list tasks", detail: String(err) },
      { status: 500 },
    );
  }
}

/**
 * POST /api/tasks
 *
 * Creates a new task in the pipeline and broadcasts a `task.update` event
 * so every connected client renders it immediately. The body is validated
 * through zod — malformed payloads are rejected with a 400, never crash.
 */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const result = CreateTaskSchema.safeParse(body);
  if (!result.success) {
    return NextResponse.json(
      { error: "validation failed", issues: result.error.issues },
      { status: 400 }
    );
  }

  const { title, description, priority, kind, assignedToId, dependsOn } = result.data;

  // Validate assignee exists if provided.
  if (assignedToId) {
    const agent = await db.agent.findUnique({ where: { id: assignedToId } });
    if (!agent) {
      return NextResponse.json({ error: "assignee not found" }, { status: 404 });
    }
  }

  const created = await db.task.create({
    data: {
      title,
      description: description ?? null,
      priority: priority as TaskPriority,
      kind: kind as TaskKind,
      assignedToId: assignedToId ?? null,
      dependsOn: JSON.stringify(dependsOn),
      status: "pending",
      progress: 0,
    },
    include: { assignedTo: true },
  });

  const payload = serializeTask(created);

  emit({ type: "task.update", ts: new Date().toISOString(), task: payload });

  return NextResponse.json({ ok: true, task: payload }, { status: 201 });
}
