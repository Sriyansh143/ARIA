import { type Metadata } from "next";
import { LegalPage } from "@/components/legal/LegalPage";
export const metadata: Metadata = { title: "Terms of Service — ARIA Mission Control", description: "Terms governing the use of ARIA Mission Control's AI-powered software generation services." };
const CONTENT = `
## 1. Acceptance of Terms
By using ARIA Mission Control ("ARIA"), you agree to these Terms. If you do not agree, do not use our services.

## 2. Services
ARIA provides AI-generated software deliverables: websites, landing pages, 3D sites, voice agents, SaaS scaffolds, CLI tools, API services, dashboards, blog posts, and API documentation.

## 3. Payments
- Crypto: BTC, ETH, SOL, USDT, USDC. Verified on-chain. Irreversible.
- UPI: PhonePe, GPay, Paytm, BHIM. Requires UTR verification.
- Stripe: Credit/debit cards via Stripe Checkout.
- All prices in USD. UPI converted to INR at live rate.

## 4. Delivery
- Most services delivered within 1-2 hours of payment confirmation.
- Every deliverable passes an automated quality gate (syntax validation + sandbox execution).
- ARIA does NOT guarantee generated code will compile or run without modification.

## 5. Refunds
See our Refund Policy. Summary: refunds for non-delivery (24h), quality gate failure, or non-compiling code (7 days).

## 6. Intellectual Property
Customer retains full ownership of generated deliverables. ARIA retains rights to its AI models, prompts, and infrastructure.

## 7. Acceptable Use
No malicious code, no illegal activities, no reverse engineering, no rate limit abuse.

## 8. Limitation of Liability
"AS IS" without warranties. Maximum liability = amount paid for the order.

## 9. Contact
Email: ${process.env.NEXT_PUBLIC_OWNER_EMAIL || "support@aria-mission-control.example.com"}
Address: ${process.env.NEXT_PUBLIC_SENDER_ADDRESS || "ARIA Mission Control"}
`;
export default function TermsPage() { return <LegalPage title="Terms of Service" content={CONTENT} lastUpdated="2026-08-16" />; }
