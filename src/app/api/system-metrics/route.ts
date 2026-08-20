import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import os from "node:os";

export const dynamic = "force-dynamic";

/**
 * GET /api/system-metrics — real host + process metrics.
 *
 * Uses `systeminformation` (server-side only) to surface CPU, memory, disk,
 * network, OS, and Node.js process stats. Every block is independently
 * try/caught so a failure in one metric (e.g. disk on a read-only fs) does
 * not poison the entire payload — the failed field is returned as `null`.
 *
 * A 3-second timeout wrapper protects against `systeminformation` hanging
 * (some calls block on /proc reads in container sandboxes). If the wrapper
 * times out, the route returns whatever partial data it collected + a 200
 * so the UI can degrade gracefully.
 */
export async function GET() {
  const checkedAt = new Date().toISOString();

  // Partial containers — every field starts null and is filled in only if
  // the corresponding probe succeeds.
  const payload: {
    cpu: {
      manufacturer: string;
      brand: string;
      speed: string;
      cores: number;
      loadCurrent: number;
      loadCores: number[];
    } | null;
    memory: {
      total: number;
      used: number;
      active: number;
      available: number;
      usagePercent: number;
    } | null;
    disk: {
      total: number;
      used: number;
      available: number;
      usagePercent: number;
      fsType: string;
    } | null;
    network: {
      latencyMs: number;
      interfaces: string[];
    } | null;
    os: {
      platform: string;
      distro: string;
      release: string;
      hostname: string;
      uptime: number;
    } | null;
    process: {
      pid: number;
      memoryMB: number;
      cpuPercent: number;
      uptime: number;
    } | null;
    checkedAt: string;
  } = {
    cpu: null,
    memory: null,
    disk: null,
    network: null,
    os: null,
    process: null,
    checkedAt,
  };

  // Race the whole probe against a 3-second timeout. A flag tracks whether
  // the probe finished before the timeout fired, so we don't log a spurious
  // warning after every successful request.
  try {
    let probeDone = false;
    const probe = (async () => {
      // Lazy-import so the module-load cost is paid only when this route is
      // actually hit (and not at app boot). The `systeminformation` package
      // is server-only and heavy.
      const si = (await import("systeminformation")).default;

      // Run all 6 probes in parallel — each one is independently try/caught
      // below so a slow/blocking probe can't delay the others.
      await Promise.allSettled([
        // ─── CPU ────────────────────────────────────────────────────
        (async () => {
          try {
            const [cpuInfo, currentLoad] = await Promise.all([
              si.cpu(),
              si.currentLoad(),
            ]);
            const loadCores = (currentLoad.cpus ?? []).map((c) =>
              Math.round((c.load ?? 0) * 10) / 10
            );
            payload.cpu = {
              manufacturer: cpuInfo.manufacturer || "unknown",
              brand: cpuInfo.brand || "unknown",
              speed: cpuInfo.speed ? `${cpuInfo.speed} GHz` : "n/a",
              cores: cpuInfo.cores || 0,
              loadCurrent: Math.round((currentLoad.currentLoad ?? 0) * 10) / 10,
              loadCores,
            };
          } catch (err) {
            logger.warn("system-metrics: cpu probe failed", {
              error: err instanceof Error ? err.message : String(err),
            });
          }
        })(),

        // ─── Memory ────────────────────────────────────────────────
        (async () => {
          try {
            const mem = await si.mem();
            const usagePercent =
              mem.total > 0
                ? Math.round(((mem.active ?? mem.used) / mem.total) * 1000) / 10
                : 0;
            payload.memory = {
              total: mem.total,
              used: mem.used,
              active: mem.active,
              available: mem.available,
              usagePercent,
            };
          } catch (err) {
            logger.warn("system-metrics: memory probe failed", {
              error: err instanceof Error ? err.message : String(err),
            });
          }
        })(),

        // ─── Disk (root filesystem) ────────────────────────────────
        (async () => {
          try {
            const fsSize = await si.fsSize();
            const root =
              fsSize.find((f) => f.mount === "/" || f.mount === "/home") ??
              fsSize[0];
            if (root) {
              const usagePercent =
                root.size > 0
                  ? Math.round((root.used / root.size) * 1000) / 10
                  : 0;
              payload.disk = {
                total: root.size,
                used: root.used,
                available: root.size - root.used,
                usagePercent,
                fsType: (root as { type?: string }).type || "unknown",
              };
            }
          } catch (err) {
            logger.warn("system-metrics: disk probe failed", {
              error: err instanceof Error ? err.message : String(err),
            });
          }
        })(),

        // ─── Network interfaces (no external ping) ─────────────────
        (async () => {
          try {
            const t0 = Date.now();
            const interfaces = await si.networkInterfaces();
            const latencyMs = Date.now() - t0;
            const names = (interfaces ?? [])
              .filter((i) => i.operstate === "up" && !i.internal)
              .map((i) => i.iface)
              .slice(0, 8);
            payload.network = {
              latencyMs,
              interfaces: names.length > 0 ? names : ["loopback"],
            };
          } catch (err) {
            logger.warn("system-metrics: network probe failed", {
              error: err instanceof Error ? err.message : String(err),
            });
          }
        })(),

        // ─── OS + uptime ───────────────────────────────────────────
        // NOTE: `systeminformation` does not expose `si.uptime()` directly;
        // we use `si.osInfo()` for OS metadata and Node's built-in
        // `os.uptime()` for the host uptime (same source `si.time()` uses).
        (async () => {
          try {
            const osInfo = await si.osInfo();
            payload.os = {
              platform: osInfo.platform || "unknown",
              distro: osInfo.distro || "unknown",
              release: osInfo.release || "unknown",
              hostname: osInfo.hostname || "unknown",
              uptime: typeof os.uptime === "function" ? os.uptime() : 0,
            };
          } catch (err) {
            logger.warn("system-metrics: os probe failed", {
              error: err instanceof Error ? err.message : String(err),
            });
          }
        })(),

        // ─── Node.js process stats ─────────────────────────────────
        (async () => {
          try {
            const memRss = process.memoryUsage().rss;
            const memMB = Math.round((memRss / 1024 / 1024) * 10) / 10;
            const cpuPercent = Math.round((process.cpuUsage().user / 1e6) * 10) / 10;
            payload.process = {
              pid: process.pid,
              memoryMB: memMB,
              cpuPercent,
              uptime: Math.round(process.uptime()),
            };
          } catch (err) {
            logger.warn("system-metrics: process probe failed", {
              error: err instanceof Error ? err.message : String(err),
            });
          }
        })(),
      ]);

      probeDone = true;
    })();

    // 3-second ceiling. If the probe exceeds it, resolve with whatever the
    // partial payload contains. The setTimeout is cleared once the probe
    // completes so we don't log a spurious warning after a fast success.
    let timeoutId: NodeJS.Timeout | undefined;
    const timeout = new Promise<void>((resolve) => {
      timeoutId = setTimeout(() => {
        if (!probeDone) {
          logger.warn("system-metrics: probe timed out at 3s, returning partial");
        }
        resolve();
      }, 3000);
    });

    await Promise.race([probe, timeout]);
    if (timeoutId) clearTimeout(timeoutId);
  } catch (err) {
    logger.error("system-metrics: outer wrapper failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // v35: cache the result for 30 seconds. Previously every dashboard poll
  // (every 5s) triggered a fresh `systeminformation` probe which on Windows
  // can take 3-5s → log spam "probe timed out at 3s". The cache prevents this.
  const globalForMetrics = globalThis as unknown as { __ariaSysMetrics?: { data: unknown; at: number } };
  const CACHE_TTL_MS = 30_000;
  if (globalForMetrics.__ariaSysMetrics && Date.now() - globalForMetrics.__ariaSysMetrics.at < CACHE_TTL_MS) {
    return NextResponse.json(globalForMetrics.__ariaSysMetrics.data, {
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  }

  // Save to cache before returning.
  globalForMetrics.__ariaSysMetrics = { data: payload, at: Date.now() };

  return NextResponse.json(payload, {
    headers: {
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
