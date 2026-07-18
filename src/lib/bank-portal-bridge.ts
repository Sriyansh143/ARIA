// =====================================================================
// bank-portal-bridge.ts — Browser-Use agent for UTR verification (stub).
// =====================================================================
// In production this would drive a headless browser (Playwright/Puppeteer)
// to log into a banking portal, navigate to the transactions page, search
// for a UTR, and return whether the bank confirms that transaction.
// Banking portals are heavily protected (2FA, CAPTCHA, IP allow-listing)
// so this module is INTENTIONALLY a sandboxed stub:
//
//   - All operations are gated behind JARVIS_BANK_PORTAL_ENABLED=true
//   - Real credentials are never persisted in code
//   - Returns { verified: false } by default in dev environments
//
// The interface is stable so a future production deployment can swap in
// a real browser-use agent without touching the callers.
//
// Public API:
//   verifyUtrViaPortal(utr, bank)
//   getSupportedBanks()
//   isEnabled()
// =====================================================================

export interface UtrVerificationResult {
  verified: boolean;
  source: 'bank-portal' | 'sandbox-stub' | 'disabled';
  checkedAt: string;
  utr: string;
  bank: string;
  amount?: number;
  date?: string;
  reason?: string;
}

const SUPPORTED_BANKS = ['hdfc', 'icici', 'sbi', 'axis', 'kotak', 'yesbank', 'idfc'];

export async function verifyUtrViaPortal(
  utr: string,
  bank: string,
): Promise<UtrVerificationResult> {
  const checkedAt = new Date().toISOString();
  const normalizedBank = (bank || '').toLowerCase().trim();

  // 1. Disabled by default — explicit opt-in required
  if (process.env.JARVIS_BANK_PORTAL_ENABLED !== 'true') {
    return {
      verified: false,
      source: 'disabled',
      checkedAt,
      utr,
      bank: normalizedBank,
      reason:
        'Bank-portal bridge is disabled. Set JARVIS_BANK_PORTAL_ENABLED=true and provide portal credentials via env to enable.',
    };
  }

  // 2. Validate bank
  if (!SUPPORTED_BANKS.includes(normalizedBank)) {
    return {
      verified: false,
      source: 'sandbox-stub',
      checkedAt,
      utr,
      bank: normalizedBank,
      reason: `Bank "${normalizedBank}" not in supported list: ${SUPPORTED_BANKS.join(', ')}`,
    };
  }

  // 3. Validate UTR format (12-22 alphanumeric chars, uppercase)
  const utrNorm = utr.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (utrNorm.length < 12 || utrNorm.length > 22) {
    return {
      verified: false,
      source: 'sandbox-stub',
      checkedAt,
      utr,
      bank: normalizedBank,
      reason: 'UTR format invalid (expected 12-22 alphanumeric chars).',
    };
  }

  // 4. Sandbox stub — production would call a browser-use agent here
  console.info('bank-portal-bridge: sandbox stub — would drive browser-use agent in production', {
    utr: utrNorm,
    bank: normalizedBank,
  });

  try {
    return {
      verified: false,
      source: 'sandbox-stub',
      checkedAt,
      utr,
      bank: normalizedBank,
      reason:
        'Sandbox mode: production browser-use agent not wired. Use bank-reconciliation.ts for UTR matching against bank statements.',
    };
  } catch (err) {
    return {
      verified: false,
      source: 'sandbox-stub',
      checkedAt,
      utr,
      bank: normalizedBank,
      reason: `Driver error: ${(err as Error).message}`,
    };
  }
}

export function getSupportedBanks(): string[] {
  return [...SUPPORTED_BANKS];
}

export function isEnabled(): boolean {
  return process.env.JARVIS_BANK_PORTAL_ENABLED === 'true';
}
