/**
 * src/lib/simulation-scenarios/revenue-interaction.ts — v67 Phase 17
 * 50 scenarios testing revenue interaction flows.
 * Uses REAL generators (hook-engine, outreach-executor, negotiation).
 */

import type { SimulationScenario } from "./index";

export const REVENUE_INTERACTION_SCENARIOS: SimulationScenario[] = [
  // ─── Hook Scenarios (12) — test openers, score retention ──────
  {
    id: "rev-hook-01-brand-known",
    name: "Hook: Brand known — specific observation opener",
    type: "edge-case",
    execute: async () => {
      const { generateHook } = await import("../hook-engine");
      const hook = generateHook(
        { businessName: "Acme Corp", contactEmail: "info@acme.com", website: "acme.com", industry: "SaaS" },
        { domain: "acme.com", websiteUrl: "https://acme.com", primaryColor: "#2563eb", secondaryColor: "#1e40af", accentColor: "#3b82f6", logoUrl: "https://acme.com/logo.png", faviconUrl: null, typography: "Modern sans-serif", brandTone: "professional", description: "SaaS platform", extractedAt: new Date().toISOString() },
      );
      const noRobot = !hook.openingLine.toLowerCase().includes("i am an ai");
      const hasObservation = hook.openingLine.length > 20;
      return { criteriaMet: { "No 'I am an AI' opener": noRobot, "Has specific observation": hasObservation, "Strategy is brand-known": hook.strategy === "brand-known" }, output: hook.openingLine.slice(0, 80) };
    },
    successCriteria: ["No 'I am an AI' opener", "Has specific observation", "Strategy is brand-known"],
  },
  {
    id: "rev-hook-02-no-brand",
    name: "Hook: No brand data — ask questions strategy",
    type: "edge-case",
    execute: async () => {
      const { generateHook } = await import("../hook-engine");
      const hook = generateHook({ businessName: "Test Co", contactEmail: "test@test.com", industry: "retail" }, null);
      return { criteriaMet: { "Strategy is no-brand-ask": hook.strategy === "no-brand-ask", "Has fallback questions": hook.fallbackQuestions.length >= 2 }, output: hook.openingLine.slice(0, 80) };
    },
    successCriteria: ["Strategy is no-brand-ask", "Has fallback questions"],
  },
  {
    id: "rev-hook-03-confirmation",
    name: "Hook: Confirmation question present",
    type: "edge-case",
    execute: async () => {
      const { generateHook } = await import("../hook-engine");
      const hook = generateHook({ businessName: "Acme", contactEmail: "info@acme.com" }, null);
      return { criteriaMet: { "Confirmation question exists": hook.confirmationQuestion.length > 10 }, output: hook.confirmationQuestion.slice(0, 80) };
    },
    successCriteria: ["Confirmation question exists"],
  },
  {
    id: "rev-hook-04-playful-tone",
    name: "Hook: Playful brand tone detected",
    type: "edge-case",
    execute: async () => {
      const { generateHook } = await import("../hook-engine");
      const hook = generateHook(
        { businessName: "Fun Co", contactEmail: "hi@funco.com", industry: "entertainment" },
        { domain: "funco.com", websiteUrl: "https://funco.com", primaryColor: "#f59e0b", secondaryColor: "#ef4444", accentColor: "#f59e0b", logoUrl: null, faviconUrl: null, typography: null, brandTone: "playful", description: null, extractedAt: new Date().toISOString() },
      );
      return { criteriaMet: { "Tone is playful": hook.tone === "playful" }, output: `Tone: ${hook.tone}` };
    },
    successCriteria: ["Tone is playful"],
  },
  {
    id: "rev-hook-05-luxury-tone",
    name: "Hook: Luxury brand tone detected",
    type: "edge-case",
    execute: async () => {
      const { generateHook } = await import("../hook-engine");
      const hook = generateHook(
        { businessName: "Lux Brand", contactEmail: "info@lux.com", industry: "luxury" },
        { domain: "lux.com", websiteUrl: "https://lux.com", primaryColor: "#1a1a1a", secondaryColor: "#d4af37", accentColor: "#d4af37", logoUrl: null, faviconUrl: null, typography: null, brandTone: "luxury", description: null, extractedAt: new Date().toISOString() },
      );
      return { criteriaMet: { "Tone is luxury": hook.tone === "luxury" }, output: `Tone: ${hook.tone}` };
    },
    successCriteria: ["Tone is luxury"],
  },
  {
    id: "rev-hook-06-saas-industry",
    name: "Hook: SaaS industry observation",
    type: "edge-case",
    execute: async () => {
      const { generateHook } = await import("../hook-engine");
      const hook = generateHook({ businessName: "SaaS Co", contactEmail: "info@saas.com", industry: "SaaS", serviceInterest: "landing page" }, null);
      return { criteriaMet: { "Opening mentions SaaS": hook.openingLine.includes("SaaS") || hook.openingLine.includes("saas") }, output: hook.openingLine.slice(0, 80) };
    },
    successCriteria: ["Opening mentions SaaS"],
  },
  {
    id: "rev-hook-07-retail-industry",
    name: "Hook: Retail industry observation",
    type: "edge-case",
    execute: async () => {
      const { generateHook } = await import("../hook-engine");
      const hook = generateHook({ businessName: "Shop Co", contactEmail: "info@shop.com", industry: "retail", serviceInterest: "social post" }, null);
      return { criteriaMet: { "Opening mentions retail": hook.openingLine.includes("retail") }, output: hook.openingLine.slice(0, 80) };
    },
    successCriteria: ["Opening mentions retail"],
  },
  {
    id: "rev-hook-08-service-interest",
    name: "Hook: Service interest mentioned in opener",
    type: "edge-case",
    execute: async () => {
      const { generateHook } = await import("../hook-engine");
      const hook = generateHook({ businessName: "Test", contactEmail: "t@t.com", serviceInterest: "logo design" },
        { domain: "t.com", websiteUrl: "https://t.com", primaryColor: "#000", secondaryColor: null, accentColor: null, logoUrl: null, faviconUrl: null, typography: null, brandTone: "professional", description: null, extractedAt: new Date().toISOString() });
      return { criteriaMet: { "Service interest mentioned": hook.openingLine.includes("logo") || hook.confirmationQuestion.includes("logo") }, output: hook.confirmationQuestion.slice(0, 80) };
    },
    successCriteria: ["Service interest mentioned"],
  },
  {
    id: "rev-hook-09-minimalist-tone",
    name: "Hook: Minimalist brand tone",
    type: "edge-case",
    execute: async () => {
      const { generateHook } = await import("../hook-engine");
      const hook = generateHook({ businessName: "Min Co", contactEmail: "info@min.com" },
        { domain: "min.com", websiteUrl: "https://min.com", primaryColor: "#000000", secondaryColor: "#ffffff", accentColor: "#000", logoUrl: null, faviconUrl: null, typography: null, brandTone: "minimalist", description: null, extractedAt: new Date().toISOString() });
      return { criteriaMet: { "Tone is minimalist": hook.tone === "minimalist" }, output: `Tone: ${hook.tone}` };
    },
    successCriteria: ["Tone is minimalist"],
  },
  {
    id: "rev-hook-10-friendly-default",
    name: "Hook: Friendly tone as default for no-brand",
    type: "edge-case",
    execute: async () => {
      const { generateHook } = await import("../hook-engine");
      const hook = generateHook({ businessName: "Default Co", contactEmail: "info@default.com" }, null);
      return { criteriaMet: { "Default tone is friendly": hook.tone === "friendly" }, output: `Tone: ${hook.tone}` };
    },
    successCriteria: ["Default tone is friendly"],
  },
  {
    id: "rev-hook-11-3-questions",
    name: "Hook: Exactly 3 fallback questions for no-brand",
    type: "edge-case",
    execute: async () => {
      const { generateHook } = await import("../hook-engine");
      const hook = generateHook({ businessName: "Test", contactEmail: "t@t.com" }, null);
      return { criteriaMet: { "3 fallback questions": hook.fallbackQuestions.length === 3 }, output: `${hook.fallbackQuestions.length} questions` };
    },
    successCriteria: ["3 fallback questions"],
  },
  {
    id: "rev-hook-12-no-generic-spam",
    name: "Hook: Opening is NOT generic spam",
    type: "edge-case",
    execute: async () => {
      const { generateHook } = await import("../hook-engine");
      const hook = generateHook({ businessName: "Unique Co", contactEmail: "info@unique.com" }, null);
      const isGeneric = /dear (sir|madam)|to whom it may concern|i am writing to/i.test(hook.openingLine);
      return { criteriaMet: { "Not generic spam": !isGeneric }, output: isGeneric ? "GENERIC" : "PERSONALIZED" };
    },
    successCriteria: ["Not generic spam"],
  },

  // ─── Negotiation Scenarios (13) ───────────────────────────────
  {
    id: "rev-neg-01-too-expensive",
    name: "Negotiation: 'Too expensive' objection",
    type: "edge-case",
    execute: async () => {
      const { handleNegotiation } = await import("../hook-engine");
      const result = handleNegotiation("That's too expensive", { originalPrice: 9900, serviceName: "Landing Page", leadName: "Acme" });
      return { criteriaMet: { "Response addresses price": result.response.length > 20, "Offers discount": result.discountOffered > 0, "Next step is close": result.nextStep === "close" }, output: result.response.slice(0, 80) };
    },
    successCriteria: ["Response addresses price", "Offers discount", "Next step is close"],
  },
  {
    id: "rev-neg-02-competitor-cheaper",
    name: "Negotiation: 'Competitor is cheaper' objection",
    type: "edge-case",
    execute: async () => {
      const { handleNegotiation } = await import("../hook-engine");
      const result = handleNegotiation("Your competitor is cheaper", { originalPrice: 9900, serviceName: "Landing Page", leadName: "Acme" });
      return { criteriaMet: { "Differentiates": result.response.length > 20, "Next step is follow-up": result.nextStep === "follow-up" }, output: result.response.slice(0, 80) };
    },
    successCriteria: ["Differentiates", "Next step is follow-up"],
  },
  {
    id: "rev-neg-03-think-about-it",
    name: "Negotiation: 'Let me think about it' objection",
    type: "edge-case",
    execute: async () => {
      const { handleNegotiation } = await import("../hook-engine");
      const result = handleNegotiation("Let me think about it", { originalPrice: 9900, serviceName: "Landing Page", leadName: "Acme" });
      return { criteriaMet: { "Offers follow-up": result.response.length > 20, "Next step is follow-up": result.nextStep === "follow-up" }, output: result.response.slice(0, 80) };
    },
    successCriteria: ["Offers follow-up", "Next step is follow-up"],
  },
  {
    id: "rev-neg-04-annoyed",
    name: "Negotiation: Annoyed customer — graceful exit",
    type: "edge-case",
    execute: async () => {
      const { handleNegotiation } = await import("../hook-engine");
      const result = handleNegotiation("Stop calling me, I'm not interested", { originalPrice: 9900, serviceName: "Landing Page", leadName: "Acme" });
      return { criteriaMet: { "Graceful exit": result.nextStep === "graceful-exit", "No discount pushed": result.discountOffered === 0 }, output: result.response.slice(0, 80) };
    },
    successCriteria: ["Graceful exit", "No discount pushed"],
  },
  {
    id: "rev-neg-05-discount-15",
    name: "Negotiation: 15% discount request — requires owner approval",
    type: "edge-case",
    execute: async () => {
      const { handleNegotiation } = await import("../hook-engine");
      const result = handleNegotiation("Can you give me 15% discount?", { originalPrice: 9900, serviceName: "Landing Page", leadName: "Acme" });
      return { criteriaMet: { "Requires owner approval": result.requiresOwnerApproval, "Next step is escalate": result.nextStep === "escalate" }, output: result.response.slice(0, 80) };
    },
    successCriteria: ["Requires owner approval", "Next step is escalate"],
  },
  {
    id: "rev-neg-06-discount-5",
    name: "Negotiation: 5% discount request — within auto-approve limit",
    type: "edge-case",
    execute: async () => {
      const { handleNegotiation } = await import("../hook-engine");
      const result = handleNegotiation("Can you give me 5% discount?", { originalPrice: 9900, serviceName: "Landing Page", leadName: "Acme" });
      return { criteriaMet: { "Within auto-approve": !result.requiresOwnerApproval }, output: result.response.slice(0, 80) };
    },
    successCriteria: ["Within auto-approve"],
  },
  {
    id: "rev-neg-07-default",
    name: "Negotiation: Unknown objection — default response",
    type: "edge-case",
    execute: async () => {
      const { handleNegotiation } = await import("../hook-engine");
      const result = handleNegotiation("I have a question about the process", { originalPrice: 9900, serviceName: "Landing Page", leadName: "Acme" });
      return { criteriaMet: { "Default response exists": result.response.length > 20, "Next step is close": result.nextStep === "close" }, output: result.response.slice(0, 80) };
    },
    successCriteria: ["Default response exists", "Next step is close"],
  },
  {
    id: "rev-neg-08-can't-afford",
    name: "Negotiation: 'Can't afford it' — value stack response",
    type: "edge-case",
    execute: async () => {
      const { handleNegotiation } = await import("../hook-engine");
      const result = handleNegotiation("I can't afford that right now", { originalPrice: 9900, serviceName: "Landing Page", leadName: "Acme" });
      return { criteriaMet: { "Addresses affordability": result.response.length > 20, "Offers discount": result.discountOffered > 0 }, output: result.response.slice(0, 80) };
    },
    successCriteria: ["Addresses affordability", "Offers discount"],
  },
  {
    id: "rev-neg-09-not-sure",
    name: "Negotiation: 'Not sure' — follow-up with urgency",
    type: "edge-case",
    execute: async () => {
      const { handleNegotiation } = await import("../hook-engine");
      const result = handleNegotiation("I'm not sure if this is right for me", { originalPrice: 9900, serviceName: "Landing Page", leadName: "Acme" });
      return { criteriaMet: { "Follow-up offered": result.nextStep === "follow-up" }, output: result.response.slice(0, 80) };
    },
    successCriteria: ["Follow-up offered"],
  },
  {
    id: "rev-neg-10-leave-alone",
    name: "Negotiation: 'Leave me alone' — immediate exit",
    type: "edge-case",
    execute: async () => {
      const { handleNegotiation } = await import("../hook-engine");
      const result = handleNegotiation("Leave me alone", { originalPrice: 9900, serviceName: "Landing Page", leadName: "Acme" });
      return { criteriaMet: { "Graceful exit": result.nextStep === "graceful-exit" }, output: result.response.slice(0, 80) };
    },
    successCriteria: ["Graceful exit"],
  },
  {
    id: "rev-neg-11-discount-floor",
    name: "Negotiation: Discount floor enforced (max 10% without approval)",
    type: "edge-case",
    execute: async () => {
      const { handleNegotiation } = await import("../hook-engine");
      const result = handleNegotiation("Give me 20% off", { originalPrice: 9900, serviceName: "Landing Page", leadName: "Acme" });
      return { criteriaMet: { "Requires approval for >10%": result.requiresOwnerApproval }, output: result.response.slice(0, 80) };
    },
    successCriteria: ["Requires approval for >10%"],
  },
  {
    id: "rev-neg-12-price-breakdown",
    name: "Negotiation: Price includes breakdown (coffee analogy)",
    type: "edge-case",
    execute: async () => {
      const { handleNegotiation } = await import("../hook-engine");
      const result = handleNegotiation("too expensive", { originalPrice: 9900, serviceName: "Landing Page", leadName: "Acme" });
      return { criteriaMet: { "Includes value breakdown": /coffee|per day|includes/i.test(result.response) }, output: result.response.slice(0, 80) };
    },
    successCriteria: ["Includes value breakdown"],
  },
  {
    id: "rev-neg-13-apology",
    name: "Negotiation: Apology included for annoyed customer",
    type: "edge-case",
    execute: async () => {
      const { handleNegotiation } = await import("../hook-engine");
      const result = handleNegotiation("not interested, stop calling", { originalPrice: 9900, serviceName: "Landing Page", leadName: "Acme" });
      return { criteriaMet: { "Apologizes": /apologize|sorry/i.test(result.response) }, output: result.response.slice(0, 80) };
    },
    successCriteria: ["Apologizes"],
  },

  // ─── No-Brand Adaptation Scenarios (13) ───────────────────────
  {
    id: "rev-nobrand-01-playful",
    name: "No-brand: Customer says 'playful' → tone adapts",
    type: "edge-case",
    execute: async () => {
      const { adaptPitchLive } = await import("../hook-engine");
      const result = adaptPitchLive({ businessName: "Kids Co", contactEmail: "info@kids.com" }, { "What vibe do you want your brand to give off — professional, playful, luxury?": "playful and fun" });
      return { criteriaMet: { "Tone adapted to playful": result.suggestedTone === "playful", "Colors adapted": result.suggestedColors[0] === "#f59e0b" }, output: `Tone: ${result.suggestedTone}, Colors: ${result.suggestedColors.join(",")}` };
    },
    successCriteria: ["Tone adapted to playful", "Colors adapted"],
  },
  {
    id: "rev-nobrand-02-luxury",
    name: "No-brand: Customer says 'luxury' → tone adapts",
    type: "edge-case",
    execute: async () => {
      const { adaptPitchLive } = await import("../hook-engine");
      const result = adaptPitchLive({ businessName: "Lux Co", contactEmail: "info@lux.com" }, { "What vibe do you want your brand to give off — professional, playful, luxury?": "luxury and premium" });
      return { criteriaMet: { "Tone adapted to luxury": result.suggestedTone === "luxury", "Gold accent": result.suggestedColors[1] === "#d4af37" }, output: `Tone: ${result.suggestedTone}` };
    },
    successCriteria: ["Tone adapted to luxury", "Gold accent"],
  },
  {
    id: "rev-nobrand-03-minimalist",
    name: "No-brand: Customer says 'minimal' → tone adapts",
    type: "edge-case",
    execute: async () => {
      const { adaptPitchLive } = await import("../hook-engine");
      const result = adaptPitchLive({ businessName: "Min Co", contactEmail: "info@min.com" }, { "What vibe do you want your brand to give off — professional, playful, luxury?": "clean and minimal" });
      return { criteriaMet: { "Tone adapted to minimalist": result.suggestedTone === "minimalist" }, output: `Tone: ${result.suggestedTone}` };
    },
    successCriteria: ["Tone adapted to minimalist"],
  },
  {
    id: "rev-nobrand-04-professional-default",
    name: "No-brand: No vibe specified → defaults to professional",
    type: "edge-case",
    execute: async () => {
      const { adaptPitchLive } = await import("../hook-engine");
      const result = adaptPitchLive({ businessName: "Corp Co", contactEmail: "info@corp.com" }, {});
      return { criteriaMet: { "Default tone is professional": result.suggestedTone === "professional" }, output: `Tone: ${result.suggestedTone}` };
    },
    successCriteria: ["Default tone is professional"],
  },
  {
    id: "rev-nobrand-05-main-thing",
    name: "No-brand: Customer's main thing woven into pitch",
    type: "edge-case",
    execute: async () => {
      const { adaptPitchLive } = await import("../hook-engine");
      const result = adaptPitchLive({ businessName: "Service Co", contactEmail: "info@service.com" }, { "What's the main thing your customers come to you for?": "fast turnaround" });
      return { criteriaMet: { "Main thing in pitch": result.adaptedPitch.includes("fast turnaround") }, output: result.adaptedPitch.slice(0, 100) };
    },
    successCriteria: ["Main thing in pitch"],
  },
  {
    id: "rev-nobrand-06-fix-thing",
    name: "No-brand: Customer's fix-thing woven into pitch",
    type: "edge-case",
    execute: async () => {
      const { adaptPitchLive } = await import("../hook-engine");
      const result = adaptPitchLive({ businessName: "Fix Co", contactEmail: "info@fix.com" }, { "If you could fix one thing about your online presence, what would it be?": "better mobile experience" });
      return { criteriaMet: { "Fix thing in pitch": result.adaptedPitch.includes("better mobile experience") }, output: result.adaptedPitch.slice(0, 100) };
    },
    successCriteria: ["Fix thing in pitch"],
  },
  {
    id: "rev-nobrand-07-service-interest",
    name: "No-brand: Service interest in adapted pitch",
    type: "edge-case",
    execute: async () => {
      const { adaptPitchLive } = await import("../hook-engine");
      const result = adaptPitchLive({ businessName: "Design Co", contactEmail: "info@design.com", serviceInterest: "logo design" }, {});
      return { criteriaMet: { "Service interest in pitch": result.adaptedPitch.includes("logo design") }, output: result.adaptedPitch.slice(0, 100) };
    },
    successCriteria: ["Service interest in pitch"],
  },
  {
    id: "rev-nobrand-08-industry",
    name: "No-brand: Industry in adapted pitch",
    type: "edge-case",
    execute: async () => {
      const { adaptPitchLive } = await import("../hook-engine");
      const result = adaptPitchLive({ businessName: "Health Co", contactEmail: "info@health.com", industry: "healthcare" }, {});
      return { criteriaMet: { "Industry in pitch": result.adaptedPitch.includes("healthcare") }, output: result.adaptedPitch.slice(0, 100) };
    },
    successCriteria: ["Industry in pitch"],
  },
  {
    id: "rev-nobrand-09-2hr-delivery",
    name: "No-brand: Pitch mentions 2-hour delivery",
    type: "edge-case",
    execute: async () => {
      const { adaptPitchLive } = await import("../hook-engine");
      const result = adaptPitchLive({ businessName: "Fast Co", contactEmail: "info@fast.com" }, {});
      return { criteriaMet: { "2 hours mentioned": result.adaptedPitch.includes("2 hours") }, output: result.adaptedPitch.slice(0, 100) };
    },
    successCriteria: ["2 hours mentioned"],
  },
  {
    id: "rev-nobrand-10-cta",
    name: "No-brand: Pitch has a CTA (Want me to go ahead?)",
    type: "edge-case",
    execute: async () => {
      const { adaptPitchLive } = await import("../hook-engine");
      const result = adaptPitchLive({ businessName: "CTA Co", contactEmail: "info@cta.com" }, {});
      return { criteriaMet: { "CTA exists": /want me to|shall i|can i/i.test(result.adaptedPitch) }, output: result.adaptedPitch.slice(0, 100) };
    },
    successCriteria: ["CTA exists"],
  },
  {
    id: "rev-nobrand-11-colors-length",
    name: "No-brand: Suggested colors array has 2 entries",
    type: "edge-case",
    execute: async () => {
      const { adaptPitchLive } = await import("../hook-engine");
      const result = adaptPitchLive({ businessName: "Color Co", contactEmail: "info@color.com" }, {});
      return { criteriaMet: { "2 colors suggested": result.suggestedColors.length === 2 }, output: result.suggestedColors.join(", ") };
    },
    successCriteria: ["2 colors suggested"],
  },
  {
    id: "rev-nobrand-12-pitch-length",
    name: "No-brand: Adapted pitch is substantial (>100 chars)",
    type: "edge-case",
    execute: async () => {
      const { adaptPitchLive } = await import("../hook-engine");
      const result = adaptPitchLive({ businessName: "Sub Co", contactEmail: "info@sub.com" }, {});
      return { criteriaMet: { "Pitch > 100 chars": result.adaptedPitch.length > 100 }, output: `${result.adaptedPitch.length} chars` };
    },
    successCriteria: ["Pitch > 100 chars"],
  },
  {
    id: "rev-nobrand-13-no-hallucination",
    name: "No-brand: Pitch doesn't hallucinate brand details",
    type: "edge-case",
    execute: async () => {
      const { adaptPitchLive } = await import("../hook-engine");
      const result = adaptPitchLive({ businessName: "Test Co", contactEmail: "info@test.com" }, {});
      const hallucinates = /your logo|your brand colors|your typography/i.test(result.adaptedPitch);
      return { criteriaMet: { "No hallucinated brand details": !hallucinates }, output: hallucinates ? "HALLUCINATED" : "CLEAN" };
    },
    successCriteria: ["No hallucinated brand details"],
  },

  // ─── Preview Confirmation Scenarios (12) ──────────────────────
  {
    id: "rev-preview-01-email-attachment",
    name: "Preview: Email includes personalized preview text",
    type: "customer-purchase",
    execute: async () => {
      const { generatePreview } = await import("../preview-generator");
      const preview = generatePreview("Landing Page", "AI-powered landing page", {
        domain: "test.com", websiteUrl: "https://test.com", primaryColor: "#2563eb", secondaryColor: "#1e40af", accentColor: "#3b82f6", logoUrl: null, faviconUrl: null, typography: "sans-serif", brandTone: "professional", description: "Test", extractedAt: new Date().toISOString(),
      });
      return { criteriaMet: { "Preview text exists": preview.previewText.length > 50, "Brand colors mentioned": preview.previewText.includes("#2563eb") }, output: preview.previewText.slice(0, 80) };
    },
    successCriteria: ["Preview text exists", "Brand colors mentioned"],
  },
  {
    id: "rev-preview-02-html-generated",
    name: "Preview: HTML preview generated with brand colors",
    type: "customer-purchase",
    execute: async () => {
      const { generatePreview } = await import("../preview-generator");
      const preview = generatePreview("Logo Design", "Custom logo", {
        domain: "test.com", websiteUrl: "https://test.com", primaryColor: "#ff0000", secondaryColor: "#00ff00", accentColor: "#0000ff", logoUrl: null, faviconUrl: null, typography: null, brandTone: "playful", description: null, extractedAt: new Date().toISOString(),
      });
      return { criteriaMet: { "HTML exists": preview.html.length > 100, "Primary color in HTML": preview.html.includes("#ff0000"), "Secondary in HTML": preview.html.includes("#00ff00") }, output: `${preview.html.length} chars` };
    },
    successCriteria: ["HTML exists", "Primary color in HTML", "Secondary in HTML"],
  },
  {
    id: "rev-preview-03-domain-in-preview",
    name: "Preview: Lead domain in preview text",
    type: "customer-purchase",
    execute: async () => {
      const { generatePreview } = await import("../preview-generator");
      const preview = generatePreview("Blog Post", "SEO blog post", {
        domain: "acmecorp.io", websiteUrl: "https://acmecorp.io", primaryColor: "#000", secondaryColor: null, accentColor: null, logoUrl: null, faviconUrl: null, typography: null, brandTone: "professional", description: null, extractedAt: new Date().toISOString(),
      });
      return { criteriaMet: { "Domain in preview": preview.previewText.includes("acmecorp.io") }, output: preview.previewText.slice(0, 80) };
    },
    successCriteria: ["Domain in preview"],
  },
  {
    id: "rev-preview-04-tone-in-preview",
    name: "Preview: Brand tone in HTML",
    type: "customer-purchase",
    execute: async () => {
      const { generatePreview } = await import("../preview-generator");
      const preview = generatePreview("Social Post", "Instagram post", {
        domain: "test.com", websiteUrl: "https://test.com", primaryColor: "#f59e0b", secondaryColor: "#ef4444", accentColor: "#f59e0b", logoUrl: null, faviconUrl: null, typography: null, brandTone: "playful", description: null, extractedAt: new Date().toISOString(),
      });
      return { criteriaMet: { "Tone in HTML": preview.html.includes("playful") }, output: "Tone in preview" };
    },
    successCriteria: ["Tone in HTML"],
  },
  {
    id: "rev-preview-05-logo-in-html",
    name: "Preview: Logo URL in HTML when available",
    type: "customer-purchase",
    execute: async () => {
      const { generatePreview } = await import("../preview-generator");
      const preview = generatePreview("Landing Page", "Custom landing page", {
        domain: "test.com", websiteUrl: "https://test.com", primaryColor: "#000", secondaryColor: null, accentColor: null, logoUrl: "https://test.com/logo.png", faviconUrl: null, typography: null, brandTone: "professional", description: null, extractedAt: new Date().toISOString(),
      });
      return { criteriaMet: { "Logo URL in HTML": preview.html.includes("test.com/logo.png") }, output: "Logo in preview" };
    },
    successCriteria: ["Logo URL in HTML"],
  },
  {
    id: "rev-preview-06-no-logo-handled",
    name: "Preview: No logo — HTML handles gracefully",
    type: "customer-purchase",
    execute: async () => {
      const { generatePreview } = await import("../preview-generator");
      const preview = generatePreview("Landing Page", "Custom landing page", {
        domain: "test.com", websiteUrl: "https://test.com", primaryColor: "#000", secondaryColor: null, accentColor: null, logoUrl: null, faviconUrl: null, typography: null, brandTone: "professional", description: null, extractedAt: new Date().toISOString(),
      });
      return { criteriaMet: { "HTML valid without logo": preview.html.length > 100, "No broken img": !preview.html.includes('src=""') }, output: "No-logo handled" };
    },
    successCriteria: ["HTML valid without logo", "No broken img"],
  },
  {
    id: "rev-preview-07-default-colors",
    name: "Preview: Default colors when brand has none",
    type: "customer-purchase",
    execute: async () => {
      const { generatePreview } = await import("../preview-generator");
      const preview = generatePreview("Landing Page", "Custom landing page", {
        domain: "test.com", websiteUrl: "https://test.com", primaryColor: null, secondaryColor: null, accentColor: null, logoUrl: null, faviconUrl: null, typography: null, brandTone: null, description: null, extractedAt: new Date().toISOString(),
      });
      return { criteriaMet: { "Default primary in HTML": preview.html.includes("#2563eb") }, output: "Default colors applied" };
    },
    successCriteria: ["Default primary in HTML"],
  },
  {
    id: "rev-preview-08-typography-in-html",
    name: "Preview: Typography in HTML when available",
    type: "customer-purchase",
    execute: async () => {
      const { generatePreview } = await import("../preview-generator");
      const preview = generatePreview("Landing Page", "Custom landing page", {
        domain: "test.com", websiteUrl: "https://test.com", primaryColor: "#000", secondaryColor: null, accentColor: null, logoUrl: null, faviconUrl: null, typography: "Georgia serif", brandTone: "professional", description: null, extractedAt: new Date().toISOString(),
      });
      return { criteriaMet: { "Typography in HTML": preview.html.includes("Georgia serif") }, output: "Typography in preview" };
    },
    successCriteria: ["Typography in HTML"],
  },
  {
    id: "rev-preview-09-generated-timestamp",
    name: "Preview: Has generatedAt timestamp",
    type: "customer-purchase",
    execute: async () => {
      const { generatePreview } = await import("../preview-generator");
      const preview = generatePreview("Landing Page", "Custom landing page", {
        domain: "test.com", websiteUrl: "https://test.com", primaryColor: "#000", secondaryColor: null, accentColor: null, logoUrl: null, faviconUrl: null, typography: null, brandTone: "professional", description: null, extractedAt: new Date().toISOString(),
      });
      return { criteriaMet: { "Timestamp exists": !!preview.generatedAt }, output: preview.generatedAt };
    },
    successCriteria: ["Timestamp exists"],
  },
  {
    id: "rev-preview-10-brand-profile-attached",
    name: "Preview: Brand profile attached to result",
    type: "customer-purchase",
    execute: async () => {
      const { generatePreview } = await import("../preview-generator");
      const preview = generatePreview("Landing Page", "Custom landing page", {
        domain: "test.com", websiteUrl: "https://test.com", primaryColor: "#000", secondaryColor: null, accentColor: null, logoUrl: null, faviconUrl: null, typography: null, brandTone: "professional", description: null, extractedAt: new Date().toISOString(),
      });
      return { criteriaMet: { "Brand profile exists": !!preview.brandProfile, "Domain in profile": preview.brandProfile.domain === "test.com" }, output: "Brand profile attached" };
    },
    successCriteria: ["Brand profile exists", "Domain in profile"],
  },
  {
    id: "rev-preview-11-protected-preview",
    name: "Preview: Protected preview creates watermark",
    type: "customer-purchase",
    execute: async () => {
      const { createProtectedPreview } = await import("../protected-preview");
      const preview = await createProtectedPreview("order-123", "customer@test.com", false);
      return { criteriaMet: { "Preview ID exists": !!preview.previewId, "Watermark token exists": !!preview.watermarkToken, "Not owner": !preview.isOwner, "Has protection layers": preview.protectionLayers.length >= 5 }, output: `Preview: ${preview.previewId}` };
    },
    successCriteria: ["Preview ID exists", "Watermark token exists", "Not owner", "Has protection layers"],
  },
  {
    id: "rev-preview-12-owner-preview",
    name: "Preview: Owner gets full access preview",
    type: "customer-purchase",
    execute: async () => {
      const { createProtectedPreview } = await import("../protected-preview");
      const preview = await createProtectedPreview("order-123", "owner@aria.ai", true);
      return { criteriaMet: { "Is owner": preview.isOwner, "Preview URL exists": !!preview.previewUrl }, output: `Owner preview: ${preview.previewUrl}` };
    },
    successCriteria: ["Is owner", "Preview URL exists"],
  },
];
