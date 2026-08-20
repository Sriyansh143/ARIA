import { type Metadata } from "next";
import { LegalPage } from "@/components/legal/LegalPage";
export const metadata: Metadata = { title: "Refund Policy — ARIA Mission Control", description: "ARIA Mission Control's refund and cancellation policy." };
const CONTENT = `
## 1. Automatic Refunds (No Questions Asked)
- Order not delivered within 24 hours of payment confirmation
- Quality gate fails twice (order marked "needs_manual_review")
- Deliverable contains only placeholder content

## 2. Manual Refunds (Within 7 Days)
- Generated code does not compile (provide error message)
- Deliverable missing files listed in service description
- Deliverable does not match specification in material way

## 3. Non-Refundable
- Code compiles but you changed your mind
- Found a cheaper alternative after purchasing
- Did not read service description
- More than 7 days since delivery
- Already deployed to production

## 4. How to Request
Email ${process.env.NEXT_PUBLIC_OWNER_EMAIL || "support@aria-mission-control.example.com"} with:
- Order ID (from confirmation email)
- Reason for refund
- For "doesn't compile": error message + command you ran
Response within 48 hours. Refund processed within 5 business days.

## 5. Refund Methods
- Crypto: Sent to same wallet address. USD amount converted at current rate. Gas fees deducted.
- UPI: Sent to same VPA. Original INR amount. Typically instant.
- Stripe: Refunded to original card. 5-10 business days.

## 6. What Happens to the Deliverable
- Download link revoked
- Files deleted from server
- Order marked "refunded"

## 7. Quality Guarantee
If quality gate passes but code doesn't work: 1 free revision. If revision fails: full refund.

## 8. Contact
Email: ${process.env.NEXT_PUBLIC_OWNER_EMAIL || "support@aria-mission-control.example.com"}
Address: ${process.env.NEXT_PUBLIC_SENDER_ADDRESS || "ARIA Mission Control"}
`;
export default function RefundPage() { return <LegalPage title="Refund Policy" content={CONTENT} lastUpdated="2026-08-16" />; }
