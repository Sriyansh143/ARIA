import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/notifications/subscribe — register a browser push subscription.
 * Body: { endpoint, keys: { p256dh, auth } }
 *
 * Auth required — only the owner should subscribe to push notifications.
 * The subscription is persisted to WebPushSubscription table (survives restarts).
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth();

    const body = await req.json().catch(() => ({}));
    const endpoint = String(body.endpoint || "").trim();
    const p256dh = String(body.keys?.p256dh || "").trim();
    const auth = String(body.keys?.auth || "").trim();

    if (!endpoint || !p256dh || !auth) {
      return NextResponse.json(
        { error: "endpoint, keys.p256dh, keys.auth are required" },
        { status: 400 },
      );
    }

    // Upsert by endpoint (unique) — if the browser re-subscribes, update the keys.
    const sub = await db.webPushSubscription.upsert({
      where: { endpoint },
      create: {
        endpoint,
        p256dh,
        auth,
        userId: user.id,
      },
      update: {
        p256dh,
        auth,
        userId: user.id,
        updatedAt: new Date(),
      },
    });

    return NextResponse.json({ ok: true, id: sub.id });
  } catch (err) {
    if (err instanceof Error && err.message.includes("Not authenticated")) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}

/**
 * DELETE /api/notifications/subscribe — unregister a browser push subscription.
 * Body: { endpoint }
 */
export async function DELETE(req: NextRequest) {
  try {
    await requireAuth();

    const body = await req.json().catch(() => ({}));
    const endpoint = String(body.endpoint || "").trim();
    if (!endpoint) {
      return NextResponse.json({ error: "endpoint required" }, { status: 400 });
    }

    await db.webPushSubscription.deleteMany({ where: { endpoint } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && err.message.includes("Not authenticated")) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}

/**
 * GET /api/notifications/subscribe — list active subscriptions (for the dashboard).
 */
export async function GET(req: NextRequest) {
  try {
    await requireAuth();
    const subs = await db.webPushSubscription.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
      select: { id: true, endpoint: true, userId: true, createdAt: true, updatedAt: true },
    });
    return NextResponse.json({ subscriptions: subs, count: subs.length });
  } catch (err) {
    if (err instanceof Error && err.message.includes("Not authenticated")) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
