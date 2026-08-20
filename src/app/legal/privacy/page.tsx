import { type Metadata } from "next";
import { LegalPage } from "@/components/legal/LegalPage";
export const metadata: Metadata = { title: "Privacy Policy — ARIA Mission Control", description: "How ARIA Mission Control collects, uses, and protects your data." };
const CONTENT = `
## 1. Information We Collect
- Email: For order delivery + support
- Name: Optional, for personalization
- Service spec: Your text describing what you want built
- UPI UTR: Transaction reference (stored in DB)
- IP address: For rate limiting + security
- Crypto wallet + tx hash: For payment verification (public on blockchain)
We do NOT collect: credit cards (Stripe handles PCI), bank details, private keys.

## 2. How We Use Your Data
Fulfill orders, send emails, verify payments, improve services, detect fraud, comply with CAN-SPAM/GDPR.

## 3. Data Storage
Prisma ORM (SQLite/PostgreSQL). Credential vault uses AES-256-GCM. Daily DB backups.

## 4. Data Sharing
We do NOT sell data. We share with: blockchain APIs (wallet address), Resend (email), Stripe (payment), forex APIs (no personal data). Only when required by law.

## 5. Your GDPR + CCPA Rights
- Access: Request a copy of your data
- Erasure: Request deletion (blockchain records cannot be deleted)
- Rectification: Correct inaccurate data
- Object: Unsubscribe from outreach emails
- Portability: Export your data in machine-readable format

## 6. Cookies
Essential only: session-token (auth), theme (preference). No analytics or advertising cookies.

## 7. Data Retention
- Active orders: indefinite
- Email logs: 90 days
- LLM call logs: 30 days
- Agent logs: 7 days
- Suppression list: indefinite

## 8. Security
2FA enforcement, CSRF protection, rate limiting, webhook signature verification, fail-closed auth gate.

## 9. Contact
Email: ${process.env.NEXT_PUBLIC_OWNER_EMAIL || "support@aria-mission-control.example.com"}
Address: ${process.env.NEXT_PUBLIC_SENDER_ADDRESS || "ARIA Mission Control"}
`;
export default function PrivacyPage() { return <LegalPage title="Privacy Policy" content={CONTENT} lastUpdated="2026-08-16" />; }
