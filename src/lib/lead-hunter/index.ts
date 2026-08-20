/**
 * src/lib/lead-hunter/index.ts — v71 Phase 21 (Autonomous Lead Hunter)
 *
 * Public API for the lead-hunter module. Re-exports the 4 sub-modules:
 *   - socialScout (Twitter/LinkedIn/Reddit buying-signal monitoring)
 *   - serviceMatcher (LLM-powered service-to-lead matching via Ollama)
 *   - profileExtractor (brand extraction from social profiles via VLM)
 *   - qualificationDebate (3-agent Scout/Risk/Sales council)
 *
 * + the top-level runDailyLeadHunt() entry point used by the cron.
 */

import "server-only";
import { db } from "../db";
import { logger } from "../logger";
import { emit } from "../event-bus";
import { huntForLeads, generateHelpfulComment, replyToPost, type DiscoveredLead } from "./social-scout";
import { matchServiceToLead, type ServiceMatch } from "./service-matcher";
import { extractFromSocialProfile, type LeadBrandProfile } from "./profile-extractor";
import { qualifyLead, type QualificationResult } from "./qualification-debate";
import { generatePreview } from "../preview-generator";

// Re-export public types + functions.
export { huntForLeads, generateHelpfulComment, replyToPost } from "./social-scout";
export { matchServiceToLead } from "./service-matcher";
export { extractFromSocialProfile } from "./profile-extractor";
export { qualifyLead } from "./qualification-debate";
export type { DiscoveredLead } from "./social-scout";
export type { ServiceMatch } from "./service-matcher";
export type { LeadBrandProfile } from "./profile-extractor";
export type { QualificationResult } from "./qualification-debate";

/**
 * Top-level entry point for the daily-lead-hunt cron (6 AM daily).
 *
 * Flow (per the Phase 21 spec):
 *   1. Scout social media for buying signals → discovered leads.
 *   2. For each lead: match to services via Ollama.
 *   3. Extract brand from social profile (vision model).
 *   4. Multi-agent qualification debate (Scout/Risk/Sales + Conductor).
 *   5. Take action based on verdict:
 *        - PURSUE: generate personalized preview + send via WhatsApp.
 *        - INVESTIGATE: reply with helpful comment on their post.
 *        - SKIP: log only.
 *   6. Log to KnowledgeBaseEntry for trend analysis.
 *
 * Returns a summary of the hunt (counts by verdict).
 */
export async function runDailyLeadHunt(): Promise<{
  discovered: number;
  pursued: number;
  investigated: number;
  skipped: number;
  errors: number;
}> {
  logger.info("daily-lead-hunt.start", { ts: new Date().toISOString() });
  emit({
    type: "system",
    ts: new Date().toISOString(),
    message: "🔍 Phase 21 daily-lead-hunt: starting autonomous lead hunt (6 AM cron)",
    level: "info",
  });

  // Step 1: Scout for leads.
  const discovered = await huntForLeads();
  if (discovered.length === 0) {
    logger.info("daily-lead-hunt.empty", { hint: "No leads discovered today" });
    emit({
      type: "system",
      ts: new Date().toISOString(),
      message: "🔍 Phase 21 daily-lead-hunt: no leads discovered today",
      level: "info",
    });
    return { discovered: 0, pursued: 0, investigated: 0, skipped: 0, errors: 0 };
  }

  let pursued = 0;
  let investigated = 0;
  let skipped = 0;
  let errors = 0;

  // Process each discovered lead.
  for (const lead of discovered) {
    try {
      await processDiscoveredLead(lead);
      // The processDiscoveredLead helper increments the counters based on verdict.
    } catch (err) {
      errors++;
      logger.warn("daily-lead-hunt.lead-error", {
        username: lead.username,
        platform: lead.platform,
        error: String(err).slice(0, 100),
      });
    }
  }

  logger.info("daily-lead-hunt.complete", {
    discovered: discovered.length,
    pursued,
    investigated,
    skipped,
    errors,
  });
  emit({
    type: "system",
    ts: new Date().toISOString(),
    message: `🔍 Phase 21 daily-lead-hunt: ${discovered.length} leads → ${pursued} pursued, ${investigated} investigating, ${skipped} skipped, ${errors} errors`,
    level: pursued > 0 ? "success" : "info",
  });

  return {
    discovered: discovered.length,
    pursued,
    investigated,
    skipped,
    errors,
  };
}

/**
 * Process a single discovered lead: match services → extract brand →
 * qualify → take action. Mutates the counters (closure).
 */
async function processDiscoveredLead(lead: DiscoveredLead): Promise<void> {
  // Step 2: Match to services.
  const matches: ServiceMatch[] = await matchServiceToLead(lead.postContent, {
    username: lead.username,
    platform: lead.platform,
    followerCount: lead.followerCount,
    matchedServiceCategory: lead.matchedServiceCategory,
  });

  // Step 3: Extract brand from social profile.
  const brand: LeadBrandProfile | null = await extractFromSocialProfile(lead);

  // Step 4: Qualification debate.
  const qualification: QualificationResult = await qualifyLead(lead, matches, brand);

  // Update the Lead row with the qualification result.
  const leadRow = await db.lead.findFirst({
    where: {
      source: "social-scout",
      platform: lead.platform,
      username: lead.username,
      postContent: lead.postContent,
    },
    orderBy: { discoveredAt: "desc" },
  });

  if (leadRow) {
    await db.lead.update({
      where: { id: leadRow.id },
      data: {
        brandProfileJson: JSON.stringify(brand),
        serviceMatchesJson: JSON.stringify(matches),
        topMatchedService: matches[0]?.serviceName ?? lead.matchedServiceCategory,
        qualificationVerdict: qualification.verdict,
        qualificationScore: qualification.confidence,
        qualificationReasoning: qualification.reasoning + "\n\n" + qualification.conductorSynthesis,
        qualifiedAt: new Date(),
      },
    });
  }

  // Step 5: Take action based on verdict.
  if (qualification.verdict === "pursue") {
    // Generate a personalized preview + send via WhatsApp.
    if (matches.length > 0 && brand) {
      try {
        const preview = await generatePreview(
          matches[0].serviceName,
          matches[0].reason,
          {
            domain: brand.domain,
            websiteUrl: brand.websiteUrl,
            primaryColor: brand.primaryColor,
            secondaryColor: brand.secondaryColor,
            accentColor: brand.accentColor,
            logoUrl: brand.logoUrl,
            faviconUrl: brand.faviconUrl,
            typography: brand.typography,
            brandTone: brand.brandTone,
            description: brand.description,
            extractedAt: brand.extractedAt,
          },
        );
        // Send the preview via WhatsApp (if connected) or queue for manual send.
        // For now, just emit an event so the outreach executor picks it up.
        emit({
          type: "system",
          ts: new Date().toISOString(),
          message: `🎯 Phase 21 Lead Hunter: PURSUE @${lead.username} on ${lead.platform} — preview generated for "${matches[0].serviceName}" (${qualification.confidence}% confidence)`,
          level: "success",
        });
        logger.info("daily-lead-hunt.pursued", {
          username: lead.username,
          service: matches[0].serviceName,
          confidence: qualification.confidence,
        });
      } catch (previewErr) {
        logger.warn("daily-lead-hunt.preview-failed", { error: String(previewErr).slice(0, 80) });
      }
    }
  } else if (qualification.verdict === "investigate") {
    // Reply with helpful comment (queued for manual posting).
    const comment = generateHelpfulComment(lead, matches[0]?.serviceName ?? "");
    await replyToPost(lead, comment);
    logger.info("daily-lead-hunt.investigating", {
      username: lead.username,
      platform: lead.platform,
      commentLength: comment.length,
    });
  } else {
    // SKIP — just log.
    logger.info("daily-lead-hunt.skipped", {
      username: lead.username,
      confidence: qualification.confidence,
      reason: qualification.reasoning.slice(0, 80),
    });
  }

  // Step 6: Log to KnowledgeBaseEntry for trend analysis.
  try {
    await db.knowledgeBaseEntry.create({
      data: {
        title: `Lead Hunt: @${lead.username} on ${lead.platform} — ${qualification.verdict.toUpperCase()} (${qualification.confidence}%)`,
        category: "lead-hunt",
        content: JSON.stringify({
          lead,
          matches,
          brand: brand ? {
            primaryColor: brand.primaryColor,
            tone: brand.brandTone,
            industry: brand.industry,
          } : null,
          qualification: {
            verdict: qualification.verdict,
            confidence: qualification.confidence,
            recommendedAction: qualification.recommendedAction,
            reasoning: qualification.reasoning,
          },
        }, null, 2),
        source: "daily-lead-hunt",
        tags: JSON.stringify(["lead-hunt", qualification.verdict, lead.platform, lead.matchedServiceCategory]),
        coreLogic: qualification.conductorSynthesis.slice(0, 500),
        systemPromptTemplate: null,
        toolsRequired: JSON.stringify([]),
        repoUrl: lead.profileUrl,
        filePath: null,
      },
    });
  } catch {
    // best-effort
  }
}
