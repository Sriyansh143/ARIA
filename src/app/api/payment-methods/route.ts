import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { encryptPassword, isUsingProductionKey } from '@/lib/credential-vault';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Allowed method keys + their required detail fields.
const METHOD_META: Record<
  string,
  { required: string[]; optional?: string[] }
> = {
  upi: { required: ['vpa'] },
  bank: { required: ['accountNo', 'ifsc', 'name'] },
  card: { required: ['cardLast4', 'token'], optional: ['expiry'] },
  wallet: { required: ['walletId'] },
  paypal: { required: ['email'] },
  crypto: { required: ['address'], optional: ['chain'] },
};

const ALLOWED_METHODS = Object.keys(METHOD_META);

/** Build a human-readable masked preview from the (unencrypted) details object. */
function buildMasked(method: string, details: Record<string, string>): string {
  switch (method) {
    case 'upi': {
      const vpa = details.vpa ?? '';
      if (!vpa) return '••••';
      const at = vpa.indexOf('@');
      if (at <= 0 || at >= vpa.length - 1) return `${vpa.slice(0, 2)}•••`;
      const head = vpa.slice(0, Math.min(at + 1, 6));
      const tail = vpa.slice(at + 1);
      const tailMasked = tail.length > 4 ? tail.slice(0, 4) + '•••' : tail;
      return `${head}${tailMasked}`;
    }
    case 'bank': {
      const acct = details.accountNo ?? '';
      const ifsc = (details.ifsc ?? '').toUpperCase();
      const acctTail = acct.length > 4 ? acct.slice(-4) : acct;
      const bank = ifsc.slice(0, 4) || 'BANK';
      return `${bank}•••${acctTail}`;
    }
    case 'card': {
      const last4 = details.cardLast4 ?? '';
      return `•••• ${last4}`;
    }
    case 'wallet': {
      const w = details.walletId ?? '';
      if (!w) return '••••';
      if (w.length <= 4) return `•••${w}`;
      return `•••• ${w.slice(-4)}`;
    }
    case 'paypal': {
      const e = details.email ?? '';
      if (!e) return '••••';
      const at = e.indexOf('@');
      if (at <= 0) return `${e.slice(0, 2)}•••`;
      return `${e.slice(0, Math.min(at, 3))}•••${e.slice(at)}`;
    }
    case 'crypto': {
      const a = details.address ?? '';
      if (!a) return '••••';
      if (a.length <= 8) return `${a.slice(0, 4)}•••`;
      return `${a.slice(0, 6)}•••${a.slice(-4)}`;
    }
    default:
      return '••••';
  }
}

/** Sanitize + validate incoming details for a method. Returns null if invalid. */
function validateDetails(
  method: string,
  raw: unknown,
): Record<string, string> | null {
  const meta = METHOD_META[method];
  if (!meta) return null;
  if (!raw || typeof raw !== 'object') return null;
  const src = raw as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const k of meta.required) {
    const v = src[k];
    if (typeof v !== 'string' || v.trim().length === 0) return null;
    out[k] = v.trim();
  }
  for (const k of meta.optional ?? []) {
    const v = src[k];
    if (typeof v === 'string' && v.trim().length > 0) out[k] = v.trim();
  }
  // Card-specific: cardLast4 must be 4 digits.
  if (method === 'card' && !/^\d{4}$/.test(out.cardLast4)) return null;
  // UPI VPA must contain '@'.
  if (method === 'upi' && !out.vpa.includes('@')) return null;
  // PayPal email must contain '@'.
  if (method === 'paypal' && !out.email.includes('@')) return null;
  return out;
}

export interface PaymentMethodPublicRow {
  id: string;
  label: string;
  method: string;
  masked: string;
  currency: string;
  isDefault: boolean;
  enabled: boolean;
  verified: boolean;
  lastUsedAt: string | null;
  usageCount: number;
  createdAt: string;
  updatedAt: string;
}

function serialize(m: {
  id: string;
  label: string;
  method: string;
  masked: string;
  currency: string;
  isDefault: boolean;
  enabled: boolean;
  verified: boolean;
  lastUsedAt: Date | null;
  usageCount: number;
  createdAt: Date;
  updatedAt: Date;
}): PaymentMethodPublicRow {
  return {
    id: m.id,
    label: m.label,
    method: m.method,
    masked: m.masked,
    currency: m.currency,
    isDefault: m.isDefault,
    enabled: m.enabled,
    verified: m.verified,
    lastUsedAt: m.lastUsedAt ? m.lastUsedAt.toISOString() : null,
    usageCount: m.usageCount,
    createdAt: m.createdAt.toISOString(),
    updatedAt: m.updatedAt.toISOString(),
  };
}

export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const method = url.searchParams.get('method') || undefined;
  const enabled = url.searchParams.get('enabled');
  const where: Record<string, unknown> = {};
  if (method) where.method = method;
  if (enabled === 'true') where.enabled = true;
  if (enabled === 'false') where.enabled = false;

  const rows = await db.ownerPaymentMethod.findMany({
    where,
    // default first, then most-recently-used, then newest.
    orderBy: [{ isDefault: 'desc' }, { lastUsedAt: 'desc' }, { createdAt: 'desc' }],
  });

  const totalUsage = rows.reduce((a, r) => a + r.usageCount, 0);
  const verifiedCount = rows.filter((r) => r.verified).length;
  const defaultRow = rows.find((r) => r.isDefault) ?? null;

  return NextResponse.json({
    methods: rows.map(serialize),
    count: rows.length,
    stats: {
      total: rows.length,
      verified: verifiedCount,
      enabled: rows.filter((r) => r.enabled).length,
      totalUsage,
      defaultMasked: defaultRow?.masked ?? null,
      defaultMethod: defaultRow?.method ?? null,
    },
    productionKey: isUsingProductionKey(),
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { label, method, details, currency, isDefault } = body as {
    label?: string;
    method?: string;
    details?: unknown;
    currency?: string;
    isDefault?: boolean;
  };

  if (!label || typeof label !== 'string' || label.trim().length === 0) {
    return NextResponse.json({ error: 'label required' }, { status: 400 });
  }
  if (!method || !ALLOWED_METHODS.includes(method)) {
    return NextResponse.json(
      { error: `method must be one of: ${ALLOWED_METHODS.join(', ')}` },
      { status: 400 },
    );
  }

  const cleanDetails = validateDetails(method, details);
  if (!cleanDetails) {
    const meta = METHOD_META[method];
    return NextResponse.json(
      { error: `invalid details for method '${method}'. required: ${meta.required.join(', ')}` },
      { status: 400 },
    );
  }

  const masked = buildMasked(method, cleanDetails);
  const enc = encryptPassword(JSON.stringify(cleanDetails));

  // Ensure only one default.
  const wantDefault = Boolean(isDefault);
  if (wantDefault) {
    await db.ownerPaymentMethod.updateMany({
      where: { isDefault: true },
      data: { isDefault: false },
    });
  }

  const created = await db.ownerPaymentMethod.create({
    data: {
      label: label.trim(),
      method,
      detailsEnc: enc.encrypted,
      detailsIv: enc.iv,
      detailsTag: enc.tag,
      masked,
      currency: currency && currency.trim() ? currency.trim().toUpperCase() : 'INR',
      isDefault: wantDefault,
    },
  });

  return NextResponse.json({ method: serialize(created) });
}
