import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { encryptPassword } from '@/lib/credential-vault';
import type { PaymentMethodPublicRow } from '../route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const row = await db.ownerPaymentMethod.findUnique({ where: { id } });
  if (!row) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ method: serialize(row) });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const existing = await db.ownerPaymentMethod.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const data: Record<string, unknown> = {};

  if (typeof body.label === 'string' && body.label.trim().length > 0) {
    data.label = body.label.trim();
  }
  if (typeof body.currency === 'string' && body.currency.trim().length > 0) {
    data.currency = body.currency.trim().toUpperCase();
  }
  if (typeof body.enabled === 'boolean') data.enabled = body.enabled;
  if (typeof body.verified === 'boolean') data.verified = body.verified;
  if (typeof body.isDefault === 'boolean') {
    // Ensure only one default.
    if (body.isDefault) {
      await db.ownerPaymentMethod.updateMany({
        where: { isDefault: true, NOT: { id } },
        data: { isDefault: false },
      });
    }
    data.isDefault = body.isDefault;
  }
  if (typeof body.lastUsedAt === 'string') {
    // Accept ISO timestamp or "now".
    if (body.lastUsedAt === 'now') {
      data.lastUsedAt = new Date();
      data.usageCount = (existing.usageCount ?? 0) + 1;
    } else {
      const d = new Date(body.lastUsedAt);
      if (!Number.isNaN(d.getTime())) data.lastUsedAt = d;
    }
  }
  if (typeof body.usageCount === 'number' && Number.isFinite(body.usageCount)) {
    data.usageCount = Math.max(0, Math.floor(body.usageCount));
  }

  // Re-encrypt details if provided (full replace only — method unchanged).
  if (body.details && typeof body.details === 'object') {
    const method = existing.method;
    const METHOD_META: Record<string, { required: string[]; optional?: string[] }> = {
      upi: { required: ['vpa'] },
      bank: { required: ['accountNo', 'ifsc', 'name'] },
      card: { required: ['cardLast4', 'token'], optional: ['expiry'] },
      wallet: { required: ['walletId'] },
      paypal: { required: ['email'] },
      crypto: { required: ['address'], optional: ['chain'] },
    };
    const meta = METHOD_META[method];
    if (meta) {
      const src = body.details as Record<string, unknown>;
      const out: Record<string, string> = {};
      let valid = true;
      for (const k of meta.required) {
        const v = src[k];
        if (typeof v !== 'string' || v.trim().length === 0) { valid = false; break; }
        out[k] = v.trim();
      }
      if (valid) {
        for (const k of meta.optional ?? []) {
          const v = src[k];
          if (typeof v === 'string' && v.trim().length > 0) out[k] = v.trim();
        }
        if (method === 'card' && !/^\d{4}$/.test(out.cardLast4)) valid = false;
        if (method === 'upi' && !out.vpa.includes('@')) valid = false;
        if (method === 'paypal' && !out.email.includes('@')) valid = false;
        if (valid) {
          const enc = encryptPassword(JSON.stringify(out));
          data.detailsEnc = enc.encrypted;
          data.detailsIv = enc.iv;
          data.detailsTag = enc.tag;
          // Rebuild masked preview.
          data.masked = buildMasked(method, out);
        }
      }
      if (!valid) {
        return NextResponse.json(
          { error: `invalid details for method '${method}'` },
          { status: 400 },
        );
      }
    }
  }

  const updated = await db.ownerPaymentMethod.update({ where: { id }, data });
  return NextResponse.json({ method: serialize(updated) });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const existing = await db.ownerPaymentMethod.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: 'not found' }, { status: 404 });
  await db.ownerPaymentMethod.delete({ where: { id } });
  // If we deleted the default, promote the next available method (if any).
  if (existing.isDefault) {
    const next = await db.ownerPaymentMethod.findFirst({
      where: { enabled: true },
      orderBy: [{ lastUsedAt: 'desc' }, { createdAt: 'desc' }],
    });
    if (next) {
      await db.ownerPaymentMethod.update({ where: { id: next.id }, data: { isDefault: true } });
    }
  }
  return NextResponse.json({ ok: true });
}

/** Local copy of buildMasked to avoid importing from the collection route. */
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
      return `•••• ${details.cardLast4 ?? ''}`;
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
