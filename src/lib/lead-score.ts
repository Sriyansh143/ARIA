/**
 * lead-score.ts — Pure lead-scoring function shared between
 * /api/leads POST route and /api/orion/command (create-lead intent).
 *
 * Score components (max 100):
 *   - Source weight:    referral +25, inbound +20, web +10, cold-outreach +5, other +5
 *   - Name (≥2 chars):  +10
 *   - Email (valid):    +15
 *   - Work email:       +10 (not in free-provider list)
 *   - Phone (≥7 digits):+15
 *   - Company (≥2 chars):+10
 *   - Notes (≥8 chars): +5
 */

const FREE_EMAIL_PROVIDERS = [
  'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com', 'aol.com',
];

export interface LeadScoreInput {
  source: string;
  clientName: string;
  company?: string | null;
  email?: string | null;
  phone?: string | null;
  notes?: string | null;
}

export function scoreLead(input: LeadScoreInput): number {
  let score = 0;
  const src = input.source;
  if (src === 'referral') score += 25;
  else if (src === 'inbound') score += 20;
  else if (src === 'web') score += 10;
  else if (src === 'cold-outreach') score += 5;
  else score += 5;

  if (input.clientName && input.clientName.trim().length >= 2) score += 10;

  if (input.email && /@/.test(input.email)) {
    score += 15;
    const domain = input.email.split('@')[1]?.toLowerCase() ?? '';
    if (domain && !FREE_EMAIL_PROVIDERS.includes(domain)) score += 10;
  }

  if (input.phone && input.phone.replace(/\D/g, '').length >= 7) score += 15;
  if (input.company && input.company.trim().length >= 2) score += 10;
  if (input.notes && input.notes.trim().length >= 8) score += 5;

  return Math.max(0, Math.min(100, score));
}
