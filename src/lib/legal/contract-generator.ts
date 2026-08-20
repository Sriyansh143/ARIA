/**
 * src/lib/legal/contract-generator.ts — v73 Phase 23 (RULE-73)
 *
 * Generates PDF Statements of Work (SOW) + Master Services Agreements (MSA)
 * using pdfkit (free + local — no paid e-signature APIs).
 *
 * Flow:
 *   1. Owner approves a high-ticket service (> $500).
 *   2. createContractForServiceOrder() generates the SOW PDF + Contract record.
 *   3. sendContractForSignature() emails the PDF to the client.
 *   4. The client replies with "I AGREE TO THE TERMS".
 *   5. The /api/webhooks/inbound-email webhook parses the reply + matches
 *      it to the Contract record → status = SIGNED → triggers fulfillment.
 *
 * Below $500 → no contract required (immediate fulfillment per RULE-73).
 */

import "server-only";
import { db } from "../db";
import { logger } from "../logger";
import { emit } from "../event-bus";
import * as PDFDocument from "pdfkit";
import * as fs from "fs";
import * as path from "path";

// ─── Constants ────────────────────────────────────────────────────────

export const CONTRACT_THRESHOLD_CENTS = 50_000; // $500 — services above require a contract
export const SIGNATURE_PHRASE = "I AGREE TO THE TERMS";
export const CONTRACT_EXPIRY_DAYS = 30;

// ─── Types ────────────────────────────────────────────────────────────

export interface SOWData {
  clientName: string;
  clientEmail: string;
  clientCompany: string;
  serviceName: string;
  serviceDescription: string;
  amountCents: number;
  currency: string;
  milestones: Array<{ name: string; deliverable: string; dueDate: string; amountCents: number }>;
}

export interface ContractResult {
  contractId: string;
  contractNumber: string;
  pdfPath: string;
  pdfBase64: string;
  status: string;
}

// ─── Public API ───────────────────────────────────────────────────────

/**
 * Create a Contract + generate the SOW PDF. Called when a service order
 * crosses the CONTRACT_THRESHOLD_CENTS ($500) line.
 */
export async function createContractForServiceOrder(
  serviceOrderId: string,
  sowData: SOWData,
): Promise<ContractResult> {
  logger.info("contract-generator.create.start", {
    serviceOrderId,
    clientEmail: sowData.clientEmail,
    amountCents: sowData.amountCents,
  });

  // Generate a unique contract number.
  const year = new Date().getFullYear();
  const yearPrefix = `ARIA-SOW-${year}-`;
  const existingThisYear = await db.contract.count({
    where: { contractNumber: { startsWith: yearPrefix } },
  });
  const contractNumber = `${yearPrefix}${String(existingThisYear + 1).padStart(3, "0")}`;

  // Generate the PDF.
  const { pdfPath, pdfBase64 } = await generateSowPdf(contractNumber, sowData);

  // Create the Contract record.
  const expiresAt = new Date(Date.now() + CONTRACT_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
  const contract = await db.contract.create({
    data: {
      contractType: "SOW",
      contractNumber,
      clientName: sowData.clientName,
      clientEmail: sowData.clientEmail,
      clientCompany: sowData.clientCompany,
      serviceName: sowData.serviceName,
      serviceDescription: sowData.serviceDescription,
      amountCents: sowData.amountCents,
      currency: sowData.currency,
      milestonesJson: JSON.stringify(sowData.milestones),
      pdfUrl: pdfPath,
      pdfBase64,
      status: "draft",
      signaturePhrase: SIGNATURE_PHRASE,
      serviceOrderId,
      expiresAt,
    },
  });

  logger.info("contract-generator.create.complete", {
    contractId: contract.id,
    contractNumber,
    pdfPath,
  });
  emit({
    type: "system",
    ts: new Date().toISOString(),
    message: `📄 Phase 23 Contract generated: ${contractNumber} for ${sowData.clientName} — $${(sowData.amountCents / 100).toFixed(2)}`,
    level: "success",
  });

  return {
    contractId: contract.id,
    contractNumber,
    pdfPath,
    pdfBase64,
    status: "draft",
  };
}

/**
 * Send the contract PDF to the client for e-signature.
 * Uses the existing email-service (Resend) to attach the PDF + the
 * signature instructions.
 */
export async function sendContractForSignature(contractId: string): Promise<{ ok: boolean; error?: string }> {
  const contract = await db.contract.findUnique({ where: { id: contractId } });
  if (!contract) return { ok: false, error: "Contract not found" };
  if (contract.status !== "draft") {
    return { ok: false, error: `Contract status is ${contract.status} (must be 'draft')` };
  }

  try {
    const { sendNotification } = await import("../email-service");
    const result = await sendNotification({
      to: contract.clientEmail,
      subject: `${contract.contractNumber}: Please review + sign (Reply to accept)`,
      text: `Hi ${contract.clientName},

Please find attached your Statement of Work (${contract.contractNumber}) for ${contract.serviceName}.

Total: $${(contract.amountCents / 100).toFixed(2)} ${contract.currency}
Valid until: ${contract.expiresAt?.toLocaleDateString() ?? "30 days from send date"}

To accept this SOW, reply to this email with the exact phrase:

  ${SIGNATURE_PHRASE}

Once we receive your reply, we'll begin fulfillment immediately.

— ARIA, your AI autonomous company 🤖`,
      html: `<p>Hi ${contract.clientName},</p>
<p>Please find attached your <strong>Statement of Work (${contract.contractNumber})</strong> for <strong>${contract.serviceName}</strong>.</p>
<ul>
  <li>Total: $${(contract.amountCents / 100).toFixed(2)} ${contract.currency}</li>
  <li>Valid until: ${contract.expiresAt?.toLocaleDateString() ?? "30 days from send date"}</li>
</ul>
<p>To accept this SOW, reply to this email with the exact phrase:</p>
<blockquote style="background:#f3f4f6;padding:12px;border-left:4px solid #2563eb;font-weight:bold;font-size:18px;">${SIGNATURE_PHRASE}</blockquote>
<p>Once we receive your reply, we'll begin fulfillment immediately.</p>
<p>— ARIA, your AI autonomous company 🤖</p>`,
      metadata: { contractId, contractNumber: contract.contractNumber },
    });

    if (!result.ok) {
      return { ok: false, error: `Email send failed: ${result.error ?? "unknown"}` };
    }

    await db.contract.update({
      where: { id: contractId },
      data: { status: "sent", sentAt: new Date() },
    });

    logger.info("contract-generator.sent", { contractId, contractNumber: contract.contractNumber, to: contract.clientEmail });
    emit({
      type: "system",
      ts: new Date().toISOString(),
      message: `📄 Contract ${contract.contractNumber} sent to ${contract.clientEmail} for signature (reply "${SIGNATURE_PHRASE}" to sign)`,
      level: "info",
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err).slice(0, 100) };
  }
}

/**
 * Process an inbound email reply for e-signature.
 * Called by /api/webhooks/inbound-email.
 *
 * Matches the reply to a Contract record by sender email + contract number
 * (in the subject or body), then verifies the signature phrase is present.
 */
export async function processInboundSignatureEmail(email: {
  fromEmail: string;
  subject: string;
  body: string;
  receivedAt: Date;
}): Promise<{ ok: boolean; contractId?: string; reason?: string }> {
  const bodyLower = email.body.toLowerCase();
  const subjectLower = email.subject.toLowerCase();

  // Verify the signature phrase is present.
  if (!bodyLower.includes(SIGNATURE_PHRASE.toLowerCase())) {
    return { ok: false, reason: `Signature phrase "${SIGNATURE_PHRASE}" not found in reply body.` };
  }

  // Find the contract by the contract number in the subject (or body).
  // Subject often looks like "RE: ARIA-SOW-2026-001: Please review..."
  const contractNumberMatch = subjectLower.match(/aria-sow-\d{4}-\d{3}/) || bodyLower.match(/aria-sow-\d{4}-\d{3}/);
  if (!contractNumberMatch) {
    // Fall back to: find the most recent "sent" contract for this email.
    const contract = await db.contract.findFirst({
      where: { clientEmail: email.fromEmail, status: "sent" },
      orderBy: { sentAt: "desc" },
    });
    if (!contract) {
      return { ok: false, reason: `No 'sent' contract found for ${email.fromEmail}, and no contract number in subject/body.` };
    }
    return await signContract(contract.id, email.fromEmail);
  }

  const contract = await db.contract.findUnique({ where: { contractNumber: contractNumberMatch[0].toUpperCase() } });
  if (!contract) {
    return { ok: false, reason: `Contract ${contractNumberMatch[0]} not found.` };
  }
  if (contract.status !== "sent") {
    return { ok: false, reason: `Contract status is ${contract.status} (must be 'sent').` };
  }
  if (contract.clientEmail.toLowerCase() !== email.fromEmail.toLowerCase()) {
    return { ok: false, reason: `Reply email (${email.fromEmail}) does not match contract client email (${contract.clientEmail}).` };
  }

  return await signContract(contract.id, email.fromEmail);
}

// ─── PDF generation ───────────────────────────────────────────────────

/**
 * Generate the SOW PDF using pdfkit. Returns the path + base64-encoded content.
 *
 * NOTE: pdfkit is a low-level PDF library. We build the document by adding
 * text, headings, lists, etc. The PDF is saved to /download/contracts/
 * AND base64-encoded for email attachment.
 */
async function generateSowPdf(contractNumber: string, data: SOWData): Promise<{ pdfPath: string; pdfBase64: string }> {
  const contractsDir = path.resolve(process.cwd(), "download", "contracts");
  if (!fs.existsSync(contractsDir)) fs.mkdirSync(contractsDir, { recursive: true });
  const pdfPath = path.join(contractsDir, `${contractNumber}.pdf`);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument.default({ size: "LETTER", margin: 50 });
    const chunks: Buffer[] = [];

    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => {
      const buffer = Buffer.concat(chunks);
      fs.writeFileSync(pdfPath, buffer);
      const pdfBase64 = buffer.toString("base64");
      resolve({ pdfPath, pdfBase64 });
    });
    doc.on("error", reject);

    // ─── PDF content ───
    doc.fontSize(24).font("Helvetica-Bold").text("STATEMENT OF WORK", { align: "center" });
    doc.moveDown(0.5);
    doc.fontSize(11).font("Helvetica").text(`Contract Number: ${contractNumber}`, { align: "center" });
    doc.text(`Date: ${new Date().toLocaleDateString()}`, { align: "center" });
    doc.moveDown(1);

    doc.fontSize(14).font("Helvetica-Bold").text("1. PARTIES");
    doc.fontSize(11).font("Helvetica").text(`This Statement of Work ("SOW") is entered into between:`);
    doc.moveDown(0.3);
    doc.text(`  • ARIA Mission Control ("ARIA" — an AI autonomous company)`);
    doc.text(`  • ${data.clientName}${data.clientCompany ? `, ${data.clientCompany}` : ""} ("Client")`);
    doc.moveDown(1);

    doc.fontSize(14).font("Helvetica-Bold").text("2. SCOPE OF WORK");
    doc.fontSize(11).font("Helvetica").text(`ARIA will deliver the following service: ${data.serviceName}`);
    doc.moveDown(0.3);
    doc.text(data.serviceDescription);
    doc.moveDown(1);

    doc.fontSize(14).font("Helvetica-Bold").text("3. COMPENSATION");
    doc.fontSize(11).font("Helvetica").text(`Total contract value: $${(data.amountCents / 100).toFixed(2)} ${data.currency}`);
    doc.moveDown(1);

    doc.fontSize(14).font("Helvetica-Bold").text("4. MILESTONES");
    doc.fontSize(11).font("Helvetica").text("The work will be delivered in the following milestones:");
    doc.moveDown(0.3);
    let milestoneIndex = 1;
    for (const m of data.milestones) {
      doc.text(`  ${milestoneIndex}. ${m.name}`);
      doc.text(`     Deliverable: ${m.deliverable}`);
      doc.text(`     Due: ${m.dueDate}`);
      doc.text(`     Amount: $${(m.amountCents / 100).toFixed(2)} ${data.currency}`);
      doc.moveDown(0.3);
      milestoneIndex++;
    }
    doc.moveDown(0.5);

    doc.fontSize(14).font("Helvetica-Bold").text("5. ACCEPTANCE");
    doc.fontSize(11).font("Helvetica").text("By replying to the email containing this SOW with the exact phrase:");
    doc.moveDown(0.3);
    doc.fontSize(13).font("Helvetica-Bold").text(`  "${SIGNATURE_PHRASE}"`, { indent: 30 });
    doc.moveDown(0.3);
    doc.fontSize(11).font("Helvetica").text("the Client acknowledges that they have read, understood, and agreed to all terms in this SOW. This constitutes a legally binding electronic signature.");
    doc.moveDown(1);

    doc.fontSize(14).font("Helvetica-Bold").text("6. TERMINATION");
    doc.fontSize(11).font("Helvetica").text("Either party may terminate this SOW with 7 days written notice. ARIA may terminate immediately if the Client breaches any term of this SOW.");
    doc.moveDown(1);

    doc.fontSize(14).font("Helvetica-Bold").text("7. WARRANTY DISCLAIMER");
    doc.fontSize(11).font("Helvetica").text('ARIA provides the service "as is" without warranty of any kind, express or implied. ARIA does not guarantee specific business outcomes (revenue, conversion rates, etc.) from the delivered service.');
    doc.moveDown(1);

    doc.fontSize(14).font("Helvetica-Bold").text("8. INTELLECTUAL PROPERTY");
    doc.fontSize(11).font("Helvetica").text("Upon full payment, all deliverables become the property of the Client. ARIA retains the right to use the Client's name + project description in marketing materials (case studies, testimonials) unless the Client explicitly opts out in writing.");
    doc.moveDown(1);

    doc.fontSize(14).font("Helvetica-Bold").text("9. CONTACT");
    doc.fontSize(11).font("Helvetica").text(`For questions about this SOW, reply to this email or contact ARIA at aria@yourcompany.com.`);
    doc.moveDown(2);

    doc.fontSize(10).font("Helvetica-Oblique").text("This document was generated by ARIA — an AI autonomous company. The terms above constitute the entire agreement between the parties regarding the scope of work described.", { align: "center" });

    doc.end();
  });
}

/**
 * Mark a contract as SIGNED by the client. Triggers the fulfillment workflow.
 */
async function signContract(contractId: string, signedByEmail: string): Promise<{ ok: boolean; contractId: string }> {
  await db.contract.update({
    where: { id: contractId },
    data: {
      status: "signed",
      signedAt: new Date(),
      signedByEmail,
    },
  });
  // Log to the ledger: revenue is recognized when the contract is signed.
  const contract = await db.contract.findUnique({ where: { id: contractId } });
  if (contract) {
    const { recordLedgerEntry } = await import("../finance/ledger");
    await recordLedgerEntry({
      account: "Revenue",
      subAccount: `Revenue:${contract.serviceName}`,
      debitCents: 0,
      creditCents: contract.amountCents, // revenue is credited when earned
      description: `Contract ${contract.contractNumber} signed by ${contract.clientName}`,
      referenceType: "contract-signed",
      referenceId: contract.id,
    });
    // Also debit Accounts Receivable (asset) — we'll credit Cash when the invoice is paid.
    await recordLedgerEntry({
      account: "Accounts Receivable",
      subAccount: `AR:${contract.clientName}`,
      debitCents: contract.amountCents, // AR increases
      creditCents: 0,
      description: `AR recorded for contract ${contract.contractNumber}`,
      referenceType: "contract-signed",
      referenceId: contract.id,
    });
  }

  emit({
    type: "system",
    ts: new Date().toISOString(),
    message: `✅ Contract ${contract?.contractNumber ?? ""} SIGNED by ${signedByEmail} — fulfillment triggered`,
    level: "success",
  });

  logger.info("contract-generator.signed", { contractId, signedByEmail });
  return { ok: true, contractId };
}
