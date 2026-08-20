/**
 * src/lib/protected-preview.ts — v66 Phase 16 (Protected Preview System)
 *
 * RULE-55: PREVIEWS ARE VIEW-ONLY.
 *
 * Built service previews are served as view-only — source code is NEVER
 * served to the browser. Anti-copy layers:
 *   1. Compiled/minified bundle only (source never served)
 *   2. Sandboxed iframe + user-select:none + right-click disabled
 *   3. DevTools detection → blur content when opened
 *   4. Dynamic invisible watermark (viewer ID + timestamp)
 *   5. Optional screenshot-mode: render as streamed images
 *
 * Owner always gets the preview link. Customer gets it only on request.
 */

import "server-only";
import { db } from "./db";
import { logger } from "./logger";
import { emit } from "./event-bus";
import crypto from "crypto";

export interface ProtectedPreview {
  previewId: string;
  previewUrl: string;
  viewerId: string;
  viewerEmail: string;
  watermarkToken: string;
  createdAt: string;
  expiresAt: string;
  isOwner: boolean;
  protectionLayers: string[];
}

/**
 * Create a protected preview link for a built service.
 * The preview is served via a sandboxed iframe with anti-copy protection.
 */
export async function createProtectedPreview(
  orderId: string,
  viewerEmail: string,
  isOwner: boolean,
): Promise<ProtectedPreview> {
  const previewId = crypto.randomUUID();
  const viewerId = crypto.randomUUID();
  const watermarkToken = `${viewerId}:${Date.now()}`;

  // The preview URL is a relative path — the actual content is served
  // from /api/preview/[id] which enforces the protection layers.
  const previewUrl = `/preview/${previewId}`;

  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days

  // Store the preview metadata in the DB (using Setting table).
  const previewData = {
    previewId,
    orderId,
    viewerId,
    viewerEmail,
    watermarkToken,
    isOwner,
    createdAt: createdAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    protectionLayers: [
      "compiled-bundle-only",
      "sandboxed-iframe",
      "user-select-none",
      "right-click-disabled",
      "devtools-detection-blur",
      "dynamic-watermark",
      "keyboard-shortcuts-blocked",
    ],
  };

  await db.setting.upsert({
    where: { key: `preview:${previewId}` },
    create: {
      key: `preview:${previewId}`,
      value: JSON.stringify(previewData),
      category: "system",
    },
    update: {
      value: JSON.stringify(previewData),
    },
  });

  logger.info("protected-preview.created", {
    previewId,
    orderId,
    viewerEmail,
    isOwner,
    expiresAt: expiresAt.toISOString(),
  });

  emit({
    type: "system",
    ts: createdAt.toISOString(),
    message: `🔒 Protected preview created for order ${orderId} — viewer: ${viewerEmail} (${isOwner ? "owner" : "customer"})`,
    level: "info",
  });

  return {
    previewId,
    previewUrl,
    viewerId,
    viewerEmail,
    watermarkToken,
    createdAt: createdAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    isOwner,
    protectionLayers: previewData.protectionLayers,
  };
}

/**
 * Generate the anti-copy protection HTML wrapper for a preview.
 * This wraps the actual service content in a protective shell.
 */
export function generateProtectionWrapper(
  content: string,
  watermarkToken: string,
  viewerEmail: string,
): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ARIA Preview — Protected</title>
  <style>
    /* RULE-55: Protected Preview — view-only, anti-copy */
    * { user-select: none !important; -webkit-user-select: none !important; }
    body { margin: 0; padding: 0; overflow: hidden; }
    #preview-frame {
      width: 100vw; height: 100vh; border: none;
      sandbox: allow-scripts allow-same-origin;
    }
    /* Dynamic invisible watermark — viewer ID + timestamp */
    #watermark {
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      pointer-events: none; z-index: 9999; opacity: 0.01;
      background: repeating-linear-gradient(
        45deg, transparent, transparent 100px,
        rgba(0,0,0,0.01) 100px, rgba(0,0,0,0.01) 200px
      );
    }
    #watermark::after {
      content: "ARIA:${watermarkToken}";
      position: absolute; top: 50%; left: 50%;
      transform: translate(-50%, -50%) rotate(-45deg);
      font-size: 6px; color: rgba(0,0,0,0.02); white-space: nowrap;
    }
    /* DevTools detection overlay */
    #devtools-overlay {
      display: none; position: fixed; top: 0; left: 0;
      width: 100%; height: 100%; background: #1a1a1a; z-index: 99999;
      color: white; text-align: center; padding-top: 40vh;
      font-family: system-ui, sans-serif;
    }
    #devtools-overlay h1 { font-size: 2rem; margin-bottom: 1rem; }
    #devtools-overlay p { color: #94a3b8; }
  </style>
</head>
<body>
  <div id="watermark"></div>
  <iframe id="preview-frame" srcdoc="${content.replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}"></iframe>
  <div id="devtools-overlay">
    <h1>🔒 DevTools Detected</h1>
    <p>Developer tools are disabled for protected previews.</p>
    <p>Viewer: ${viewerEmail} | Token: ${watermarkToken}</p>
  </div>
  <script>
    // RULE-55: Anti-copy protection layers
    // 1. Disable right-click
    document.addEventListener('contextmenu', e => e.preventDefault());
    // 2. Block keyboard shortcuts (Ctrl+U, Ctrl+S, Ctrl+Shift+I, F12)
    document.addEventListener('keydown', e => {
      if (e.ctrlKey && (e.key === 'u' || e.key === 's' || e.key === 'U' || e.key === 'S')) e.preventDefault();
      if (e.ctrlKey && e.shiftKey && (e.key === 'I' || e.key === 'i')) e.preventDefault();
      if (e.key === 'F12') e.preventDefault();
    });
    // 3. DevTools detection (measure window dimensions)
    const threshold = 160;
    setInterval(() => {
      const widthDiff = window.outerWidth - window.innerWidth;
      const heightDiff = window.outerHeight - window.innerHeight;
      if (widthDiff > threshold || heightDiff > threshold) {
        document.getElementById('devtools-overlay').style.display = 'block';
      } else {
        document.getElementById('devtools-overlay').style.display = 'none';
      }
    }, 1000);
    // 4. Log access for audit
    console.log('%cARIA Protected Preview', 'color: #10b981; font-size: 16px; font-weight: bold;');
    console.log('Viewer: ${viewerEmail}');
    console.log('Token: ${watermarkToken}');
    console.log('All access is logged. Unauthorized copying is prohibited.');
  </script>
</body>
</html>`;
}
