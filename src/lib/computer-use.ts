/**
 * src/lib/computer-use.ts — screen capture + VLM action (graceful degrade).
 *
 * Server-only. Provides three primitives:
 *
 *   - captureScreen()    : try to grab the display via `screenshot-desktop`.
 *                           Returns `{status:"unsupported"}` if the optional
 *                           dependency is missing.
 *   - analyzeScreen()    : send the captured frame to the Z-AI VLM with a
 *                           natural-language question. Uses dynamic import
 *                           of `z-ai-web-dev-sdk` (server-only).
 *   - executeAction()    : try to drive the GUI via `@nut-tree-fork/nut-js`.
 *                           Returns `{status:"unsupported"}` if unavailable.
 *
 * Every function tolerates missing optional deps and never throws to the
 * caller — failures return `{status:"unsupported", ok:false, error}`.
 */

import { logger } from "./logger";

// Optional native deps — referenced via dynamic `import().catch(() => null)`
// at runtime. We declare ambient module shims so the TS compiler doesn't
// fail when the packages aren't installed.
//
// IMPORTANT: `declare module "x" {}` requires the module to NOT exist;
// if the user later installs the package, TS will use the real types.
// We use `// @ts-ignore` on the actual import() calls instead.

export interface ScreenCaptureResult {
  ok: boolean;
  base64?: string;
  status: "supported" | "unsupported";
  error?: string;
}

export interface ScreenAnalysisResult {
  answer: string;
  status: "ok" | "unsupported" | "error";
  error?: string;
}

export interface ExecuteActionResult {
  ok: boolean;
  status: "ok" | "unsupported" | "error";
  error?: string;
}

export interface ComputerUseAction {
  type: "click" | "type" | "key";
  x?: number;
  y?: number;
  text?: string;
}

// ─── captureScreen ──────────────────────────────────────────────────

export async function captureScreen(): Promise<ScreenCaptureResult> {
  try {
    // v60 fix: use a variable specifier so Turbopack doesn't try to resolve the
    // optional dep at build time. The .catch() returns null at runtime if missing.
    const moduleName = "screenshot-desktop";
    const mod: any = await import(/* webpackIgnore: true */ moduleName).catch(() => null);
    if (!mod || typeof mod.default !== "function") {
      return { ok: false, status: "unsupported", error: "screenshot-desktop not installed" };
    }
    const screenshot = (mod as unknown as { default: (opts?: unknown) => Promise<Buffer> }).default;
    const buf = await screenshot({ format: "png" });
    return {
      ok: true,
      base64: buf.toString("base64"),
      status: "supported",
    };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    logger.warn("computer-use.capture.unsupported", { error: detail });
    return { ok: false, status: "unsupported", error: detail };
  }
}

// ─── analyzeScreen ──────────────────────────────────────────────────

export async function analyzeScreen(
  base64: string,
  question: string
): Promise<ScreenAnalysisResult> {
  try {
    const ZAI = (await import("z-ai-web-dev-sdk")).default;
    const zai = await ZAI.create();
    const res = await zai.chat.completions.create({
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: { url: `data:image/png;base64,${base64}` },
            },
            { type: "text", text: question },
          ] as unknown as string,
        },
      ],
    });
    const answer =
      (res as { choices?: Array<{ message?: { content?: string } }> })
        .choices?.[0]?.message?.content ?? "";
    return { answer, status: "ok" };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    logger.error("computer-use.analyze.failed", { error: detail });
    return { answer: "", status: "error", error: detail };
  }
}

// ─── executeAction ──────────────────────────────────────────────────

export async function executeAction(
  action: ComputerUseAction
): Promise<ExecuteActionResult> {
  try {
    // v60 fix: variable specifier so Turbopack doesn't try to resolve at build time.
    const moduleName = "@nut-tree-fork/nut-js";
    const mod: any = await import(/* webpackIgnore: true */ moduleName).catch(() => null);
    if (!mod) {
      return {
        ok: false,
        status: "unsupported",
        error: "@nut-tree-fork/nut-js not installed",
      };
    }
    const { mouse, keyboard, Point } = mod as {
      mouse: {
        setPosition: (p: { x: number; y: number }) => Promise<void>;
        leftClick: () => Promise<void>;
      };
      keyboard: { type: (text: string) => Promise<void>; pressKey: (k: unknown) => Promise<void> };
      Point: new (x: number, y: number) => { x: number; y: number };
    };

    if (action.type === "click") {
      if (action.x === undefined || action.y === undefined) {
        return { ok: false, status: "error", error: "click requires x,y" };
      }
      await mouse.setPosition(new Point(action.x, action.y));
      await mouse.leftClick();
    } else if (action.type === "type") {
      if (!action.text) {
        return { ok: false, status: "error", error: "type requires text" };
      }
      await keyboard.type(action.text);
    } else if (action.type === "key") {
      if (!action.text) {
        return { ok: false, status: "error", error: "key requires text (key name)" };
      }
      // nut-js exposes Key enum; we accept the string name and look it up.
      const KeyEnum = (mod as { Key?: Record<string, unknown> }).Key;
      const key = KeyEnum?.[action.text.toUpperCase()];
      if (!key) {
        return { ok: false, status: "error", error: `unknown key: ${action.text}` };
      }
      await keyboard.pressKey(key);
    } else {
      return { ok: false, status: "error", error: `unknown action type: ${action.type}` };
    }
    return { ok: true, status: "ok" };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    logger.error("computer-use.execute.failed", { error: detail });
    return { ok: false, status: "error", error: detail };
  }
}
