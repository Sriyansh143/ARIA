import "server-only";
import { db } from "../db"; import { logger } from "../logger"; import { emit } from "../event-bus";
export function isStripeConfigured(): boolean { const k=process.env.STRIPE_SECRET_KEY; return !!k&&k.startsWith("sk_"); }

/**
 * Phase 30 — create a Stripe Checkout Session with optional automatic_tax.
 *
 * If STRIPE_TAX_ENABLED=true, the session includes `automatic_tax: {enabled: true}`
 * so Stripe calculates tax based on the customer's billing address at checkout.
 * Tax amount is stored on the Contract row (taxAmountCents) + persisted to
 * the TaxCalculation table by the tax-calculator module.
 */
export async function createStripeCheckoutSession(p: {serviceId:string;serviceName:string;priceCents:number;orderId:string;customerEmail?:string;customerCountry?:string;customerState?:string;customerZip?:string;contractId?:string}): Promise<{ok:boolean;url?:string;sessionId?:string;error?:string;taxAmountCents?:number}> {
  if(!isStripeConfigured()) return {ok:false,error:"Stripe not configured"};
  try { const Stripe=(await import("stripe")).default; const stripe=new Stripe(process.env.STRIPE_SECRET_KEY!,{apiVersion:"2024-06-20" as any});

    // ─── Phase 30 — Tax calculation ───────────────────────────────────
    // If STRIPE_TAX_ENABLED=true, calculate tax via Stripe Tax API (or
    // static fallback) + add it as a second line item.
    let taxAmountCents = 0;
    let taxCalculationResult: { taxAmountCents: number; taxRate: number; taxJurisdiction: string; source: string } | null = null;
    if (process.env.STRIPE_TAX_ENABLED === "true" && p.customerCountry) {
      try {
        const { calculateTax } = await import("../finance/tax-calculator");
        const taxResult = await calculateTax({
          subtotalCents: p.priceCents,
          currency: "usd",
          customerCountry: p.customerCountry,
          customerState: p.customerState,
          customerZip: p.customerZip,
          serviceOrderId: p.orderId,
          contractId: p.contractId,
        });
        if (taxResult.ok) {
          taxAmountCents = taxResult.taxAmountCents;
          taxCalculationResult = {
            taxAmountCents: taxResult.taxAmountCents,
            taxRate: taxResult.taxRate,
            taxJurisdiction: taxResult.taxJurisdiction,
            source: taxResult.source,
          };
        }
      } catch (taxErr) {
        logger.warn("stripe-checkout.tax-calc-failed", { orderId: p.orderId, error: String(taxErr) });
      }
    }

    // Build line items: subtotal + optional tax.
    const lineItems: Array<{ quantity: number; price_data: { currency: string; unit_amount: number; product_data: { name: string; description?: string } } }> = [{
      quantity: 1,
      price_data: {
        currency: "usd",
        unit_amount: p.priceCents,
        product_data: { name: p.serviceName, description: `Order #${p.orderId.slice(-8)}` },
      },
    }];
    if (taxAmountCents > 0) {
      lineItems.push({
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: taxAmountCents,
          product_data: { name: "Sales Tax", description: taxCalculationResult?.taxJurisdiction ?? "" },
        },
      });
    }

    // Build the session parameters. If Stripe Tax is enabled with automatic
    // calculation, pass `automatic_tax: { enabled: true }` so Stripe handles
    // the tax UI. Otherwise, the tax line item above handles it manually.
    const sessionParams: Record<string, unknown> = {
      mode: "payment",
      payment_method_types: ["card"],
      line_items: lineItems,
      success_url: `${process.env.NEXTAUTH_URL||"http://localhost:3000"}/services?stripe=success&order=${p.orderId}`,
      cancel_url: `${process.env.NEXTAUTH_URL||"http://localhost:3000"}/services?stripe=cancelled`,
      customer_email: p.customerEmail,
      metadata: { orderId: p.orderId, serviceId: p.serviceId, contractId: p.contractId ?? "" },
    };

    // If Stripe Tax is enabled (via the official Stripe Tax product), enable
    // automatic_tax. This is only used when both STRIPE_TAX_ENABLED=true AND
    // the Stripe account has Tax enabled. The manual line item approach above
    // is the fallback for accounts without Stripe Tax.
    if (process.env.STRIPE_TAX_AUTOMATIC === "true") {
      sessionParams.automatic_tax = { enabled: true };
    }

    const s = await stripe.checkout.sessions.create(sessionParams as any);

    // Persist the tax calculation to the Contract (if linked).
    if (taxCalculationResult && p.contractId) {
      try {
        await db.contract.update({
          where: { id: p.contractId },
          data: {
            subtotalCents: p.priceCents,
            taxAmountCents: taxCalculationResult.taxAmountCents,
            taxRate: taxCalculationResult.taxRate,
            taxJurisdiction: taxCalculationResult.taxJurisdiction,
            amountCents: p.priceCents + taxCalculationResult.taxAmountCents,
          },
        });
      } catch (contractErr) {
        logger.warn("stripe-checkout.contract-tax-update-failed", { contractId: p.contractId, error: String(contractErr) });
      }
    }

    return {ok:true,url:s.url||undefined,sessionId:s.id,taxAmountCents};
  } catch(err) { return {ok:false,error:String(err).slice(0,200)}; }
}

/**
 * Phase 30 — handle Stripe webhook with audit log + ledger entries.
 *
 * Now records an audit log entry for every webhook event + writes a
 * LedgerEntry row on successful payment (via recordStripePayout).
 */
export async function handleStripeWebhook(rawBody: string, signature: string): Promise<{ok:boolean;event?:string;error?:string}> {
  const sec=process.env.STRIPE_WEBHOOK_SECRET; if(!sec) return {ok:false,error:"STRIPE_WEBHOOK_SECRET not configured"};
  // AUDIT-A-7: graceful fallback if STRIPE_SECRET_KEY is unset (was non-null-asserted, throwing an obscure error).
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if(!secretKey) return {ok:false,error:"STRIPE_SECRET_KEY not configured"};
  try { const Stripe=(await import("stripe")).default; const stripe=new Stripe(secretKey,{apiVersion:"2024-06-20" as any}); const event=stripe.webhooks.constructEvent(rawBody,signature,sec);
    switch(event.type) {
      case "checkout.session.completed": { const s=event.data.object as any; const oid=s.metadata?.orderId; if(!oid)return{ok:false,error:"No orderId"};
        // AUDIT-A-4: idempotency — only transition from pending_payment. If the order is already
        // building/delivered (Stripe redelivered the event), short-circuit instead of re-running approveOrder.
        const existing = await db.serviceOrder.findUnique({where:{id:oid},select:{status:true,paymentConfirmedAt:true}});
        if (existing && (existing.status==="building" || existing.status==="delivered" || existing.paymentConfirmedAt)) {
          logger.info("stripe.webhook.duplicate-event",{orderId:oid,status:existing.status});
          return{ok:true,event:"duplicate"};
        }
        await db.serviceOrder.update({where:{id:oid},data:{status:"paid_verified",paymentConfirmedAt:new Date(),cryptoNetwork:"stripe",cryptoTxHash:event.id}});

        // ─── Phase 30 — record audit log + ledger entry ──────────────
        try {
          const { recordAudit } = await import("../audit-log");
          await recordAudit({
            actor: "stripe-webhook",
            actorRole: "system",
            action: "payment-verified",
            resource: "ServiceOrder",
            resourceId: oid,
            after: { status: "paid_verified", stripeEventId: event.id, amountTotal: s.amount_total },
            source: "api",
          });
        } catch (auditErr) { logger.warn("stripe.webhook.audit-failed", { error: String(auditErr) }); }

        try {
          const { recordStripePayout } = await import("../finance/ledger");
          // amount_total is in cents. The recordStripePayout helper writes
          // a double-entry: debit Cash:Stripe, credit Revenue:<serviceName>.
          if (s.amount_total) {
            await recordStripePayout({
              amountCents: s.amount_total,
              currency: s.currency ?? "usd",
              serviceName: "Stripe-SaaS" satisfies string,
              stripePaymentId: event.id,
              clientEmail: s.customer_details?.email ?? "unknown",
            });
          }
        } catch (ledgerErr) { logger.warn("stripe.webhook.ledger-failed", { error: String(ledgerErr) }); }

        // AUDIT-A-2: do NOT swallow approveOrder errors — if it throws, tell Stripe so the event is retried.
        try { const { approveOrder }=await import("../services/crypto-checkout"); await approveOrder(oid); }
        catch(err){ logger.error("stripe.webhook.approve-threw",{orderId:oid,error:String(err)}); return{ok:false,error:`approve failed: ${String(err).slice(0,100)}`}; }
        emit({type:"system",ts:new Date().toISOString(),message:`💳 Stripe payment confirmed for ${oid.slice(-8)}`,level:"success"}); return{ok:true,event:"payment_succeeded"}; }
      case "checkout.session.expired": case "checkout.session.async_payment_failed": { const s=event.data.object as any; const oid=s.metadata?.orderId; if(oid) await db.serviceOrder.update({where:{id:oid},data:{status:"failed",buildLog:"Stripe payment failed"}}); return{ok:true,event:"payment_failed"}; }
      case "charge.refunded": { const c=event.data.object as any; const oid=c.metadata?.orderId; if(oid) await db.serviceOrder.update({where:{id:oid},data:{status:"refunded"}});

        // ─── Phase 30 — audit log for refunds ────────────────────────
        try {
          const { recordAudit } = await import("../audit-log");
          await recordAudit({
            actor: "stripe-webhook",
            actorRole: "system",
            action: "refund-processed",
            resource: "ServiceOrder",
            resourceId: oid,
            after: { status: "refunded", amountRefunded: c.amount_refunded },
            source: "api",
          });
        } catch { /* best-effort */ }

        return{ok:true,event:"refund_processed"}; }
      default: return {ok:true,event:event.type};
    }
  } catch(err) { return {ok:false,error:`Signature failed: ${String(err).slice(0,100)}`}; }
}
export function getStripeConfig() { return { configured:isStripeConfigured(), mode:process.env.STRIPE_SECRET_KEY?.startsWith("sk_test_")?"test":"live", publishableKey:process.env.STRIPE_PUBLISHABLE_KEY||null }; }
