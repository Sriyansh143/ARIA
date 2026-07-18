import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { dispatchCronJob } from '@/lib/cron-dispatcher';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// ─────────────────────────────────────────────────────────────────────
// POST /api/health/remediate
//
// Body: { action, target? }
//   action: 'restart-agent' | 'enable-provider' | 'disable-provider'
//           | 'run-selfheal' | 'clear-logs'
//   target: agentId (for restart-agent) or provider key (for enable/disable)
//
// Returns: { ok, message, action, target? }
// ─────────────────────────────────────────────────────────────────────

type RemediationAction =
  | 'restart-agent'
  | 'enable-provider'
  | 'disable-provider'
  | 'run-selfheal'
  | 'clear-logs';

interface RemediateBody {
  action: RemediationAction;
  target?: string;
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as RemediateBody;
  const { action, target } = body;

  if (!action) {
    return NextResponse.json(
      { ok: false, message: 'Missing `action` in body' },
      { status: 400 },
    );
  }

  try {
    switch (action) {
      case 'restart-agent': {
        if (!target) {
          return NextResponse.json(
            { ok: false, message: 'restart-agent requires `target` (agentId)' },
            { status: 400 },
          );
        }
        const agent = await db.agent.findUnique({
          where: { id: target },
          select: { id: true, codename: true, status: true },
        });
        if (!agent) {
          return NextResponse.json(
            { ok: false, message: `Agent ${target} not found` },
            { status: 404 },
          );
        }
        await db.agent.update({
          where: { id: agent.id },
          data: { status: 'idle', load: 0, lastActive: new Date() },
        });
        await db.agentLog.create({
          data: {
            agentId: agent.id,
            level: 'success',
            message: `Agent restarted via health remediation (was ${agent.status})`,
          },
        });
        await db.notification.create({
          data: {
            type: 'success',
            title: 'Agent Restarted',
            message: `${agent.codename} reset to idle via Health tab remediation.`,
            read: false,
          },
        });
        return NextResponse.json({
          ok: true,
          action,
          target,
          message: `${agent.codename} restarted → idle`,
        });
      }

      case 'enable-provider':
      case 'disable-provider': {
        if (!target) {
          return NextResponse.json(
            { ok: false, message: `${action} requires \`target\` (provider key)` },
            { status: 400 },
          );
        }
        const provider = await db.provider.findUnique({
          where: { key: target },
          select: { id: true, name: true, enabled: true },
        });
        if (!provider) {
          return NextResponse.json(
            { ok: false, message: `Provider ${target} not found` },
            { status: 404 },
          );
        }
        const enable = action === 'enable-provider';
        await db.provider.update({
          where: { key: target },
          data: { enabled: enable },
        });
        await db.notification.create({
          data: {
            type: enable ? 'success' : 'warn',
            title: enable ? 'Provider Enabled' : 'Provider Disabled',
            message: `${provider.name} was ${enable ? 'enabled' : 'disabled'} via Health tab.`,
            read: false,
          },
        });
        return NextResponse.json({
          ok: true,
          action,
          target,
          message: `${provider.name} ${enable ? 'enabled' : 'disabled'}`,
        });
      }

      case 'run-selfheal': {
        // Trigger the health-check cron dispatcher directly (it rotates
        // stuck agents → idle and creates fresh heartbeats).
        const result = await dispatchCronJob('health-check');
        // Additionally, force-reset any agent still in 'error' for >5min.
        const cutoff = new Date(Date.now() - 5 * 60 * 1000);
        const stuck = await db.agent.updateMany({
          where: { status: 'error', lastActive: { lt: cutoff } },
          data: { status: 'idle', load: 0, lastActive: new Date() },
        });
        await db.notification.create({
          data: {
            type: 'success',
            title: 'Self-Heal Executed',
            message: `${result.detail}. Force-reset ${stuck.count} stuck agent(s).`,
            read: false,
          },
        });
        return NextResponse.json({
          ok: true,
          action,
          message: `Self-heal complete — ${result.detail}; reset ${stuck.count} stuck`,
        });
      }

      case 'clear-logs': {
        // Delete error logs older than 7 days.
        const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const deleted = await db.agentLog.deleteMany({
          where: { level: 'error', createdAt: { lt: cutoff } },
        });
        await db.notification.create({
          data: {
            type: 'success',
            title: 'Error Logs Cleared',
            message: `Deleted ${deleted.count} error log(s) older than 7 days.`,
            read: false,
          },
        });
        return NextResponse.json({
          ok: true,
          action,
          message: `Cleared ${deleted.count} old error log(s)`,
        });
      }

      default:
        return NextResponse.json(
          { ok: false, message: `Unknown action: ${action}` },
          { status: 400 },
        );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { ok: false, message: `Remediation failed: ${message}` },
      { status: 500 },
    );
  }
}
