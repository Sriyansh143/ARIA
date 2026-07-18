import { NextResponse } from 'next/server';
import { LIAFON_SERVICES, DEFAULT_COMPANY, getCompanyConfig } from '@/lib/company-config';

export const dynamic = 'force-dynamic';

// GET /api/services — return the Liafon services catalog + company info.
export async function GET() {
  const company = getCompanyConfig();
  return NextResponse.json({
    company,
    services: LIAFON_SERVICES,
    count: LIAFON_SERVICES.length,
  });
}

// Suppress unused-import warnings for things kept for completeness.
void DEFAULT_COMPANY;
