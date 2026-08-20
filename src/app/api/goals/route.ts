import { NextRequest, NextResponse } from "next/server";
import { getGoals, saveGoals, updateGoalProgress, type Goal } from "@/lib/goals";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * GET /api/goals
 *
 * Returns the current goal list. If nothing is persisted in the Setting
 * table, a default set is derived from the live system snapshot.
 */
export async function GET() {
  try {
    const goals = await getGoals();
    return NextResponse.json({ goals, ok: true });
  } catch (err) {
    logger.error("api.goals.get.error", { error: String(err) });
    return NextResponse.json(
      { goals: [], ok: false, error: "failed to load goals" },
      { status: 500 },
    );
  }
}

/**
 * POST /api/goals
 *
 * Replace the entire goal list. Body: `{ goals: Goal[] }`.
 * Returns `{ ok: true }` on success.
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as { goals?: Goal[] };
    if (!Array.isArray(body.goals)) {
      return NextResponse.json(
        { ok: false, error: "missing `goals` array in body" },
        { status: 400 },
      );
    }
    await saveGoals(body.goals);
    return NextResponse.json({ ok: true });
  } catch (err) {
    logger.error("api.goals.post.error", { error: String(err) });
    return NextResponse.json(
      { ok: false, error: "failed to save goals" },
      { status: 500 },
    );
  }
}

/**
 * PATCH /api/goals
 *
 * Update a single goal's `current` value. Body: `{ id: string, current: number }`.
 * Returns `{ ok: true, goal: Goal }` (or 404 if the id is unknown).
 */
export async function PATCH(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      id?: string;
      current?: number;
    };
    if (!body.id || typeof body.current !== "number") {
      return NextResponse.json(
        { ok: false, error: "missing `id` or `current` in body" },
        { status: 400 },
      );
    }
    const goal = await updateGoalProgress(body.id, body.current);
    if (!goal) {
      return NextResponse.json(
        { ok: false, error: `goal ${body.id} not found` },
        { status: 404 },
      );
    }
    return NextResponse.json({ ok: true, goal });
  } catch (err) {
    logger.error("api.goals.patch.error", { error: String(err) });
    return NextResponse.json(
      { ok: false, error: "failed to update goal" },
      { status: 500 },
    );
  }
}
