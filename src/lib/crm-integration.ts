// =====================================================================
// crm-integration.ts — Twenty CRM (open-source) API integration.
// =====================================================================
// Connects to a self-hosted Twenty CRM instance to:
//   1. Detect incoming leads (webhook listener)
//   2. Push new leads from JARVIS (Okara feed, voice agent, outreach)
//   3. Sync lead status between JARVIS and CRM
//   4. Trigger follow-up workflows when leads change status
//
// If Twenty CRM is not deployed, this module gracefully degrades — it
// uses MemoryItem(scope='client') as a fallback CRM.
//
// Env vars:
//   TWENTY_CRM_URL       e.g. http://localhost:3001
//   TWENTY_CRM_API_KEY   bearer token
//   TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID  (for owner notifications)
// =====================================================================

import { db } from '@/lib/db';
import crypto from 'crypto';

const CRM_API_URL = process.env.TWENTY_CRM_URL || '';
const CRM_API_KEY = process.env.TWENTY_CRM_API_KEY || '';

// ─── Check if CRM is configured ──────────────────────────────────────
export function isCRMConfigured(): boolean {
  return CRM_API_URL.length > 0 && CRM_API_KEY.length > 0;
}

// ─── Fallback local client record helpers ────────────────────────────
async function createLocalClient(opts: {
  name: string;
  email?: string;
  phone?: string;
  company?: string;
  source: string;
  notes?: string;
}): Promise<string> {
  const id = crypto.randomUUID();
  await db.memoryItem.create({
    data: {
      key: `client-${id}`,
      scope: 'client',
      value: JSON.stringify({
        id,
        name: opts.name,
        email: opts.email ?? null,
        phone: opts.phone ?? null,
        company: opts.company ?? null,
        status: 'prospect',
        source: opts.source,
        notes: opts.notes ?? null,
        syncedFromCRM: false,
        createdAt: new Date().toISOString(),
      }),
      tags: JSON.stringify(['client', opts.source]),
    },
  });
  return id;
}

async function listLocalProspectClients(take = 5): Promise<any[]> {
  const rows = await db.memoryItem.findMany({
    where: { scope: 'client' },
    take: 100,
    orderBy: { createdAt: 'desc' },
  });
  const out: any[] = [];
  for (const row of rows) {
    try {
      const c = JSON.parse(row.value);
      if (c.status === 'prospect' && c.source !== 'crm_synced') {
        out.push(c);
        if (out.length >= take) break;
      }
    } catch {}
  }
  return out;
}

// ─── Fetch new leads from Twenty CRM ─────────────────────────────────
export async function fetchNewLeads(): Promise<any[]> {
  if (!isCRMConfigured()) {
    return listLocalProspectClients(5);
  }
  try {
    const r = await fetch(`${CRM_API_URL}/rest/leads?status=new`, {
      headers: {
        Authorization: `Bearer ${CRM_API_KEY}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) {
      console.warn('crm: fetch leads failed', { status: r.status });
      return [];
    }
    const data = (await r.json()) as { leads?: any[] };
    return data.leads || [];
  } catch (err) {
    console.warn('crm: fetch leads error', { err: (err as Error).message });
    return [];
  }
}

// ─── Push a lead to Twenty CRM ───────────────────────────────────────
export async function pushLeadToCRM(opts: {
  name: string;
  email?: string;
  phone?: string;
  company?: string;
  source: string;
  notes?: string;
}): Promise<{ ok: boolean; crmLeadId?: string; message: string }> {
  if (!isCRMConfigured()) {
    const id = await createLocalClient(opts);
    return { ok: true, message: `Lead stored locally (CRM not configured). Client ID: ${id}` };
  }
  try {
    const r = await fetch(`${CRM_API_URL}/rest/leads`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${CRM_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: opts.name,
        email: opts.email,
        phone: opts.phone,
        company: opts.company,
        source: opts.source,
        notes: opts.notes,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) {
      return { ok: false, message: `CRM API returned ${r.status}` };
    }
    const data = (await r.json()) as { id?: string };
    console.info('crm: lead pushed', { name: opts.name, crmLeadId: data.id });
    return { ok: true, crmLeadId: data.id, message: 'Lead pushed to CRM' };
  } catch (err) {
    console.warn('crm: push lead error', { err: (err as Error).message });
    return { ok: false, message: (err as Error).message };
  }
}

// ─── Owner notification (direct Telegram Bot API) ────────────────────
async function notifyOwner(text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 4000) }),
      signal: AbortSignal.timeout(5_000),
    });
  } catch {}
}

// ─── Record a triggered CRM-lead action (replaces AutonomousAction) ──
async function recordTriggeredAction(prompt: string): Promise<void> {
  const id = crypto.randomUUID();
  await db.memoryItem.create({
    data: {
      key: `crm-action-${id}`,
      scope: 'autonomous-action',
      value: JSON.stringify({
        id,
        trigger: 'crm_lead',
        agentRole: 'ceo',
        prompt,
        outcome: 'pending',
        autonomous: true,
        createdAt: new Date().toISOString(),
      }),
      tags: JSON.stringify(['crm-lead', 'pending']),
    },
  });
}

async function isActionAlreadyTriggered(needle: string): Promise<boolean> {
  const rows = await db.memoryItem.findMany({
    where: { scope: 'autonomous-action' },
    take: 200,
    orderBy: { createdAt: 'desc' },
  });
  for (const row of rows) {
    try {
      const a = JSON.parse(row.value);
      if (a.trigger === 'crm_lead' && a.prompt && a.prompt.includes(needle)) return true;
    } catch {}
  }
  return false;
}

// ─── Check for new CRM leads + trigger agent swarm ───────────────────
export async function checkCRMLeads(): Promise<{
  newLeads: number;
  triggered: number;
}> {
  const leads = await fetchNewLeads();
  if (leads.length === 0) return { newLeads: 0, triggered: 0 };

  let triggered = 0;
  for (const lead of leads) {
    const needle = lead.name || lead.email || lead.id || '';
    if (!needle) continue;

    if (await isActionAlreadyTriggered(needle)) continue;

    const taskPrompt = `New lead from CRM: ${lead.name || 'Unknown'}
Email: ${lead.email || 'N/A'}
Phone: ${lead.phone || 'N/A'}
Company: ${lead.company || 'N/A'}
Source: ${lead.source || 'CRM'}
Notes: ${lead.notes || 'None'}

Qualify this lead: research the company, assess if they need our services
(AI software, 3D websites, marketing automation, HR consulting), and draft
a personalized outreach email.`;

    await recordTriggeredAction(taskPrompt);

    await notifyOwner(
      `New CRM Lead Detected\n\nName: ${lead.name || 'Unknown'}\nCompany: ${lead.company || 'N/A'}\nSource: ${lead.source || 'CRM'}\n\nThe MNC orchestrator is processing this lead automatically.`,
    );

    triggered++;
  }

  console.info('crm: lead check complete', { newLeads: leads.length, triggered });
  return { newLeads: leads.length, triggered };
}

// ─── Update lead status in CRM ───────────────────────────────────────
export async function updateLeadStatus(opts: {
  crmLeadId: string;
  status: string;
  notes?: string;
}): Promise<boolean> {
  if (!isCRMConfigured()) return false;
  try {
    const r = await fetch(`${CRM_API_URL}/rest/leads/${opts.crmLeadId}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${CRM_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        status: opts.status,
        notes: opts.notes,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    return r.ok;
  } catch {
    return false;
  }
}

// ─── Get CRM sync stats ──────────────────────────────────────────────
export async function getCRMStats(): Promise<{
  configured: boolean;
  totalLeads: number;
  newLeads: number;
  syncedToday: number;
}> {
  const configured = isCRMConfigured();
  const today = new Date(new Date().setHours(0, 0, 0, 0));

  const rows = await db.memoryItem.findMany({ where: { scope: 'client' } });
  let totalLeads = 0;
  let newLeads = 0;
  let syncedToday = 0;
  for (const row of rows) {
    try {
      const c = JSON.parse(row.value);
      totalLeads++;
      if (c.status === 'prospect') newLeads++;
      if (row.createdAt >= today) syncedToday++;
    } catch {}
  }

  return { configured, totalLeads, newLeads, syncedToday };
}
