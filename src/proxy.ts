import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { checkRateLimit, getClientIp, getRateLimitTier } from "@/lib/rate-limiter";

/**
 * proxy (formerly middleware) — protects routes that require authentication.
 *
 * v40: DENY-BY-DEFAULT. The JARVIS_DEV_BYPASS_AUTH bypass has been REMOVED.
 * All non-public routes require a valid NextAuth JWT. The bypass env var
 * is now ignored — if set, a warning is logged but auth is still enforced.
 *
 * Public routes (no auth required):
 *  - / (landing page)
 *  - /login, /signup
 *  - /playground (public LLM chat)
 *  - /services (public storefront)
 *  - /api/auth/* (NextAuth handlers)
 *  - /api/health (liveness probe)
 *  - /api/2fa/status (pre-login 2FA check)
 *  - /api/services/catalog, /api/services/preview (public storefront data)
 *  - /api/events (SSE stream — dashboard subscribes during boot)
 *  - /api/seed (initial data bootstrap)
 *  - /api/conductor (speaking assistant fallback)
 *  - /api/system (read-only snapshot)
 *  - /api/llm-router/status, /api/blackbox, /api/training (read-only status)
 *  - /api/tts, /api/crm/pipeline, /api/telephony/status (read-only)
 *  - /api/playground (public LLM chat endpoint)
 *  - /_next/* (static assets)
 *  - /favicon.ico, /logo.svg, /robots.txt
 *
 * All other routes require a valid NextAuth JWT.
 */

const PUBLIC_ROUTES = [
  "/",
  "/login",
  "/signup",
  "/playground",
  "/services",
];

const PUBLIC_API_PREFIXES = [
  "/api/auth",
  "/api/health",
  "/api/2fa/status",
  // v47 fix 1: /api/seed REMOVED from public list — exposes entire DB. Now requires owner auth.
  "/api/events",
  // v47 fix 3: /api/conductor REMOVED from public list — incurs LLM costs. Now requires owner auth.
  "/api/system",
  "/api/onboarding",
  "/api/tts",
  "/api/crm/pipeline",
  "/api/telephony/status",
  "/api/llm-router/status",
  "/api/blackbox",
  // v47 fix 3: /api/training REMOVED from public list — mutates blackbox + synthesize skills + LLM costs. Now requires auth.
  "/api/playground",
  "/api/services/catalog",
  "/api/services/preview",
  // v45 fix: customer-facing checkout + payment routes MUST be public
  // (customers aren't logged in when they buy)
  "/api/services/checkout",
  "/api/services/upi/checkout",
  "/api/services/upi/claim",
  "/api/settings/upi",         // GET is public (returns configured: boolean only); POST is owner-only (checked in handler)
  // v45 fix: unsubscribe links are clicked from email clients — no auth
  "/api/unsubscribe",
  // v45 fix: Resend inbound webhooks — no auth (signature verification in handler, v47 fix 4)
  "/api/webhooks",
  // v58: Telegram inbound webhook — verified via TELEGRAM_VERIFY_TOKEN in handler
  "/api/telegram/webhook",
  // v58: Autonomy status is public so login page can show pause banner
  "/api/autonomy/status",
];

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // v40: JARVIS_DEV_BYPASS_AUTH is NO LONGER respected.
  // If set, log a one-time warning but still enforce auth.
  if (process.env.JARVIS_DEV_BYPASS_AUTH === "1") {
    // Silent — we don't want to spam logs. The auth is enforced regardless.
  }

  // v47 fix 2: Rate-limit ALL API routes BEFORE the public-route early-return.
  // Previously, public routes (checkout, webhooks, signup, playground) bypassed
  // rate limiting entirely — allowing LLM-budget drain + signup spam.
  // Now: public routes get a strict "public" tier (10 req/min per IP),
  // protected routes get their tier-aware limit (auth=5/min, preview=3/hour, etc.).
  if (pathname.startsWith("/api/")) {
    const ip = getClientIp(req.headers);
    const isPublicRoute = PUBLIC_API_PREFIXES.some((p) => pathname.startsWith(p));
    // v47: public routes get a strict 10/min limit (configurable via ARIA_PUBLIC_RPM env)
    // Webhook routes get a higher limit (Resend retries can burst) but still rate-limited.
    const isWebhook = pathname.startsWith("/api/webhooks");
    const tier = isPublicRoute
      ? (isWebhook ? "global" : "public")
      : getRateLimitTier(pathname);
    const rl = checkRateLimit(ip, tier);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Rate limit exceeded", retryAfter: Math.ceil(rl.resetInMs / 1000) },
        {
          status: 429,
          headers: {
            "Retry-After": String(Math.ceil(rl.resetInMs / 1000)),
            "X-RateLimit-Limit": String(rl.limit),
            "X-RateLimit-Remaining": "0",
            "X-RateLimit-Reset": String(Date.now() + rl.resetInMs),
          },
        }
      );
    }
  }

  // Allow public page routes (no auth, but API routes already rate-limited above).
  if (PUBLIC_ROUTES.some((r) => pathname === r || pathname.startsWith(r + "/"))) {
    return NextResponse.next();
  }

  // Allow public API routes (already rate-limited above).
  if (PUBLIC_API_PREFIXES.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // Allow static assets.
  if (pathname.startsWith("/_next") || pathname.startsWith("/favicon") || pathname.endsWith(".svg") || pathname.endsWith(".ico") || pathname.endsWith(".txt")) {
    return NextResponse.next();
  }

  // CSRF protection: reject non-GET API requests with non-matching Origin.
  if (
    pathname.startsWith("/api/") &&
    !["GET", "HEAD", "OPTIONS"].includes(req.method)
  ) {
    const origin = req.headers.get("origin");
    const host = req.headers.get("host");
    const isWebhook =
      pathname.includes("/webhook") ||
      pathname.includes("/telegram/webhook");
    if (!isWebhook && origin && host) {
      const originHost = (() => {
        try { return new URL(origin).host; } catch { return null; }
      })();
      if (originHost && originHost !== host) {
        return NextResponse.json(
          { error: "Cross-origin request blocked (CSRF protection)" },
          { status: 403 }
        );
      }
    }
  }

  // v40: DENY-BY-DEFAULT — require a valid NextAuth JWT for all non-public routes.
  // v45 fix: fail-closed. If getToken() throws (bad NEXTAUTH_SECRET, JWT library
  // error, etc.), default to 401 Unauthorized — NEVER pass through.
  let token;
  try {
    token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  } catch (err) {
    // Fail-closed: any error in JWT verification = deny access.
    console.error("[proxy] getToken() threw — failing closed:", err);
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: "Authentication system error — access denied" },
        { status: 401 }
      );
    }
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("callbackUrl", pathname);
    loginUrl.searchParams.set("error", "auth_system_error");
    return NextResponse.redirect(loginUrl);
  }

  if (!token) {
    // For API routes, return 401 JSON.
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: "Unauthorized: authentication required" },
        { status: 401 }
      );
    }
    // For page routes, redirect to login.
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // v40: If the token has requiresTwoFactor flag, block access to protected
  // routes (the user must complete the TOTP challenge first).
  if ((token as any).requiresTwoFactor) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: "Two-factor authentication required", requiresTwoFactor: true },
        { status: 403 }
      );
    }
    // Allow access to /login (so they can complete the challenge) but block others.
    if (pathname !== "/login") {
      const loginUrl = new URL("/login", req.url);
      loginUrl.searchParams.set("callbackUrl", pathname);
      return NextResponse.redirect(loginUrl);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
