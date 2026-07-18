import { NextRequest, NextResponse } from 'next/server';
import {
  BrandingConfig,
  DEFAULT_BRANDING,
  getBrandingConfig,
  updateBrandingConfig,
  resetBrandingConfig,
} from '@/lib/branding';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/branding — returns the active branding config + defaults. */
export async function GET() {
  const config = await getBrandingConfig();
  const payload: { config: BrandingConfig; defaults: BrandingConfig } = {
    config,
    defaults: { ...DEFAULT_BRANDING },
  };
  return NextResponse.json(payload);
}

/** POST /api/branding — alias of PUT (whitelist update). */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'JSON body required' }, { status: 400 });
  }
  const next = await updateBrandingConfig(body as Partial<BrandingConfig>);
  return NextResponse.json({ config: next });
}

/** PUT /api/branding — whitelist update of any subset of fields. */
export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'JSON body required' }, { status: 400 });
  }
  const next = await updateBrandingConfig(body as Partial<BrandingConfig>);
  return NextResponse.json({ config: next });
}

/** DELETE /api/branding — reset to DEFAULT_BRANDING. */
export async function DELETE() {
  const next = await resetBrandingConfig();
  return NextResponse.json({ config: next });
}
