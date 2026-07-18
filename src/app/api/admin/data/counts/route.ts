// =====================================================================
// /api/admin/data/counts — Lightweight per-table row counts
// =====================================================================
// GET — returns just the row counts for all demo-able tables. Used by
//       the Demo Data panel for polling (every 20s) without dragging the
//       seed-scripts catalog along for the ride.
// =====================================================================

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getBlackBoxStats } from '@/lib/blackbox';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  try {
    const [
      agents, skills, cronJobs, providers, models, rules, earningMethods,
      payments, comms, memoryItems, notifications, telemetry, tasks, artifacts,
      spawnedAgents, workforceAgents, credentials, learningItems, plugins,
      scheduledAutonomy, autonomyTemplates, pipelines, agentLogs,
      goals,
    ] = await Promise.all([
      db.agent.count(),
      db.skill.count(),
      db.cronJob.count(),
      db.provider.count(),
      db.model.count(),
      db.rule.count(),
      db.earningMethod.count(),
      db.payment.count(),
      db.agentMessage.count(),
      db.memoryItem.count(),
      db.notification.count(),
      db.telemetry.count(),
      db.task.count(),
      db.artifact.count(),
      db.spawnedAgent.count(),
      db.workforceAgent.count(),
      db.platformCredential.count(),
      db.skillLearning.count(),
      db.plugin.count(),
      db.scheduledAutonomy.count(),
      db.autonomyTemplate.count(),
      db.pipeline.count(),
      db.agentLog.count(),
      db.memoryItem.count({ where: { scope: 'goal' } }),
    ]);

    let blackboxLogs = 0;
    try {
      blackboxLogs = getBlackBoxStats().bufferSize;
    } catch {
      blackboxLogs = 0;
    }

    return NextResponse.json({
      counts: {
        agents, skills, cronJobs, providers, models, rules, earningMethods,
        payments, comms, memoryItems, notifications, telemetry, tasks, artifacts,
        spawnedAgents, workforceAgents, credentials, learningItems, goals,
        plugins, blackboxLogs, scheduledAutonomy, autonomyTemplates, pipelines,
        agentLogs,
      },
      ts: Date.now(),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'failed to read table counts', counts: {} },
      { status: 200 },
    );
  }
}
