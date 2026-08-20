/**
 * src/lib/hook-engine.ts — v66 Phase 16 (Anti-Robot-Call Hook Engine)
 *
 * RULE-56: FIRST 5 SECONDS DECIDE.
 *
 * The first 5 seconds of a call decide if the customer stays or hangs up.
 * NEVER open with "I am an AI assistant" or "this is a sales call".
 * Lead with a SPECIFIC observation about their business.
 *
 * Also handles negotiation (price objections, competitor comparisons) and
 * spontaneous pitch adaptation when brand data is missing.
 */

import "server-only";
import { logger } from "./logger";
import type { LeadBrandProfile } from "./brand-extractor";

export interface LeadData {
  businessName: string;
  contactEmail: string;
  website?: string;
  industry?: string;
  serviceInterest?: string;
}

export interface HookResult {
  openingLine: string;
  confirmationQuestion: string;
  fallbackQuestions: string[];
  tone: "professional" | "playful" | "luxury" | "minimalist" | "friendly";
  strategy: "brand-known" | "no-brand-ask" | "no-brand-spontaneous";
}

/**
 * Generate a personalized hook for the first 5 seconds of a call.
 * RULE-56: NEVER open with "I am an AI" — lead with a specific observation.
 */
export function generateHook(lead: LeadData, brand?: LeadBrandProfile | null): HookResult {
  // Strategy 1: Brand is known — lead with a specific observation about their business.
  if (brand && brand.primaryColor) {
    const observation = generateBrandObservation(lead, brand);
    return {
      openingLine: observation,
      confirmationQuestion: `Did you get the preview I sent on WhatsApp? It shows your ${lead.serviceInterest ?? "landing page"} with your brand colors (${brand.primaryColor}) applied.`,
      fallbackQuestions: [],
      tone: (brand.brandTone as HookResult["tone"]) ?? "professional",
      strategy: "brand-known",
    };
  }

  // Strategy 2: No brand data — ask 2-3 quick questions, then spontaneously adapt.
  return {
    openingLine: `Hey ${lead.businessName}, I noticed you're in the ${lead.industry ?? "services"} space — I've been looking at what you do and I think there's a quick win we could set up for you. Mind if I ask you 2 quick questions?`,
    confirmationQuestion: "Perfect — based on what you just told me, I can mock something up right now. Want me to show you?",
    fallbackQuestions: [
      "What's the main thing your customers come to you for?",
      "If you could fix one thing about your online presence, what would it be?",
      "What vibe do you want your brand to give off — professional, playful, luxury?",
    ],
    tone: "friendly",
    strategy: "no-brand-ask",
  };
}

/**
 * Generate a specific observation about the lead's business using their brand.
 */
function generateBrandObservation(lead: LeadData, brand: LeadBrandProfile): string {
  const observations: string[] = [];

  if (brand.primaryColor) {
    observations.push(`I was looking at your site and noticed you're using ${brand.primaryColor} as your primary color`);
  }
  if (brand.brandTone) {
    observations.push(`your brand has a really ${brand.brandTone} feel to it`);
  }
  if (brand.logoUrl) {
    observations.push(`your logo placement is clean`);
  }
  if (lead.website) {
    observations.push(`I checked out ${brand.domain}`);
  }

  if (observations.length === 0) {
    return `Hey ${lead.businessName}, I've been looking at what you do and I think there's a quick win we could set up.`;
  }

  const obs = observations.slice(0, 2).join(" and ");
  return `Hey ${lead.businessName}, ${obs}. I actually already mocked up a version of your ${lead.serviceInterest ?? "landing page"} with your brand applied — can I show you?`;
}

/**
 * Spontaneously adapt the pitch based on the customer's live answers.
 * This is called when the customer answers the fallback questions during the call.
 */
export function adaptPitchLive(
  lead: LeadData,
  customerAnswers: Record<string, string>,
): { adaptedPitch: string; suggestedTone: string; suggestedColors: string[] } {
  const mainThing = customerAnswers["What's the main thing your customers come to you for?"] ?? "";
  const fixThing = customerAnswers["If you could fix one thing about your online presence, what would it be?"] ?? "";
  const vibe = customerAnswers["What vibe do you want your brand to give off — professional, playful, luxury?"] ?? "";

  // Determine tone from the vibe answer.
  let suggestedTone = "professional";
  let suggestedColors = ["#2563eb", "#1e40af"];
  if (/playful|fun|casual/i.test(vibe)) {
    suggestedTone = "playful";
    suggestedColors = ["#f59e0b", "#ef4444"];
  } else if (/luxury|premium|elegant/i.test(vibe)) {
    suggestedTone = "luxury";
    suggestedColors = ["#1a1a1a", "#d4af37"];
  } else if (/minimal|clean|simple/i.test(vibe)) {
    suggestedTone = "minimalist";
    suggestedColors = ["#000000", "#ffffff"];
  }

  // Build the adapted pitch.
  const adaptedPitch = `Based on what you told me — your customers come to you for ${mainThing || "great service"}, and you want to fix ${fixThing || "your online presence"}. Here's what I'm thinking: a ${suggestedTone} ${lead.serviceInterest ?? "landing page"} that immediately shows visitors you're the go-to for ${mainThing || lead.industry || "your industry"}. I can have a draft ready in 2 hours. Want me to go ahead?`;

  logger.info("hook-engine.adapt-pitch", { lead: lead.businessName, tone: suggestedTone });

  return { adaptedPitch, suggestedTone, suggestedColors };
}

// ─── Negotiation Handler ─────────────────────────────────────────────

export interface NegotiationResult {
  response: string;
  discountOffered: number;
  requiresOwnerApproval: boolean;
  nextStep: "close" | "follow-up" | "escalate" | "graceful-exit";
}

/**
 * Handle a price negotiation objection.
 * Enforces a discount floor — never below X% without owner approval.
 */
export function handleNegotiation(
  objection: string,
  context: { originalPrice: number; serviceName: string; leadName: string },
): NegotiationResult {
  const MAX_DISCOUNT_WITHOUT_APPROVAL = 10; // %

  // "Too expensive"
  if (/too expensive|too much|can't afford|cheaper/i.test(objection)) {
    return {
      response: `I hear you. Let me break down what you're getting: the ${context.serviceName} includes design, development, quality testing, and a 7-day revision window. At $${(context.originalPrice / 100).toFixed(2)}, it comes out to less than a cup of coffee per day for the first month. I can offer a ${MAX_DISCOUNT_WITHOUT_APPROVAL}% discount if we close today — that brings it to $${((context.originalPrice * (1 - MAX_DISCOUNT_WITHOUT_APPROVAL / 100)) / 100).toFixed(2)}. Would that work?`,
      discountOffered: MAX_DISCOUNT_WITHOUT_APPROVAL,
      requiresOwnerApproval: false,
      nextStep: "close",
    };
  }

  // "Competitor is cheaper"
  if (/competitor|cheaper elsewhere|other option/i.test(objection)) {
    return {
      response: `Totally fair to shop around. Here's what makes us different: we test every deliverable against a 70-point quality gate before it reaches you, and we use your own brand assets in the preview so you see exactly what you're getting before you pay. Most providers send generic templates. If you find a better price elsewhere, send it to me and I'll see if I can match it — but I'd rather show you the value first. Can I send you a free preview?`,
      discountOffered: 0,
      requiresOwnerApproval: false,
      nextStep: "follow-up",
    };
  }

  // "Let me think about it"
  if (/think about|maybe later|not sure|let me consider/i.test(objection)) {
    return {
      response: `Of course — no pressure at all. Here's what I'll do: I'll send you the preview I already prepared (with your brand) via WhatsApp so you can take a look when it's convenient. If you have any questions, just reply to that message. The ${MAX_DISCOUNT_WITHOUT_APPROVAL}% discount is valid until end of day Friday. Sound fair?`,
      discountOffered: MAX_DISCOUNT_WITHOUT_APPROVAL,
      requiresOwnerApproval: false,
      nextStep: "follow-up",
    };
  }

  // Customer sounds annoyed — graceful exit
  if (/annoyed|not interested|stop calling|leave me alone/i.test(objection)) {
    return {
      response: `Absolutely, I apologize for the intrusion. I won't call again. If you ever need anything, the preview I sent is yours to keep. Have a great day!`,
      discountOffered: 0,
      requiresOwnerApproval: false,
      nextStep: "graceful-exit",
    };
  }

  // Requesting a bigger discount than allowed
  if (/discount|lower price|deal/i.test(objection)) {
    const discountMatch = objection.match(/(\d+)%/);
    const requestedDiscount = discountMatch ? parseInt(discountMatch[1], 10) : 0;
    if (requestedDiscount > MAX_DISCOUNT_WITHOUT_APPROVAL) {
      return {
        response: `A ${requestedDiscount}% discount is beyond what I can offer without checking with my team. Let me escalate this — I'll get back to you within 2 hours via WhatsApp with a final answer. Is that okay?`,
        discountOffered: 0,
        requiresOwnerApproval: true,
        nextStep: "escalate",
      };
    }
  }

  // Default response
  return {
    response: `That's a great question. Let me address that directly: the ${context.serviceName} is priced to include everything you need — no hidden fees. Would you like me to walk you through what's included?`,
    discountOffered: 0,
    requiresOwnerApproval: false,
    nextStep: "close",
  };
}
