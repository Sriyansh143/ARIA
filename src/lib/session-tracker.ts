/**
 * session-tracker.ts — Tracks when the app starts/stops + catches up on missed cron jobs.
 *
 * On startup:
 *   1. Records the start time.
 *   2. Checks the last shutdown time.
 *   3. If any cron jobs were missed (lastRun is older than their schedule),
 *      triggers them immediately (catch-up).
 *   4. Schedules daily jobs after 10 AM (not 2 AM) per user request.
 */

import { db } from '@/lib/db';

export async function recordStartup(): Promise<void> {
  // Record startup time
  await db.memoryItem.upsert({
    where: { key_scope: { key: 'last-startup', scope: 'semantic' } },
    update: { value: new Date().toISOString(), pinned: true },
    create: {
      key: 'last-startup',
      scope: 'semantic',
      value: new Date().toISOString(),
      tags: JSON.stringify(['system', 'startup']),
      pinned: true,
    },
  }).catch(() => {});
}

export async function recordShutdown(): Promise<void> {
  await db.memoryItem.upsert({
    where: { key_scope: { key: 'last-shutdown', scope: 'semantic' } },
    update: { value: new Date().toISOString(), pinned: true },
    create: {
      key: 'last-shutdown',
      scope: 'semantic',
      value: new Date().toISOString(),
      tags: JSON.stringify(['system', 'shutdown']),
      pinned: true,
    },
  }).catch(() => {});
}

export async function getLastStartup(): Promise<Date | null> {
  const item = await db.memoryItem.findFirst({
    where: { key: 'last-startup', scope: 'semantic' },
  });
  if (!item?.value) return null;
  try { return new Date(item.value); } catch { return null; }
}

export async function getLastShutdown(): Promise<Date | null> {
  const item = await db.memoryItem.findFirst({
    where: { key: 'last-shutdown', scope: 'semantic' },
  });
  if (!item?.value) return null;
  try { return new Date(item.value); } catch { return null; }
}

/**
 * On startup, check for cron jobs that were missed while the app was down.
 * Returns the list of cron keys that should be run immediately.
 */
export async function getMissedCronJobs(): Promise<string[]> {
  const lastStartup = await getLastStartup();
  const lastShutdown = await getLastShutdown();

  if (!lastStartup) return []; // First run ever

  // If there was a shutdown, check what was missed between shutdown and startup
  const checkFrom = lastShutdown || new Date(Date.now() - 24 * 60 * 60 * 1000); // Default: 24h ago

  const cronJobs = await db.cronJob.findMany({
    where: { enabled: true },
  });

  const missed: string[] = [];
  const now = new Date();

  for (const job of cronJobs) {
    if (!job.lastRun) {
      // Never run — include in catch-up
      missed.push(job.key);
      continue;
    }

    // Parse the cron schedule to estimate the expected interval
    // Simple heuristic: if lastRun is more than 2x the schedule interval, it was missed
    const schedule = job.schedule;
    let intervalMs = 0;

    if (schedule.startsWith('*/')) {
      // */N * * * * → every N minutes
      const match = schedule.match(/\*\/(\d+)/);
      if (match) intervalMs = parseInt(match[1]) * 60 * 1000;
    } else if (schedule.includes(' ')) {
      // Daily job (0 H * * *) → 24h
      intervalMs = 24 * 60 * 60 * 1000;
    }

    if (intervalMs > 0) {
      const timeSinceLastRun = now.getTime() - job.lastRun.getTime();
      if (timeSinceLastRun > intervalMs * 2) {
        missed.push(job.key);
      }
    }
  }

  return missed;
}

/**
 * Check if current time is within working hours (10 AM - 11 PM).
 * Jobs scheduled for 2 AM, 3 AM, etc. should be deferred to 10 AM.
 */
export function isWorkingHours(): boolean {
  const hour = new Date().getHours();
  return hour >= 10 && hour < 23; // 10 AM to 11 PM
}

/**
 * Should a cron job run now?
 * - If it's a high-frequency job (every 5-30 min): always run.
 * - If it's a daily job scheduled before 10 AM: defer to 10 AM.
 * - If it's a daily job scheduled after 10 AM: run on schedule.
 */
export function shouldRunNow(schedule: string): boolean {
  // High-frequency jobs always run
  if (schedule.startsWith('*/')) return true;

  // For daily jobs (0 H * * *), check if H >= 10
  const match = schedule.match(/^0\s+(\d+)\s/);
  if (match) {
    const scheduledHour = parseInt(match[1]);
    if (scheduledHour < 10) {
      // Job is scheduled before 10 AM — defer to 10 AM
      return new Date().getHours() >= 10;
    }
  }

  return true; // Default: run
}
