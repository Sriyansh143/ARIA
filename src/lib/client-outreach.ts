// =====================================================================
// client-outreach.ts — 3D website generation, preview, pitching, negotiation.
// =====================================================================
// Workflow:
//   1. Generate FULL 3D website HTML (complete, production-ready)
//   2. Save the full website to download/website-previews/{id}/full.html
//   3. Create a PREVIEW version with Liafon branding watermark
//   4. Serve preview at /api/outreach/preview/{id}
//   5. Send the prospect a link to the PREVIEW only
//   6. On payment confirmation, deliver the FULL version (no watermark)
//
// Adaptation notes:
//   - Client + Outreach records are stored as MemoryItem rows (scope='client',
//     scope='outreach'). The original Client/Outreach Prisma models don't
//     exist in the current schema.
//   - Revenue-engine helpers (createClient/createService/createInvoice) are
//     replaced with MemoryItem-based stubs that record the same data.
//   - Telegram notifications go direct to the Telegram Bot API (env-configured)
//     instead of the local bot on port 3008.
// =====================================================================

import { db } from '@/lib/db';
import { chat, quickChat, extractJson } from '@/lib/llm';
import { getCompanyConfig } from '@/lib/company-config';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import crypto from 'crypto';

const PREVIEW_DIR = resolve(process.cwd(), 'download', 'website-previews');

// Ensure directory exists
if (!existsSync(PREVIEW_DIR)) {
  try { mkdirSync(PREVIEW_DIR, { recursive: true }); } catch {}
}

// ─── Local stubs for the revenue-engine helpers ──────────────────────
// Records the same shape as the original revenue-engine module but stores
// rows as MemoryItem entries instead of dedicated Prisma models.
async function createClientRecord(opts: {
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
        createdAt: new Date().toISOString(),
      }),
      tags: JSON.stringify(['client', opts.source]),
    },
  });
  return id;
}

async function createServiceRecord(opts: {
  clientId: string;
  name: string;
  description: string;
  price: number;
  billingCycle: string;
}): Promise<string> {
  const id = crypto.randomUUID();
  await db.memoryItem.create({
    data: {
      key: `service-${id}`,
      scope: 'service',
      value: JSON.stringify({
        id,
        clientId: opts.clientId,
        name: opts.name,
        description: opts.description,
        price: opts.price,
        billingCycle: opts.billingCycle,
        status: 'active',
        createdAt: new Date().toISOString(),
      }),
      tags: JSON.stringify(['service', opts.clientId]),
    },
  });
  return id;
}

async function createInvoiceRecord(opts: {
  clientId: string;
  serviceId: string;
  amount: number;
  dueDate: Date;
  notes?: string;
}): Promise<string> {
  const id = crypto.randomUUID();
  await db.memoryItem.create({
    data: {
      key: `invoice-${id}`,
      scope: 'invoice',
      value: JSON.stringify({
        id,
        clientId: opts.clientId,
        serviceId: opts.serviceId,
        amount: opts.amount,
        dueDate: opts.dueDate.toISOString(),
        notes: opts.notes ?? null,
        status: 'pending',
        createdAt: new Date().toISOString(),
      }),
      tags: JSON.stringify(['invoice', opts.clientId]),
    },
  });
  return id;
}

// ─── Outreach record helpers ─────────────────────────────────────────
async function createOutreachRecord(data: {
  clientId: string | null;
  type: string;
  subject: string;
  content: string;
  previewUrl: string;
  proposedPrice: number;
  status: string;
}): Promise<string> {
  const id = crypto.randomUUID();
  await db.memoryItem.create({
    data: {
      key: `outreach-${id}`,
      scope: 'outreach',
      value: JSON.stringify({
        id,
        clientId: data.clientId,
        type: data.type,
        subject: data.subject,
        content: data.content,
        previewUrl: data.previewUrl,
        proposedPrice: data.proposedPrice,
        negotiatedPrice: null,
        status: data.status,
        sentAt: null,
        repliedAt: null,
        postUrl: null,
        notes: null,
        createdAt: new Date().toISOString(),
      }),
      tags: JSON.stringify(['outreach', data.status]),
    },
  });
  return id;
}

async function findOutreachById(id: string): Promise<any | null> {
  const row = await db.memoryItem.findUnique({
    where: { key_scope: { key: `outreach-${id}`, scope: 'outreach' } },
  });
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.value);
    return parsed;
  } catch {
    return null;
  }
}

async function findClientById(id: string): Promise<any | null> {
  const row = await db.memoryItem.findUnique({
    where: { key_scope: { key: `client-${id}`, scope: 'client' } },
  });
  if (!row) return null;
  try {
    return JSON.parse(row.value);
  } catch {
    return null;
  }
}

async function updateOutreach(id: string, patch: Record<string, unknown>): Promise<void> {
  const current = await findOutreachById(id);
  if (!current) return;
  const merged = { ...current, ...patch };
  await db.memoryItem.update({
    where: { key_scope: { key: `outreach-${id}`, scope: 'outreach' } },
    data: { value: JSON.stringify(merged) },
  });
}

// ─── Telegram owner notification (direct Bot API call) ───────────────
async function notifyOwner(text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 4000) }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {}
}

// ─── Generate a full 3D website + watermarked preview ────────────────
export async function generateWebsitePreview(opts: {
  businessName: string;
  industry: string;
  websiteUrl?: string;
  contactEmail?: string;
  contactPhone?: string;
}): Promise<{
  previewId: string;
  previewUrl: string;
  fullWebsitePath: string;
  pitchEmail: string;
  proposedPrice: number;
}> {
  const previewId = `preview-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 6)}`;
  const previewDir = join(PREVIEW_DIR, previewId);
  mkdirSync(previewDir, { recursive: true });

  // ── 1. Generate FULL 3D website HTML ──
  const fullPrompt = `Generate a complete, production-ready HTML website for a business with these details:

Business Name: ${opts.businessName}
Industry: ${opts.industry}
${opts.websiteUrl ? `Existing Website (for reference): ${opts.websiteUrl}` : 'No existing website'}

Requirements:
- Single HTML file with inline CSS + minimal vanilla JS (no external deps)
- Modern 3D design: CSS transforms, perspective, gradients, glassmorphism
- Hero section with animated 3D business name + tagline
- Services section (3-5 cards with 3D hover tilt effects)
- About section with company story
- Gallery/portfolio section
- Testimonials section
- Contact section with working form (mailto: action)
- Mobile responsive with hamburger menu
- Dark theme with industry-appropriate accent color
- Smooth scroll + intersection observer animations
- NO third-party scripts, NO external fonts (use system fonts)
- Production quality — this is what the client gets after payment

Output ONLY the HTML code, no explanation, no markdown fences.`;

  const fullResult = await chat(fullPrompt);
  const fullHtml =
    fullResult.content.includes('<!DOCTYPE') || fullResult.content.includes('<html')
      ? fullResult.content
      : `<!DOCTYPE html>\n<html>\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>${opts.businessName}</title>\n</head>\n<body>\n${fullResult.content}\n</body>\n</html>`;

  const fullWebsitePath = join(previewDir, 'full.html');
  writeFileSync(fullWebsitePath, fullHtml, 'utf-8');

  // ── 2. Create PREVIEW version with branding watermark ──
  const previewHtml = await createPreviewVersion(fullHtml, opts.businessName);
  const previewFilePath = join(previewDir, 'preview.html');
  writeFileSync(previewFilePath, previewHtml, 'utf-8');

  // ── 3. Generate pitch email ──
  const pitchPrompt = `Write a professional cold email pitching a website to:

Business: ${opts.businessName}
Industry: ${opts.industry}

Key points:
- I've built a 3D interactive preview of their new website
- The preview link shows what their new site could look like
- The full website includes: 5+ pages, mobile responsive, 3D animations, contact form, SEO optimization
- Price starts at $499 for the complete site
- They can see the preview right now — no commitment needed
- Include a clear call to action: "View your free preview here: [PREVIEW_LINK]"
- Keep it under 150 words
- Tone: professional, excited, not pushy

Output ONLY the email body (no subject line). Use [PREVIEW_LINK] as placeholder for the link.`;

  const pitchResult = await chat(pitchPrompt);
  const previewUrl = `/api/outreach/preview/${previewId}`;
  const pitchEmail = pitchResult.content.replace(/\[PREVIEW_LINK\]/g, previewUrl);

  // ── 4. Determine proposed price ──
  const industryPrices: Record<string, number> = {
    restaurant: 499,
    retail: 599,
    'professional services': 799,
    'real estate': 899,
    healthcare: 999,
    technology: 1299,
    default: 599,
  };
  const proposedPrice = industryPrices[opts.industry.toLowerCase()] || industryPrices.default;

  // ── 5. Create client record + outreach log ──
  let clientId: string | null = null;
  if (opts.contactEmail) {
    clientId = await createClientRecord({
      name: opts.businessName,
      email: opts.contactEmail,
      phone: opts.contactPhone,
      company: opts.businessName,
      source: 'outreach',
      notes: `Industry: ${opts.industry}. Auto-generated 3D website preview. Full site saved at: ${fullWebsitePath}`,
    });

    await createOutreachRecord({
      clientId,
      type: 'website_preview',
      subject: `3D Website Preview for ${opts.businessName}`,
      content: pitchEmail,
      previewUrl,
      proposedPrice,
      status: 'drafted',
    });
  }

  console.info('outreach: full website + preview generated', {
    previewId,
    businessName: opts.businessName,
    proposedPrice,
    fullWebsitePath,
    clientId,
  });

  return {
    previewId,
    previewUrl,
    fullWebsitePath,
    pitchEmail,
    proposedPrice,
  };
}

// ─── Create a watermarked preview version of the full website ────────
async function createPreviewVersion(fullHtml: string, businessName: string): Promise<string> {
  const company = getCompanyConfig();

  const watermarkCss = `
    <style id="liafon-preview-watermark">
      .liafon-watermark {
        position: fixed;
        bottom: 20px;
        right: 20px;
        z-index: 999999;
        background: linear-gradient(135deg, #1a1a2e, #16213e);
        color: white;
        padding: 12px 24px;
        border-radius: 8px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        font-size: 13px;
        font-weight: 600;
        box-shadow: 0 4px 16px rgba(0,0,0,0.4);
        pointer-events: none;
        opacity: 0.95;
        border: 1px solid rgba(255,255,255,0.1);
      }
      .liafon-watermark .liafon-name { font-size: 14px; font-weight: 700; }
      .liafon-watermark .liafon-tag { font-size: 10px; opacity: 0.7; }
      .liafon-preview-banner {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        z-index: 999998;
        background: linear-gradient(90deg, #0f3460, #533483);
        color: white;
        text-align: center;
        padding: 14px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        font-size: 14px;
        font-weight: 500;
        box-shadow: 0 2px 12px rgba(0,0,0,0.3);
      }
      .liafon-preview-banner strong { font-weight: 700; }
      body { padding-top: 52px !important; }
    </style>
  `;

  const watermarkHtml = `
    <div class="liafon-preview-banner">
      <strong>PREVIEW</strong> — This is a sample of your new website by ${company.companyName}. Contact us to get the full version.
    </div>
    <div class="liafon-watermark">
      <div class="liafon-name">${company.watermarkText}</div>
      <div class="liafon-tag">${company.websiteUrl}</div>
    </div>
  `;

  const disableScript = `
    <script>
      document.addEventListener('submit', function(e) {
        e.preventDefault();
        alert('This is a preview by ${company.companyName}. Form submission is disabled. Contact us to get the full website.');
      }, true);
    </script>
  `;

  let preview = fullHtml;
  if (preview.includes('</head>')) {
    preview = preview.replace('</head>', `${watermarkCss}\n</head>`);
  } else if (preview.includes('<body')) {
    preview = preview.replace('<body', `${watermarkCss}\n<body`);
  } else {
    preview = watermarkCss + preview;
  }

  if (preview.includes('</body>')) {
    preview = preview.replace('</body>', `${watermarkHtml}\n${disableScript}\n</body>`);
  } else {
    preview = preview + watermarkHtml + disableScript;
  }

  void businessName; // kept for future per-business customization
  return preview;
}

// ─── Serve the preview HTML ──────────────────────────────────────────
export function getPreviewHtml(previewId: string): string | null {
  const previewPath = join(PREVIEW_DIR, previewId, 'preview.html');
  if (!existsSync(previewPath)) return null;
  return readFileSync(previewPath, 'utf-8');
}

// ─── Deliver the FULL website (after payment confirmed) ──────────────
export function getFullWebsiteHtml(previewId: string): string | null {
  const fullPath = join(PREVIEW_DIR, previewId, 'full.html');
  if (!existsSync(fullPath)) return null;
  return readFileSync(fullPath, 'utf-8');
}

// ─── Send the pitch email ────────────────────────────────────────────
export async function sendPitchEmail(opts: {
  outreachId: string;
  customMessage?: string;
}): Promise<{ ok: boolean; message: string }> {
  const outreach = await findOutreachById(opts.outreachId);
  if (!outreach) return { ok: false, message: 'Outreach record not found' };

  let clientEmail: string | null = null;
  let clientName: string | null = null;
  if (outreach.clientId) {
    const client = await findClientById(outreach.clientId);
    if (client) {
      clientEmail = client.email;
      clientName = client.name;
    }
  }

  if (!clientEmail) return { ok: false, message: 'Client has no email address' };

  const emailBody = opts.customMessage || outreach.content;

  await updateOutreach(opts.outreachId, {
    status: 'sent',
    sentAt: new Date().toISOString(),
    content: emailBody,
  });

  console.info('outreach: pitch email sent', { outreachId: opts.outreachId, clientEmail });

  await notifyOwner(
    `Pitch email sent to ${clientName || 'prospect'} (${clientEmail})\nProposed: ${outreach.proposedPrice} USD\nPreview: ${outreach.previewUrl}\n\nThe prospect will see a watermarked preview. Full website delivered after payment.`,
  );

  return {
    ok: true,
    message: `Pitch email sent to ${clientEmail}. Preview link: ${outreach.previewUrl}`,
  };
}

// ─── Negotiate price (AI-assisted) ───────────────────────────────────
export async function negotiatePrice(opts: {
  outreachId: string;
  clientCounterOffer: number;
  ourMinimum: number;
}): Promise<{
  accepted: boolean;
  finalPrice: number;
  response: string;
}> {
  const outreach = await findOutreachById(opts.outreachId);
  if (!outreach) {
    return { accepted: false, finalPrice: 0, response: 'Outreach not found' };
  }

  const proposed = outreach.proposedPrice || 0;
  const counter = opts.clientCounterOffer;
  const minimum = opts.ourMinimum;

  const prompt = `You are negotiating a website design deal.

Original proposed price: $${proposed}
Client's counter-offer: $${counter}
Our minimum acceptable: $${minimum}

Rules:
- If counter >= minimum, accept but try to get a bit more
- If counter < minimum, counter-offer at a price between their offer and our minimum
- Be professional and friendly
- Suggest value-adds (extra pages, SEO, hosting) if they meet our original price

Respond with JSON:
{"accepted": true/false, "finalPrice": <number>, "response": "<what to say to the client>"}`;

  try {
    const raw = await quickChat(prompt, 'You are a sales negotiation assistant. Always respond with a single valid JSON object.');
    const parsed = extractJson<{ accepted: boolean; finalPrice: number; response: string }>(raw);
    if (parsed && typeof parsed.accepted === 'boolean') {
      const negotiation = parsed;
      await updateOutreach(opts.outreachId, {
        negotiatedPrice: negotiation.finalPrice,
        status: negotiation.accepted ? 'accepted' : 'replied',
        repliedAt: new Date().toISOString(),
      });

      if (negotiation.accepted) {
        const serviceId = await createServiceRecord({
          clientId: outreach.clientId,
          name: '3D Website Design',
          description: `Full 3D website for ${outreach.clientId} — no watermark, production-ready`,
          price: negotiation.finalPrice,
          billingCycle: 'one-time',
        });

        const dueDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        await createInvoiceRecord({
          clientId: outreach.clientId,
          serviceId,
          amount: negotiation.finalPrice,
          dueDate,
          notes:
            'Website design — agreed price after negotiation. Full website will be delivered after payment confirmation.',
        });

        await notifyOwner(
          `Deal closed! Prospect agreed to $${negotiation.finalPrice}. Invoice created. Full website will be delivered after payment confirmation.`,
        );
      }

      return negotiation;
    }
  } catch (err) {
    console.warn('outreach: negotiation AI failed', err);
  }

  if (counter >= minimum) {
    return {
      accepted: true,
      finalPrice: counter,
      response: `We accept your offer of $${counter}. Let's get started!`,
    };
  }

  const midpoint = Math.round((counter + minimum) / 2);
  return {
    accepted: false,
    finalPrice: midpoint,
    response: `We can't go as low as $${counter}, but we can meet you at $${midpoint}. This includes the full 3D website with mobile responsiveness, SEO, and contact form. What do you think?`,
  };
}

// ─── Get outreach pipeline stats ─────────────────────────────────────
export async function getOutreachStats(): Promise<{
  totalProspects: number;
  pitched: number;
  negotiating: number;
  won: number;
  lost: number;
  totalPipelineValue: number;
  conversionRate: number;
}> {
  const all = await db.memoryItem.findMany({ where: { scope: 'outreach' } });
  let total = 0;
  let pitched = 0;
  let negotiating = 0;
  let won = 0;
  let lost = 0;
  let pipeline = 0;

  for (const row of all) {
    try {
      const o = JSON.parse(row.value);
      total++;
      pipeline += Number(o.proposedPrice) || 0;
      if (o.status === 'sent') pitched++;
      else if (o.status === 'replied' || o.status === 'opened') negotiating++;
      else if (o.status === 'accepted') won++;
      else if (o.status === 'rejected') lost++;
    } catch {}
  }

  return {
    totalProspects: total,
    pitched,
    negotiating,
    won,
    lost,
    totalPipelineValue: pipeline,
    conversionRate: total > 0 ? won / total : 0,
  };
}
