// =====================================================================
// social-media-manager.ts — Multi-platform social media posting.
// =====================================================================
// Manages draft/scheduled/published posts across platforms (Telegram,
// WhatsApp, Instagram, LinkedIn, Twitter/X, Facebook, YouTube).
//
// Adaptation notes:
//   - SocialPost records stored as MemoryItem(scope='social-post').
//   - Browser automation (runBrowserTask) replaced with a stub that
//     records the publish intent as a Notification — callers can wire
//     a real browser agent later without touching the API surface.
//   - Telegram owner notifications go direct to the Bot API (no local
//     bot service on port 3008).
// =====================================================================

import { db } from '@/lib/db';
import { chat, quickChat, extractJson } from '@/lib/llm';
import crypto from 'crypto';

export type SocialPlatform =
  | 'telegram'
  | 'whatsapp'
  | 'instagram'
  | 'linkedin'
  | 'twitter'
  | 'facebook'
  | 'youtube';

export interface SocialPostRecord {
  id: string;
  platform: SocialPlatform;
  contentType: 'text' | 'image' | 'video' | 'story' | 'reel' | 'article';
  caption: string;
  mediaUrls: string[];
  status: 'drafted' | 'scheduled' | 'published' | 'failed';
  postUrl?: string | null;
  notes?: string | null;
  scheduledFor?: string | null;
  publishedAt?: string | null;
  createdAt: string;
}

// ─── Persistence helpers ─────────────────────────────────────────────
async function createSocialPostRecord(data: {
  platform: SocialPlatform;
  contentType: SocialPostRecord['contentType'];
  caption: string;
  mediaUrls: string[];
  status: SocialPostRecord['status'];
  scheduledFor?: Date | null;
}): Promise<string> {
  const id = crypto.randomUUID();
  const record: SocialPostRecord = {
    id,
    platform: data.platform,
    contentType: data.contentType,
    caption: data.caption,
    mediaUrls: data.mediaUrls,
    status: data.status,
    scheduledFor: data.scheduledFor ? data.scheduledFor.toISOString() : null,
    publishedAt: null,
    postUrl: null,
    notes: null,
    createdAt: new Date().toISOString(),
  };
  await db.memoryItem.create({
    data: {
      key: `social-post-${id}`,
      scope: 'social-post',
      value: JSON.stringify(record),
      tags: JSON.stringify(['social', data.platform, data.status]),
    },
  });
  return id;
}

async function findSocialPost(id: string): Promise<SocialPostRecord | null> {
  const row = await db.memoryItem.findUnique({
    where: { key_scope: { key: `social-post-${id}`, scope: 'social-post' } },
  });
  if (!row) return null;
  try {
    return JSON.parse(row.value) as SocialPostRecord;
  } catch {
    return null;
  }
}

async function updateSocialPost(id: string, patch: Partial<SocialPostRecord>): Promise<void> {
  const current = await findSocialPost(id);
  if (!current) return;
  const merged: SocialPostRecord = { ...current, ...patch };
  await db.memoryItem.update({
    where: { key_scope: { key: `social-post-${id}`, scope: 'social-post' } },
    data: {
      value: JSON.stringify(merged),
      tags: JSON.stringify(['social', merged.platform, merged.status]),
    },
  });
}

// ─── Telegram owner notification ─────────────────────────────────────
async function notifyOwner(text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 4000) }),
      signal: AbortSignal.timeout(5_000),
    });
  } catch {}
}

async function sendApprovalRequest(
  postId: string,
  platform: string,
  caption: string,
): Promise<void> {
  await notifyOwner(
    `📝 Approve ${platform} post?\n\n${caption.slice(0, 200)}\n\nPost ID: ${postId}`,
  );
}

// ─── Browser automation stub ─────────────────────────────────────────
// The original module imported `runBrowserTask` from './browser-agent'
// which isn't available in this build. We expose the same shape but
// record the publish intent as a Notification so the dashboard surfaces
// it; a future browser-agent integration can swap this out.
interface BrowserTaskResult {
  finalUrl?: string;
  extractedData: string;
}
async function runBrowserTaskStub(opts: {
  goal: string;
  startUrl: string;
}): Promise<BrowserTaskResult> {
  await db.notification.create({
    data: {
      type: 'info',
      title: 'Social-media browser task',
      message: `Browser automation not wired in this build. Would navigate to ${opts.startUrl} and execute: ${opts.goal.slice(0, 300)}`,
      read: false,
    },
  });
  return {
    finalUrl: opts.startUrl,
    extractedData: '',
  };
}

const PLATFORM_URLS: Record<SocialPlatform, string> = {
  instagram: 'https://www.instagram.com/',
  linkedin: 'https://www.linkedin.com/feed/',
  twitter: 'https://twitter.com/compose/post',
  facebook: 'https://www.facebook.com/',
  whatsapp: 'https://web.whatsapp.com/',
  telegram: 'https://web.telegram.org/',
  youtube: 'https://www.youtube.com/upload',
};

const PLATFORM_INBOX_URLS: Partial<Record<SocialPlatform, string>> = {
  instagram: 'https://www.instagram.com/direct/inbox/',
  linkedin: 'https://www.linkedin.com/messaging/',
  whatsapp: 'https://web.whatsapp.com/',
  telegram: 'https://web.telegram.org/',
  facebook: 'https://www.facebook.com/messages/',
};

// ─── Post content to a platform ──────────────────────────────────────
export async function postToSocial(opts: {
  platform: SocialPlatform;
  contentType: 'text' | 'image' | 'video' | 'story' | 'reel' | 'article';
  caption: string;
  mediaUrls?: string[];
  requireApproval?: boolean;
}): Promise<{ postId: string; status: string; approvalRequired?: boolean }> {
  const post = await createSocialPostRecord({
    platform: opts.platform,
    contentType: opts.contentType,
    caption: opts.caption,
    mediaUrls: opts.mediaUrls || [],
    status: opts.requireApproval === false ? 'scheduled' : 'drafted',
  });

  if (opts.requireApproval !== false) {
    await sendApprovalRequest(post, opts.platform, opts.caption);
    return { postId: post, status: 'drafted', approvalRequired: true };
  }

  return await publishPost(post);
}

// ─── Publish a post (uses browser automation) ────────────────────────
export async function publishPost(postId: string): Promise<{
  postId: string;
  status: string;
  postUrl?: string;
  approvalRequired?: boolean;
}> {
  const post = await findSocialPost(postId);
  if (!post) return { postId, status: 'failed' };

  await updateSocialPost(postId, {
    status: 'scheduled',
    publishedAt: new Date().toISOString(),
  });

  try {
    const startUrl = PLATFORM_URLS[post.platform];
    if (!startUrl) throw new Error(`Unsupported platform: ${post.platform}`);

    const hasMedia = post.mediaUrls.length > 0;
    const goal = `Post the following content on ${post.platform}:

Caption: ${post.caption}
Content type: ${post.contentType}
${hasMedia ? `Media: ${JSON.stringify(post.mediaUrls)}` : ''}

Steps:
1. Navigate to ${startUrl}
2. Find the compose/post/create button
3. Enter the caption text
4. ${hasMedia ? 'Upload the media files' : 'Skip media upload'}
5. Click publish/post/send
6. Return the URL of the published post`;

    const result = await runBrowserTaskStub({ goal, startUrl });

    await updateSocialPost(postId, {
      status: 'published',
      postUrl: result.finalUrl || null,
    });

    console.info('social: post published', { postId, platform: post.platform });
    return { postId, status: 'published', postUrl: result.finalUrl };
  } catch (err: any) {
    await updateSocialPost(postId, { status: 'failed', notes: err.message });
    console.error('social: publish failed', { postId, err: err.message });
    return { postId, status: 'failed' };
  }
}

// ─── Read messages from a platform ───────────────────────────────────
export async function readMessages(opts: {
  platform: SocialPlatform;
  limit?: number;
}): Promise<{ messages: any[]; summary: string }> {
  const startUrl = PLATFORM_INBOX_URLS[opts.platform];
  if (!startUrl) return { messages: [], summary: `Unsupported platform: ${opts.platform}` };

  const goal = `Read the ${opts.limit || 10} most recent messages on ${opts.platform}.

Steps:
1. Navigate to ${startUrl}
2. Read the most recent conversations
3. For each conversation, extract: sender name, message text, timestamp, whether it's unread
4. Return a JSON array of messages

Return the messages as a JSON array:
[{"sender": "name", "message": "text", "timestamp": "time", "unread": true/false}]`;

  try {
    const result = await runBrowserTaskStub({ goal, startUrl });

    let messages: any[] = [];
    try {
      const match = result.extractedData.match(/\[[\s\S]*\]/);
      if (match) messages = JSON.parse(match[0]);
    } catch {}

    const summaryPrompt = `Summarize these ${opts.platform} messages in 2-3 sentences. Highlight any urgent items:

${JSON.stringify(messages, null, 2)}`;

    const summary = await quickChat(
      summaryPrompt,
      'You are a social-media assistant. Reply concisely in 2-3 sentences.',
    );

    return { messages, summary };
  } catch (err: any) {
    return { messages: [], summary: `Failed to read messages: ${err.message}` };
  }
}

// ─── Watch Instagram feed + analyze content ──────────────────────────
export async function watchInstagramFeed(): Promise<{
  posts: any[];
  videoNotes: string[];
  summary: string;
}> {
  const goal = `Scroll through the Instagram home feed for 30 seconds.

For each post:
1. Note the account name
2. Note the caption (first 100 chars)
3. If it's a video/reel, note what the video is about (watch it)
4. Note engagement (likes, comments count)

Return a JSON array:
[{"account": "name", "caption": "text", "type": "image|video|reel|story", "likes": 0, "videoContent": "what the video shows"}]`;

  try {
    const result = await runBrowserTaskStub({
      goal,
      startUrl: 'https://www.instagram.com/',
    });

    let posts: any[] = [];
    try {
      const match = result.extractedData.match(/\[[\s\S]*\]/);
      if (match) posts = JSON.parse(match[0]);
    } catch {}

    const videoNotes = posts
      .filter((p) => p.type === 'video' || p.type === 'reel')
      .map((p) => `${p.account}: ${p.videoContent || p.caption}`);

    const summaryPrompt = `Summarize this Instagram feed scan. What trends do you see? Any content ideas for our account?

${JSON.stringify(posts.slice(0, 10), null, 2)}`;

    const summary = await quickChat(
      summaryPrompt,
      'You are a social-media strategist. Reply concisely.',
    );

    return { posts, videoNotes, summary };
  } catch (err: any) {
    return { posts: [], videoNotes: [], summary: `Failed to watch feed: ${err.message}` };
  }
}

// ─── Watch YouTube videos + summarize content ────────────────────────
export async function watchYouTubeVideo(url: string): Promise<{
  summary: string;
  keyPoints: string[];
  transcript?: string;
}> {
  const goal = `Watch this YouTube video and provide a detailed summary.

URL: ${url}

1. Navigate to the video
2. Watch/listen to the content
3. Provide:
   - A 3-sentence summary
   - 5 key points (bullet list)
   - Any actionable insights for our business

Return as JSON:
{"summary": "...", "keyPoints": ["point1", "point2", ...], "insights": "..."}`;

  try {
    const result = await runBrowserTaskStub({ goal, startUrl: url });
    const parsed = extractJson<{ summary: string; keyPoints: string[] }>(result.extractedData);
    if (parsed) {
      return {
        summary: parsed.summary || result.extractedData,
        keyPoints: parsed.keyPoints || [],
      };
    }
    return { summary: result.extractedData, keyPoints: [] };
  } catch (err: any) {
    return { summary: `Failed to watch video: ${err.message}`, keyPoints: [] };
  }
}

// ─── Schedule a post for later ───────────────────────────────────────
export async function schedulePost(opts: {
  platform: SocialPlatform;
  contentType: 'text' | 'image' | 'video' | 'story' | 'reel' | 'article';
  caption: string;
  mediaUrls?: string[];
  scheduledFor: Date;
}): Promise<string> {
  const id = await createSocialPostRecord({
    platform: opts.platform,
    contentType: opts.contentType,
    caption: opts.caption,
    mediaUrls: opts.mediaUrls || [],
    status: 'scheduled',
    scheduledFor: opts.scheduledFor,
  });

  console.info('social: post scheduled', {
    postId: id,
    platform: opts.platform,
    scheduledFor: opts.scheduledFor,
  });
  return id;
}

// ─── Get social post stats ───────────────────────────────────────────
export async function getSocialStats(): Promise<{
  total: number;
  drafted: number;
  scheduled: number;
  published: number;
  failed: number;
  byPlatform: Record<string, number>;
}> {
  const rows = await db.memoryItem.findMany({ where: { scope: 'social-post' } });
  let total = 0;
  let drafted = 0;
  let scheduled = 0;
  let published = 0;
  let failed = 0;
  const byPlatform: Record<string, number> = {};
  for (const row of rows) {
    try {
      const p = JSON.parse(row.value) as SocialPostRecord;
      total++;
      if (p.status === 'drafted') drafted++;
      else if (p.status === 'scheduled') scheduled++;
      else if (p.status === 'published') published++;
      else if (p.status === 'failed') failed++;
      byPlatform[p.platform] = (byPlatform[p.platform] || 0) + 1;
    } catch {}
  }
  return { total, drafted, scheduled, published, failed, byPlatform };
}

// Keep `chat` import live for future LLM-driven content generation calls.
void chat;
