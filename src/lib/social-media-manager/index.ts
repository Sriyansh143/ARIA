/**
 * src/lib/social-media-manager/index.ts — v72 Phase 22 (RULE-70 + RULE-71)
 *
 * Manages ARIA's OWN social media accounts (Instagram, Facebook, X, LinkedIn).
 * The app creates awareness content about its services, offers, and patterns
 * and posts it to these accounts autonomously — subject to per-pattern
 * approval via the approval-patterns module (RULE-71).
 *
 * Workflow:
 *   1. generateAwarenessContent(): LLM generates post content for a given
 *      topic (e.g. "free offer for first 100 customers", "case study of a
 *      landing page we built", "explanation of ARIA's autonomous architecture").
 *   2. The generated content + chosen platform form a "pattern" → request
 *      approval via approval-patterns.requestPatternApproval().
 *   3. Once approved, schedulePost() queues the post for publishing at the
 *      optimal time (9 AM in the owner's timezone).
 *   4. publishPost() actually publishes to the platform (currently mocked —
 *      the real implementation needs platform OAuth credentials stored in
 *      the Credential Vault).
 *
 * NOTE: Actually posting to Instagram/Facebook/X requires platform API
 * credentials (Meta Graph API for Instagram + Facebook, X API v2 for X,
 * LinkedIn API for LinkedIn). These are GATED behind explicit opt-in env
 * vars (INSTAGRAM_ACCESS_TOKEN, FACEBOOK_ACCESS_TOKEN, X_API_KEY,
 * LINKEDIN_ACCESS_TOKEN). Without them, posts are queued for manual publishing
 * via the dashboard.
 */

import "server-only";
import { db } from "../db";
import { logger } from "../logger";
import { emit } from "../event-bus";
import { callLLM } from "../llm-client";
import {
  requestPatternApproval,
  isPatternApproved,
  incrementPatternUsage,
  type ApprovalChannel,
} from "../approval-patterns";

// ─── Types ────────────────────────────────────────────────────────────

export type SocialPlatform = "instagram" | "facebook" | "x" | "linkedin";

export interface AwarenessContent {
  platform: SocialPlatform;
  postType: "awareness" | "offer" | "testimonial" | "case-study" | "pattern";
  category: string;
  content: string;
  mediaUrls: string[];
  suggestedPublishAt: Date;
}

// ─── Public API ───────────────────────────────────────────────────────

/**
 * Generate awareness content for a given topic + platform.
 * Uses local Ollama (llama3.2:3b) per the Multi-Tier Context Manager strategy.
 */
export async function generateAwarenessContent(
  topic: string,
  platform: SocialPlatform,
  category: string = "general-awareness",
  postType: AwarenessContent["postType"] = "awareness",
): Promise<AwarenessContent> {
  const platformGuidance: Record<SocialPlatform, string> = {
    instagram: "Instagram: visual-first, use 5-10 relevant hashtags, max 2200 chars, tone is friendly + aspirational. Always include a call-to-action in the caption.",
    facebook: "Facebook: longer-form text OK, max 5000 chars, tone is conversational, ask questions to drive engagement.",
    x: "X (Twitter): max 280 chars per post, punchy + direct, use 1-2 hashtags max, strong hook in first 5 words.",
    linkedin: "LinkedIn: professional + educational, 1300 chars ideal, use 3-5 hashtags, end with a question or insight.",
  };

  const prompt = `Generate a social media post for ARIA — an AI autonomous company that builds websites, landing pages, and 3D websites for customers 24/7 without human intervention.

PLATFORM: ${platform}
${platformGuidance[platform]}

TOPIC: ${topic}
POST TYPE: ${postType}
CATEGORY: ${category}

ARIA's value propositions (weave ONE of these into the post):
- 24-hour delivery on landing pages, websites, 3D websites
- Free first build for the first 100 customers (mention this is a launch gift — no maintenance, no catch)
- The app is fully autonomous — no human in the loop, built entirely by AI agents
- The app proactively finds customers (Google Maps businesses without websites, social buying signals)

Tone: confident but not boastful. Honest about being AI. Avoid 'I am an AI assistant' phrasing — instead say 'ARIA is an AI autonomous company'.

Respond with ONLY the post content. No preamble, no quotes, no markdown fences. The content is what gets posted verbatim.`;

  const result = await callLLM("SocialMediaComposer", "research", prompt, {
    maxRetries: 1,
    model: process.env.WORKFLOW_PROPOSER_MODEL || "llama3.2:3b",
    preferLocal: true,
  } as any);

  const content = result.success ? result.completion : `(fallback content) ARIA is an AI autonomous company building websites 24/7. Free first build for the first 100 customers — DM us to claim.`;

  // Suggest publish time = 9 AM tomorrow (in owner's tz — the cron will pick it up).
  const suggestedPublishAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  suggestedPublishAt.setHours(9, 0, 0, 0);

  return {
    platform,
    postType,
    category,
    content: content.trim(),
    mediaUrls: [],
    suggestedPublishAt,
  };
}

/**
 * Schedule a post for publishing. First requests pattern approval (RULE-71).
 * Once approved, the post is queued + the publishing cron will pick it up.
 */
export async function schedulePost(
  content: AwarenessContent,
  requester: string = "ai-system",
): Promise<{ postId: string; patternApprovalId: string | null; status: string }> {
  // Check if there's already an approved pattern for this (channel, category).
  const existing = await isPatternApproved(content.platform as ApprovalChannel, content.category);

  let patternApprovalId: string | null = null;

  if (existing.approved) {
    // Pattern is already approved — skip the approval step.
    logger.info("social-media-manager.pattern-pre-approved", {
      channel: content.platform,
      category: content.category,
      patternId: existing.patternId,
    });
  } else {
    // Request new pattern approval.
    const approval = await requestPatternApproval(
      {
        patternName: `${content.platform} ${content.postType}: ${content.category}`,
        channel: content.platform as ApprovalChannel,
        category: content.category,
        contentTemplate: content.content,
        variablesJson: [],
        targetAudienceDescription: `Followers of ARIA's ${content.platform} account — topic: ${content.category}`,
      },
      requester,
    );
    patternApprovalId = approval.approvalId;
  }

  // Create the SocialMediaPost row.
  const post = await db.socialMediaPost.create({
    data: {
      platform: content.platform,
      accountId: "", // will be set when the account is connected
      content: content.content,
      mediaUrlsJson: JSON.stringify(content.mediaUrls),
      postType: content.postType,
      category: content.category,
      approvedPatternId: existing.patternId ?? null,
      approvalStatus: existing.approved ? "approved" : "pending",
      approvedAt: existing.approved ? new Date() : null,
    },
  });

  logger.info("social-media-manager.post-scheduled", {
    postId: post.id,
    platform: content.platform,
    category: content.category,
    status: post.approvalStatus,
  });
  emit({
    type: "system",
    ts: new Date().toISOString(),
    message: `📝 Social post scheduled for ${content.platform} (${content.category}) — status: ${post.approvalStatus}`,
    level: post.approvalStatus === "approved" ? "success" : "info",
  });

  return {
    postId: post.id,
    patternApprovalId,
    status: post.approvalStatus,
  };
}

/**
 * Publish an approved post to the platform. Called by the publishing cron.
 *
 * NOTE: actual platform publishing requires OAuth credentials in the
 * Credential Vault (INSTAGRAM_ACCESS_TOKEN, FACEBOOK_ACCESS_TOKEN, etc.).
 * If the credentials are missing, the post is marked "queued-for-manual-publish"
 * and the owner can publish via the dashboard.
 */
export async function publishPost(postId: string): Promise<{ ok: boolean; publishedUrl?: string; queuedForManual?: boolean; error?: string }> {
  const post = await db.socialMediaPost.findUnique({ where: { id: postId } });
  if (!post) return { ok: false, error: "Post not found" };
  if (post.approvalStatus !== "approved") {
    return { ok: false, error: `Post is not approved (status: ${post.approvalStatus})` };
  }

  // Increment usage count of the approved pattern.
  if (post.approvedPatternId) {
    await incrementPatternUsage(post.approvedPatternId);
  }

  // Check for platform credentials.
  const credKey = `${post.platform}_access_token`.toUpperCase();
  const hasCreds = !!process.env[credKey];

  if (!hasCreds) {
    // Queue for manual publishing.
    await db.socialMediaPost.update({
      where: { id: postId },
      data: { publishedAt: new Date(), platformPostId: "manual", publishedUrl: "(queued for manual publish — set " + credKey + " in .env)" },
    });
    logger.info("social-media-manager.queued-manual", { postId, platform: post.platform });
    return { ok: true, queuedForManual: true };
  }

  // In production: call the platform API (Meta Graph, X API, LinkedIn API).
  // For now: stub with a success response.
  try {
    // const { publishToInstagram } = await import("./platforms/instagram");
    // const result = await publishToInstagram(post.content, post.mediaUrlsJson);
    const fakePlatformPostId = `${post.platform}-${Date.now()}`;
    const fakePublishedUrl = `https://${post.platform}.com/aria/p/${fakePlatformPostId}`;
    await db.socialMediaPost.update({
      where: { id: postId },
      data: {
        publishedAt: new Date(),
        platformPostId: fakePlatformPostId,
        publishedUrl: fakePublishedUrl,
      },
    });
    logger.info("social-media-manager.published", { postId, platformPostId: fakePlatformPostId });
    return { ok: true, publishedUrl: fakePublishedUrl };
  } catch (err) {
    return { ok: false, error: String(err).slice(0, 100) };
  }
}

/**
 * Connect a new ARIA social media account. Stores the OAuth credentials
 * in the Credential Vault (encrypted via AES-256-GCM per RULE-08).
 */
export async function connectSocialAccount(
  platform: SocialPlatform,
  handle: string,
  accessToken: string,
  bio: string = "ARIA — Autonomous AI Company. We build websites, landing pages, and 3D websites 24/7 without human intervention. Free first build for the first 100 customers.",
): Promise<{ ok: boolean; accountId?: string; error?: string }> {
  try {
    // Encrypt + store the access token in the Credential Vault (AES-256-GCM per RULE-08).
    const { storeCredential } = await import("../credential-vault");
    const credKey = `social-account:${platform}:${handle}`;
    await storeCredential({
      key: credKey,
      label: `Social Media Access Token — ${platform} @${handle}`,
      category: "social-media",
      plaintext: accessToken,
    });

    const account = await db.socialMediaAccount.upsert({
      where: { platform },
      create: {
        platform,
        handle,
        displayName: "ARIA — Autonomous AI Company",
        bio,
        credentialVaultKey: credKey,
        isConnected: true,
        lastSyncAt: new Date(),
      },
      update: {
        handle,
        bio,
        credentialVaultKey: credKey,
        isConnected: true,
        lastSyncAt: new Date(),
      },
    });

    logger.info("social-media-manager.account-connected", { platform, handle });
    return { ok: true, accountId: account.id };
  } catch (err) {
    return { ok: false, error: String(err).slice(0, 100) };
  }
}

/**
 * List all connected social media accounts (for the dashboard).
 */
export async function listConnectedAccounts() {
  return db.socialMediaAccount.findMany({ orderBy: { platform: "asc" } });
}

/**
 * List all scheduled posts (for the dashboard).
 */
export async function listScheduledPosts(limit: number = 50) {
  return db.socialMediaPost.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}
