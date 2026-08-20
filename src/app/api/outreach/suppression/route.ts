import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuthOrResponse } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/outreach/suppression — owner-only. Returns the suppression list + blocked-today count.
 */
export async function GET(req: NextRequest) {
  try {
    const auth = await requireAuthOrResponse("GET", "/api/outreach/suppression");
    if (auth) return auth;

    const setting = await db.setting.findUnique({
      where: { key: "outreach.suppressedEmails" },
    });
    const emails: string[] = setting ? JSON.parse(setting.value || "[]") : [];

    // Count how many tasks were skipped today due to suppression or daily limit
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const skippedToday = await db.task.count({
      where: {
        kind: "follow_up",
        status: "completed",
        completedAt: { gte: todayStart },
        result: { contains: "suppressed" },
      },
    });
    const dailyLimitHits = await db.task.count({
      where: {
        kind: "follow_up",
        status: "completed",
        completedAt: { gte: todayStart },
        result: { contains: "daily limit reached" },
      },
    });

    return NextResponse.json({
      emails,
      count: emails.length,
      blockedToday: {
        suppression: skippedToday,
        dailyLimit: dailyLimitHits,
        total: skippedToday + dailyLimitHits,
      },
    });
  } catch (err) {
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}

/**
 * POST /api/outreach/suppression — owner-only. Add an email to the suppression list.
 * Body: { email, reason? }
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuthOrResponse("POST", "/api/outreach/suppression");
    if (auth) return auth;

    const body = await req.json().catch(() => ({}));
    const email = String(body.email || "").toLowerCase().trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: "valid email required" }, { status: 400 });
    }

    const setting = await db.setting.findUnique({
      where: { key: "outreach.suppressedEmails" },
    });
    const list: string[] = setting ? JSON.parse(setting.value || "[]") : [];
    if (!list.includes(email)) {
      list.push(email);
      await db.setting.upsert({
        where: { key: "outreach.suppressedEmails" },
        create: {
          key: "outreach.suppressedEmails",
          value: JSON.stringify(list),
          category: "outreach",
        },
        update: { value: JSON.stringify(list) },
      });
    }

    return NextResponse.json({ ok: true, email, count: list.length });
  } catch (err) {
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}

/**
 * DELETE /api/outreach/suppression — owner-only. Remove an email from the suppression list.
 * Body: { email }
 */
export async function DELETE(req: NextRequest) {
  try {
    const auth = await requireAuthOrResponse("DELETE", "/api/outreach/suppression");
    if (auth) return auth;

    const body = await req.json().catch(() => ({}));
    const email = String(body.email || "").toLowerCase().trim();
    if (!email) {
      return NextResponse.json({ error: "email required" }, { status: 400 });
    }

    const setting = await db.setting.findUnique({
      where: { key: "outreach.suppressedEmails" },
    });
    const list: string[] = setting ? JSON.parse(setting.value || "[]") : [];
    const filtered = list.filter((e) => e !== email);

    await db.setting.upsert({
      where: { key: "outreach.suppressedEmails" },
      create: {
        key: "outreach.suppressedEmails",
        value: JSON.stringify(filtered),
        category: "outreach",
      },
      update: { value: JSON.stringify(filtered) },
    });

    return NextResponse.json({ ok: true, email, count: filtered.length });
  } catch (err) {
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
