import { NextResponse } from 'next/server';
import { recordStartup, getMissedCronJobs } from '@/lib/session-tracker';
import { dispatchCronJob } from '@/lib/cron-dispatcher';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST — called on app startup to record session + catch up on missed jobs
export async function POST() {
  await recordStartup();
  
  const missed = await getMissedCronJobs();
  const results = [];
  
  // Run missed jobs (limit to 5 to avoid overload on startup)
  for (const key of missed.slice(0, 5)) {
    try {
      const result = await dispatchCronJob(key);
      results.push({ key, ok: result.ok, detail: result.detail });
    } catch {
      results.push({ key, ok: false, detail: 'catch-up failed' });
    }
  }
  
  return NextResponse.json({
    ok: true,
    startup: new Date().toISOString(),
    missedJobs: missed,
    catchUpResults: results,
    catchUpCount: results.length,
  });
}
