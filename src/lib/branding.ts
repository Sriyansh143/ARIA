// ARIA Branding — DB-backed configurable branding layer.
// Persisted as a MemoryItem with scope='config', key='branding'.
// All fields have safe DEFAULT_BRANDING fallbacks so the app boots even
// before the DB row is created.

import { db } from '@/lib/db';

export interface BrandingConfig {
  appName: string;
  codename: string;
  fullName: string;
  version: string;
  tagline: string;
  poweredBy: string;
  company: string;
  owner: string;
  ownerEmail: string;
  ownerPhone: string;
  ownerTelegram: string;
  ownerTimezone: string;
  ownerEscalationMinutes: number;
  website: string;
  accentColor: string;
  logoUrl: string;
  chatTabLabel: string;
  metaTitle: string;
  metaDescription: string;
  systemPromptPreamble: string;
  footerNote: string;
}

export const DEFAULT_BRANDING: BrandingConfig = {
  appName: 'ARIA',
  codename: 'ARIA',
  fullName: 'Autonomous Responsive Intelligence Assistant',
  version: '10.0.0',
  tagline: 'Powered by Liafon Software Private Limited',
  poweredBy: 'Powered by Liafon Software Private Limited',
  company: 'Liafon Software Private Limited',
  owner: 'Raviteja Voruganti',
  ownerEmail: 'raviteja@liafon.com',
  ownerPhone: '+919999999999',
  ownerTelegram: '@raviteja',
  ownerTimezone: 'Asia/Calcutta',
  ownerEscalationMinutes: 30,
  website: 'https://liafon.com',
  accentColor: '#7DD3FC',
  logoUrl: 'https://z-cdn.chatglm.cn/z-ai/static/logo.svg',
  chatTabLabel: 'ARIA Chat',
  metaTitle: 'ARIA Mission Control — Autonomous Agent Orchestration',
  metaDescription:
    'ARIA v10 — Autonomous Responsive Intelligence Assistant. A mission-control dashboard for an autonomous agent fleet. Live telemetry, GLM-4.6 chat, skills, memory, scheduler, payments, and fleet health.',
  systemPromptPreamble:
    'You are ARIA (Autonomous Responsive Intelligence Assistant), an autonomous agent-orchestration system powered by Liafon Software Private Limited. Maintain a calm, precise, mission-control tone.',
  footerNote: 'Powered by Liafon Software Private Limited · Owned by Raviteja Voruganti',
};

const KEY = 'branding';
const SCOPE = 'config';

function isBrandingConfig(v: unknown): v is BrandingConfig {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.appName === 'string' &&
    typeof o.codename === 'string' &&
    typeof o.fullName === 'string' &&
    typeof o.version === 'string'
  );
}

function mergeWithDefaults(partial: Partial<BrandingConfig> | null): BrandingConfig {
  if (!partial) return { ...DEFAULT_BRANDING };
  const out: BrandingConfig = { ...DEFAULT_BRANDING };
  (Object.keys(DEFAULT_BRANDING) as (keyof BrandingConfig)[]).forEach((k) => {
    const v = partial[k];
    if (k === 'ownerEscalationMinutes') {
      if (typeof v === 'number' && v > 0) (out as Record<string, unknown>)[k] = v;
      return;
    }
    if (typeof v === 'string' && v.length > 0) (out as Record<string, unknown>)[k] = v;
  });
  return out;
}

/** Fetch the current branding config (merged with defaults). Never throws. */
export async function getBrandingConfig(): Promise<BrandingConfig> {
  try {
    const row = await db.memoryItem.findUnique({
      where: { key_scope: { key: KEY, scope: SCOPE } },
    });
    if (!row) return { ...DEFAULT_BRANDING };
    let parsed: Partial<BrandingConfig> | null = null;
    try {
      parsed = JSON.parse(row.value);
    } catch {
      parsed = null;
    }
    return mergeWithDefaults(parsed);
  } catch {
    return { ...DEFAULT_BRANDING };
  }
}

const ALLOWED_KEYS: ReadonlyArray<keyof BrandingConfig> = [
  'appName',
  'codename',
  'fullName',
  'version',
  'tagline',
  'poweredBy',
  'company',
  'owner',
  'ownerEmail',
  'ownerPhone',
  'ownerTelegram',
  'ownerTimezone',
  'ownerEscalationMinutes',
  'website',
  'accentColor',
  'logoUrl',
  'chatTabLabel',
  'metaTitle',
  'metaDescription',
  'systemPromptPreamble',
  'footerNote',
];

/** Patch-update the branding config. Only whitelisted string fields are applied. */
export async function updateBrandingConfig(
  opts: Partial<BrandingConfig>,
): Promise<BrandingConfig> {
  const patch: Partial<BrandingConfig> = {};
  for (const k of ALLOWED_KEYS) {
    const v = opts[k];
    if (k === 'ownerEscalationMinutes') {
      if (typeof v === 'number' && v > 0) (patch as Record<string, unknown>)[k] = v;
      continue;
    }
    if (typeof v === 'string' && v.length > 0) (patch as Record<string, unknown>)[k] = v;
  }
  const current = await getBrandingConfig();
  const next: BrandingConfig = { ...current, ...patch };
  await db.memoryItem.upsert({
    where: { key_scope: { key: KEY, scope: SCOPE } },
    update: { value: JSON.stringify(next), tags: JSON.stringify(['branding', 'config']) },
    create: {
      key: KEY,
      scope: SCOPE,
      value: JSON.stringify(next),
      tags: JSON.stringify(['branding', 'config']),
      pinned: true,
    },
  });
  return next;
}

/** Reset branding to DEFAULT_BRANDING. */
export async function resetBrandingConfig(): Promise<BrandingConfig> {
  await db.memoryItem.upsert({
    where: { key_scope: { key: KEY, scope: SCOPE } },
    update: { value: JSON.stringify(DEFAULT_BRANDING) },
    create: {
      key: KEY,
      scope: SCOPE,
      value: JSON.stringify(DEFAULT_BRANDING),
      tags: JSON.stringify(['branding', 'config']),
      pinned: true,
    },
  });
  return { ...DEFAULT_BRANDING };
}

/** Synchronous sanity-check helper (used by tests / lint only). */
export function assertBrandingShape(cfg: BrandingConfig): void {
  if (!isBrandingConfig(cfg)) {
    throw new Error('Invalid BrandingConfig shape');
  }
}
