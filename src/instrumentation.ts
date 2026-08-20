/**
 * src/instrumentation.ts — Next.js server-boot hook (Edge-safe).
 *
 * This file runs in BOTH the Edge Runtime and the Node.js Runtime.
 * It must NOT import any Node.js-only modules (fs, path, process.cwd,
 * etc.) at the top level — those would break the Edge Runtime bundle.
 *
 * Solution: guard with `process.env.NEXT_RUNTIME` and use a dynamic
 * import() so Turbopack only follows the import chain for the Node
 * bundle, not the Edge bundle.
 *
 * The actual self-heal startup logic lives in `instrumentation-node.ts`,
 * which is dynamically imported here ONLY when running in Node.js.
 */
export async function register(): Promise<void> {
  // Skip during static build phase.
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  // Skip in Edge Runtime — only run in Node.js.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  try {
    // Dynamic import — Turbopack will NOT trace this for the Edge bundle
    // because it's behind the NEXT_RUNTIME guard.
    const mod = await import("./instrumentation-node");
    await mod.startNodeInstrumentation();
  } catch (err) {
    console.error("[instrumentation] failed to start self-heal:", err);
  }
}
