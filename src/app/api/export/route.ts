import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * GET /api/export — returns a JSON snapshot of all major tables.
 *
 * NEVER includes Credential ciphertext/iv/authTag — only counts.
 * Used by the export-panel for one-click system snapshots.
 */
export async function GET(_req: NextRequest) {
  try {
    const [
      agents,
      tasks,
      logs,
      events,
      metrics,
      approvals,
      cronJobs,
      llmCalls,
      alerts,
      skills,
      subAgentTasks,
      opportunities,
      insights,
      revenueEvents,
      deals,
      agentMessages,
      memories,
      users,
      personnel,
      companyProfiles,
      simulationRuns,
      credentials,
      systemAccessSessions,
      notes,
      milestones,
      kpiSnapshots,
      marketplaceTemplates,
      researchLogs,
      ecosystemRepos,
      voicemails,
      supportTickets,
      debates,
      failureArtifacts,
      fleetForecasts,
      lockRecords,
      settings,
    ] = await Promise.all([
      db.agent.count(),
      db.task.count(),
      db.agentLog.count(),
      db.event.count(),
      db.metricPoint.count(),
      db.approval.count(),
      db.cronJob.count(),
      db.llmCall.count(),
      db.systemAlert.count(),
      db.skill.count(),
      db.subAgentTask.count(),
      db.earningOpportunity.count(),
      db.learnedInsight.count(),
      db.revenueEvent.count(),
      db.deal.count(),
      db.agentMessage.count(),
      db.memoryItem.count(),
      db.user.count(),
      db.personnel.count(),
      db.companyProfile.count(),
      db.simulationRun.count(),
      db.credential.count(),
      db.systemAccessSession.count(),
      db.note.count(),
      db.milestoneEvent.count(),
      db.kpiSnapshot.count(),
      db.agentMarketplaceTemplate.count(),
      db.researchLog.count(),
      db.ecosystemRepo.count(),
      db.voicemail.count(),
      db.supportTicket.count(),
      db.debateSession.count(),
      db.failureAlchemyArtifact.count(),
      db.fleetForecast.count(),
      db.lockRecord.count(),
      db.setting.count(),
    ]);

    return NextResponse.json({
      exportedAt: new Date().toISOString(),
      // Credential vault: count only — secrets never leave the server.
      credentialsCount: credentials,
      counts: {
        agents,
        tasks,
        logs,
        events,
        metrics,
        approvals,
        cronJobs,
        llmCalls,
        alerts,
        skills,
        subAgentTasks,
        opportunities,
        insights,
        revenueEvents,
        deals,
        agentMessages,
        memories,
        users,
        personnel,
        companyProfiles,
        simulationRuns,
        systemAccessSessions,
        notes,
        milestones,
        kpiSnapshots,
        marketplaceTemplates,
        researchLogs,
        ecosystemRepos,
        voicemails,
        supportTickets,
        debates,
        failureArtifacts,
        fleetForecasts,
        lockRecords,
        settings,
      },
    });
  } catch (err) {
    logger.error("api.export.failed", { error: String(err) });
    return NextResponse.json(
      { error: "failed to export snapshot" },
      { status: 500 }
    );
  }
}
