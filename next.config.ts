import type { NextConfig } from "next";

const publicUrl = process.env.ARIA_PUBLIC_URL || "http://localhost:3000";
const isProd = process.env.NODE_ENV === "production";

// Extract the origin for CSP/CORS (strip path, keep protocol+host)
let publicOrigin = publicUrl;
try {
  const u = new URL(publicUrl);
  publicOrigin = `${u.protocol}//${u.host}`;
} catch {
  // keep default
}

const nextConfig: NextConfig = {
  output: "standalone",
  typescript: {
    ignoreBuildErrors: process.env.NODE_ENV !== "production",
  },
  reactStrictMode: false,
  allowedDevOrigins: [
    "*.space-z.ai",
    "localhost",
    "0.0.0.0",
    "127.0.0.1",
    // v76.2: Allow LAN access — the owner's machine IP so other devices
    // on the same network can access the dev server.
    "192.168.29.209",
    "192.168.0.*",
    "192.168.1.*",
    "192.168.29.*",
    "10.0.0.*",
  ],
  // v60 fix: silence the "Next.js inferred your workspace root" warning.
  turbopack: {
    root: __dirname,
  },
  // v60 fix: mark optional deps as server-external so Turbopack doesn't
  // try to bundle them (they're dynamically imported + .catch()'d at runtime).
  serverExternalPackages: [
    "@nut-tree-fork/nut-js",
    "@sentry/node",
    "screenshot-desktop",
    "sharp",
    "systeminformation",
  ],
  // v42: Security headers — CSP, HSTS, X-Frame-Options, etc.
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=()" },
          // v42: HSTS — only in production (breaks localhost dev otherwise)
          ...(isProd
            ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains; preload" }]
            : []),
          // v42: DNS prefetch control
          { key: "X-DNS-Prefetch-Control", value: "off" },
          // v42: CSP — strict, env-var-driven
          // Allows: self, inline styles (Next.js needs this), Google Fonts (Geist),
          // api.qrserver.com (2FA QR codes), data: URIs (base64 images), blob: (screen capture)
          {
            key: "Content-Security-Policy",
            value: [
              `default-src 'self'`,
              `script-src 'self' 'unsafe-inline' 'unsafe-eval'`,
              `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`,
              `font-src 'self' data: https://fonts.gstatic.com`,
              `img-src 'self' data: blob: https://api.qrserver.com ${publicOrigin}`,
              `connect-src 'self' ${publicOrigin} https://api.groq.com https://integrate.api.nvidia.com http://127.0.0.1:11434 http://localhost:11434`,
              `media-src 'self' blob:`,
              `frame-ancestors 'none'`,
              `base-uri 'self'`,
              `form-action 'self'`,
            ].join("; "),
          },
          // v42: CORS — only allow the configured public origin
          {
            key: "Access-Control-Allow-Origin",
            value: publicOrigin,
          },
          {
            key: "Access-Control-Allow-Methods",
            value: "GET, POST, PATCH, PUT, DELETE, OPTIONS",
          },
          {
            key: "Access-Control-Allow-Headers",
            value: "Content-Type, Authorization, X-CSRF-Token",
          },
          {
            key: "Access-Control-Allow-Credentials",
            value: "true",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
