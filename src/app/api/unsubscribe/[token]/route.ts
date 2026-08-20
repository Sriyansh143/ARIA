import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/unsubscribe/[token] — public unsubscribe landing page.
 *
 * Token format: base64(email + ":" + sha256(email + ARIA_OWNER_EMAIL).slice(0, 16))
 * This is a weak token (no JWT) but sufficient for unsubscribe links — anyone who
 * has the email can unsubscribe, which is the intended behavior.
 *
 * Query params: ?email=... (the canonical email to suppress)
 *
 * Adds the email to the suppression list (Setting key="outreach.suppressedEmails")
 * + records a NotificationLog row for audit.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    const url = new URL(req.url);
    const email = url.searchParams.get("email") || "";

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return new NextResponse(
        renderHtml("Invalid unsubscribe link", "The email parameter is missing or invalid."),
        { status: 400, headers: { "Content-Type": "text/html; charset=utf-8" } },
      );
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Add to suppression list
    const existing = await db.setting.findUnique({
      where: { key: "outreach.suppressedEmails" },
    });
    const list: string[] = existing ? JSON.parse(existing.value || "[]") : [];
    if (!list.includes(normalizedEmail)) {
      list.push(normalizedEmail);
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

    // Audit log
    await db.notificationLog.create({
      data: {
        channel: "email",
        recipient: normalizedEmail,
        subject: `unsubscribe: ${normalizedEmail}`,
        body: `Unsubscribed via token ${token.slice(0, 16)}...`,
        status: "sent",
        provider: "unsubscribe-form",
        metadata: JSON.stringify({ type: "unsubscribe", email: normalizedEmail, token: token.slice(0, 32) }),
      },
    });

    return new NextResponse(
      renderHtml(
        "You're unsubscribed",
        `We've removed ${normalizedEmail} from our outreach list. You won't receive further emails from us. (Allow up to 24 hours for processing.)`,
      ),
      { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
  } catch (err) {
    return new NextResponse(
      renderHtml("Server error", "An error occurred while processing your unsubscribe request. Please reply to the email instead."),
      { status: 500, headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
  }
}

function renderHtml(title: string, message: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} — ARIA Mission Control</title>
  <style>
    body { margin:0; padding:0; background:#0a0e0f; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; color:#f0f4f3; }
    .container { max-width:560px; margin:80px auto; padding:32px; background:#141a1d; border:1px solid #2a3338; border-radius:12px; }
    h1 { margin:0 0 16px; font-size:22px; color:#10b981; }
    p { margin:0 0 12px; font-size:14px; line-height:1.6; color:#9ca3a3; }
    .footer { margin-top:32px; padding-top:16px; border-top:1px solid #2a3338; font-size:12px; color:#6b7280; }
  </style>
</head>
<body>
  <div class="container">
    <h1>${title}</h1>
    <p>${message}</p>
    <div class="footer">ARIA Mission Control · This is an automated unsubscribe page.</div>
  </div>
</body>
</html>`;
}
