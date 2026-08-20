/**
 * src/lib/connector-marketplace.ts — Connector Marketplace v2.
 *
 * v30 upgrade:
 *   - DB-backed install state (persists across restarts via the Setting table).
 *   - NEW "ARIA" category — built-in connectors backed by z-ai-web-dev-sdk
 *     capabilities (LLM, TTS, ASR, VLM, image-gen, web-search, web-reader,
 *     video-understand, charts, docx, xlsx, pdf, pptx). These are always
 *     "installed" and invocable — ClawHub-style skill registry.
 *   - External connectors (CRM, Comms, Payments, Documents) — install state
 *     persisted in `Setting.connector.installed` JSON.
 *
 * Task ID: v30-CONNECTORS (Task 5).
 */
import { db } from "./db";
import { logger } from "./logger";

// ─── Types ─────────────────────────────────────────────────────────

export type ConnectorCategory = "ARIA" | "CRM" | "Comms" | "Payments" | "Documents";
export type ConnectorAuthType =
  | "none"           // built-in ARIA connectors — no setup needed
  | "api_key"
  | "oauth2"
  | "webhook"
  | "bot_token"
  | "publishable_key";
export type ConnectorStatus = "available" | "installed" | "coming_soon";

export interface Connector {
  id: string;
  name: string;
  category: ConnectorCategory;
  description: string;
  authType: ConnectorAuthType;
  setupSteps: string[];
  status: ConnectorStatus;
  rating: number;
  installs: number;
  author: string;
  accent: string;
  icon: string;
  /** Built-in ARIA connectors have an invocable handler. */
  invoke?: (input: unknown) => Promise<unknown>;
  /** Whether this is a built-in ARIA capability (always installed). */
  builtIn?: boolean;
}

// ─── Built-in ARIA connectors (ClawHub-style skill registry) ───────
// These wrap the z-ai-web-dev-sdk capabilities that ARIA already has
// access to. They're always "installed" and invocable — no setup needed.

const ARIA_CONNECTORS: Connector[] = [
  {
    id: "aria.llm.chat",
    name: "ARIA LLM Chat",
    category: "ARIA",
    description: "Multi-provider LLM completions (Z-AI → Groq → NVIDIA → Ollama failover). Complexity-aware routing.",
    authType: "none",
    setupSteps: ["No setup needed — uses ARIA's built-in 4-provider failover chain."],
    status: "installed",
    rating: 5.0,
    installs: 0,
    author: "ARIA",
    accent: "#6D28D9",
    icon: "Sparkles",
    builtIn: true,
  },
  {
    id: "aria.tts.generate",
    name: "ARIA Text-to-Speech",
    category: "ARIA",
    description: "Synthesize natural-sounding speech from text. Multiple voices, adjustable speed, multiple audio formats.",
    authType: "none",
    setupSteps: ["No setup needed — uses z-ai-web-dev-sdk TTS."],
    status: "installed",
    rating: 4.8,
    installs: 0,
    author: "ARIA",
    accent: "#F59E0B",
    icon: "Volume2",
    builtIn: true,
  },
  {
    id: "aria.asr.transcribe",
    name: "ARIA Speech-to-Text",
    category: "ARIA",
    description: "Transcribe audio files to text. Supports base64-encoded audio, multiple formats (MP3, WAV, etc.).",
    authType: "none",
    setupSteps: ["No setup needed — uses z-ai-web-dev-sdk ASR."],
    status: "installed",
    rating: 4.7,
    installs: 0,
    author: "ARIA",
    accent: "#10B981",
    icon: "Mic",
    builtIn: true,
  },
  {
    id: "aria.vlm.analyze",
    name: "ARIA Vision (VLM)",
    category: "ARIA",
    description: "Analyze images with a vision-language model. Describe visual content, answer questions about images.",
    authType: "none",
    setupSteps: ["No setup needed — uses z-ai-web-dev-sdk VLM."],
    status: "installed",
    rating: 4.9,
    installs: 0,
    author: "ARIA",
    accent: "#EC4899",
    icon: "Eye",
    builtIn: true,
  },
  {
    id: "aria.image.generate",
    name: "ARIA Image Generation",
    category: "ARIA",
    description: "Generate images from text descriptions. Multiple sizes, base64-encoded output.",
    authType: "none",
    setupSteps: ["No setup needed — uses z-ai-web-dev-sdk image generation."],
    status: "installed",
    rating: 4.8,
    installs: 0,
    author: "ARIA",
    accent: "#8B5CF6",
    icon: "ImageIcon",
    builtIn: true,
  },
  {
    id: "aria.image.edit",
    name: "ARIA Image Editing",
    category: "ARIA",
    description: "Edit existing images with AI. Create variations, modify content, redesign assets based on text descriptions.",
    authType: "none",
    setupSteps: ["No setup needed — uses z-ai-web-dev-sdk image editing."],
    status: "installed",
    rating: 4.6,
    installs: 0,
    author: "ARIA",
    accent: "#8B5CF6",
    icon: "ImageIcon",
    builtIn: true,
  },
  {
    id: "aria.web.search",
    name: "ARIA Web Search",
    category: "ARIA",
    description: "Search the web for real-time information. Returns structured results with URLs, snippets, and metadata.",
    authType: "none",
    setupSteps: ["No setup needed — uses z-ai-web-dev-sdk web search."],
    status: "installed",
    rating: 4.9,
    installs: 0,
    author: "ARIA",
    accent: "#06B6D4",
    icon: "Search",
    builtIn: true,
  },
  {
    id: "aria.web.read",
    name: "ARIA Web Reader",
    category: "ARIA",
    description: "Extract content from any web page. Returns title, HTML, published time, and clean text.",
    authType: "none",
    setupSteps: ["No setup needed — uses z-ai-web-dev-sdk page reader."],
    status: "installed",
    rating: 4.7,
    installs: 0,
    author: "ARIA",
    accent: "#06B6D4",
    icon: "Globe",
    builtIn: true,
  },
  {
    id: "aria.video.understand",
    name: "ARIA Video Understanding",
    category: "ARIA",
    description: "Analyze video content — motion, temporal sequences, scene descriptions. MP4, AVI, MOV supported.",
    authType: "none",
    setupSteps: ["No setup needed — uses z-ai-web-dev-sdk video understanding."],
    status: "installed",
    rating: 4.5,
    installs: 0,
    author: "ARIA",
    accent: "#EF4444",
    icon: "Video",
    builtIn: true,
  },
  {
    id: "aria.charts.generate",
    name: "ARIA Charts & Diagrams",
    category: "ARIA",
    description: "Generate professional charts (bar, line, pie, scatter, heatmap) and diagrams (flowchart, mind map, architecture) as PNG/SVG.",
    authType: "none",
    setupSteps: ["No setup needed — uses ARIA's built-in chart engine."],
    status: "installed",
    rating: 4.6,
    installs: 0,
    author: "ARIA",
    accent: "#3B82F6",
    icon: "BarChart3",
    builtIn: true,
  },
  {
    id: "aria.docx.create",
    name: "ARIA Word Document",
    category: "ARIA",
    description: "Create professional .docx documents with formatting, tables, images, tracked changes, and comments.",
    authType: "none",
    setupSteps: ["No setup needed — uses ARIA's built-in docx engine."],
    status: "installed",
    rating: 4.7,
    installs: 0,
    author: "ARIA",
    accent: "#0EA5E9",
    icon: "FileText",
    builtIn: true,
  },
  {
    id: "aria.xlsx.create",
    name: "ARIA Excel Spreadsheet",
    category: "ARIA",
    description: "Create .xlsx spreadsheets with formulas, charts, pivot tables, and data validation.",
    authType: "none",
    setupSteps: ["No setup needed — uses ARIA's built-in xlsx engine."],
    status: "installed",
    rating: 4.6,
    installs: 0,
    author: "ARIA",
    accent: "#22C55E",
    icon: "Table",
    builtIn: true,
  },
  {
    id: "aria.pdf.create",
    name: "ARIA PDF Generator",
    category: "ARIA",
    description: "Generate professional PDFs — reports, proposals, contracts, white papers, posters, infographics.",
    authType: "none",
    setupSteps: ["No setup needed — uses ARIA's built-in PDF engine."],
    status: "installed",
    rating: 4.8,
    installs: 0,
    author: "ARIA",
    accent: "#F97316",
    icon: "FileText",
    builtIn: true,
  },
  {
    id: "aria.pptx.create",
    name: "ARIA PowerPoint",
    category: "ARIA",
    description: "Create .pptx presentations with layouts, speaker notes, charts, and animations.",
    authType: "none",
    setupSteps: ["No setup needed — uses ARIA's built-in pptx engine."],
    status: "installed",
    rating: 4.5,
    installs: 0,
    author: "ARIA",
    accent: "#F59E0B",
    icon: "Presentation",
    builtIn: true,
  },
  {
    id: "aria.agent.browser",
    name: "ARIA Browser Agent",
    category: "ARIA",
    description: "Headless browser automation — navigate, click, type, snapshot pages. Rust-based CLI with Node.js fallback.",
    authType: "none",
    setupSteps: ["No setup needed — uses ARIA's built-in browser agent."],
    status: "installed",
    rating: 4.4,
    installs: 0,
    author: "ARIA",
    accent: "#A855F7",
    icon: "Globe",
    builtIn: true,
  },
  {
    id: "aria.service.build",
    name: "ARIA Service Builder",
    category: "ARIA",
    description: "Generate real software deliverables — websites, 3D sites, voice agents, SaaS scaffolds, CLI tools — from a text spec.",
    authType: "none",
    setupSteps: ["No setup needed — powered by ARIA's 37-agent fleet."],
    status: "installed",
    rating: 5.0,
    installs: 0,
    author: "ARIA",
    accent: "#6D28D9",
    icon: "Layers",
    builtIn: true,
  },
];

// ─── External connectors (require setup) ───────────────────────────

export const CONNECTORS: Connector[] = [
  // ─── CRM ───────────────────────────────────────────────────────
  {
    id: "twenty-crm",
    name: "Twenty CRM",
    category: "CRM",
    description:
      "Open-source modern CRM with visual pipeline, contacts, and a GraphQL API. Self-host or cloud.",
    authType: "api_key",
    setupSteps: [
      "Create a Twenty CRM workspace",
      "Generate an API key in Settings → Developers",
      "Paste the API key + workspace URL into ARIA",
      "Verify the contact sync (1-way pull)",
    ],
    status: "available",
    rating: 4.6,
    installs: 1280,
    author: "Twenty",
    accent: "#facc15",
    icon: "Users",
  },
  {
    id: "hubspot",
    name: "HubSpot",
    category: "CRM",
    description:
      "All-in-one CRM, marketing, sales, and service hub. OAuth2 with scoped access to contacts, deals, and tickets.",
    authType: "oauth2",
    setupSteps: [
      "Create a HubSpot private app",
      "Add required scopes (contacts, deals, tickets)",
      "Authorize ARIA via the OAuth2 redirect",
      "Map custom deal properties",
    ],
    status: "available",
    rating: 4.7,
    installs: 9450,
    author: "HubSpot Inc.",
    accent: "#ff7a59",
    icon: "Contact",
  },
  {
    id: "attio",
    name: "Attio",
    category: "CRM",
    description:
      "Next-gen CRM with custom objects, real-time sync, and a flexible data model. API-key based.",
    authType: "api_key",
    setupSteps: [
      "Create an Attio workspace",
      "Generate a workspace API token",
      "Connect the token in ARIA",
      "Sync records list (people + companies)",
    ],
    status: "available",
    rating: 4.5,
    installs: 740,
    author: "Attio",
    accent: "#a78bfa",
    icon: "Boxes",
  },
  {
    id: "pipedrive",
    name: "Pipedrive",
    category: "CRM",
    description:
      "Sales-focused pipeline CRM. OAuth2 with full deal, person, and activity API access.",
    authType: "oauth2",
    setupSteps: [
      "Register an OAuth client in Pipedrive Marketplace",
      "Add scopes: deals, persons, activities",
      "Authorize via OAuth redirect",
      "Pull pipeline stages",
    ],
    status: "available",
    rating: 4.4,
    installs: 3120,
    author: "Pipedrive",
    accent: "#1a1a1a",
    icon: "Pipe",
  },

  // ─── Comms ─────────────────────────────────────────────────────
  {
    id: "slack",
    name: "Slack",
    category: "Comms",
    description:
      "Send messages, listen on channels, post to threads. Bot-token based with Webhook fallback.",
    authType: "bot_token",
    setupSteps: [
      "Create a Slack app at api.slack.com/apps",
      "Add scopes: chat:write, channels:read, files:write",
      "Install to workspace + copy the Bot User OAuth Token",
      "Subscribe to event callbacks (optional)",
    ],
    status: "available",
    rating: 4.8,
    installs: 15600,
    author: "Salesforce / Slack",
    accent: "#4a154b",
    icon: "MessageSquare",
  },
  {
    id: "discord",
    name: "Discord",
    category: "Comms",
    description:
      "Bot-based messaging for community + ops channels. Supports slash commands and rich embeds.",
    authType: "bot_token",
    setupSteps: [
      "Create an application at discord.com/developers",
      "Add a Bot user + copy the token",
      "Invite the bot to your server with send/read scopes",
      "Register slash commands (optional)",
    ],
    status: "available",
    rating: 4.5,
    installs: 6280,
    author: "Discord",
    accent: "#5865f2",
    icon: "Hash",
  },
  {
    id: "telegram",
    name: "Telegram",
    category: "Comms",
    description:
      "Bot API for sending messages, files, and inline keyboards. Webhook or long-polling mode.",
    authType: "bot_token",
    setupSteps: [
      "Talk to @BotFather on Telegram → /newbot",
      "Copy the bot token",
      "Set a webhook URL or enable long-polling",
      "Subscribe to /start events",
    ],
    status: "available",
    rating: 4.7,
    installs: 11200,
    author: "Telegram",
    accent: "#0088cc",
    icon: "Send",
  },
  {
    id: "whatsapp-business",
    name: "WhatsApp Business",
    category: "Comms",
    description:
      "Cloud API for sending template + session messages. Requires Meta Business verification.",
    authType: "oauth2",
    setupSteps: [
      "Create a Meta Business account + verify",
      "Register a WhatsApp Business phone number",
      "Generate a System User access token",
      "Subscribe to message webhooks",
    ],
    status: "coming_soon",
    rating: 4.3,
    installs: 4100,
    author: "Meta",
    accent: "#25d366",
    icon: "Phone",
  },

  // ─── Payments ──────────────────────────────────────────────────
  {
    id: "razorpay",
    name: "Razorpay",
    category: "Payments",
    description:
      "Indian payment gateway — UPI, cards, netbanking, subscriptions. Key + secret based.",
    authType: "api_key",
    setupSteps: [
      "Create a Razorpay account (live or test mode)",
      "Generate Key ID + Key Secret in Settings → API Keys",
      "Configure the webhook URL + secret",
      "Subscribe to payment.captured + payment.failed",
    ],
    status: "available",
    rating: 4.5,
    installs: 2870,
    author: "Razorpay Software",
    accent: "#0c2451",
    icon: "CreditCard",
  },
  // v47 fix 7: Stripe connector removed. The app is 100% crypto/UPI.
  // Razorpay remains as an optional external connector for future use.

  // ─── Documents ─────────────────────────────────────────────────
  {
    id: "docuseal",
    name: "DocuSeal",
    category: "Documents",
    description:
      "Open-source e-signature + form builder. Self-hosted or cloud. API-key based.",
    authType: "api_key",
    setupSteps: [
      "Create a DocuSeal workspace",
      "Generate an API key in Settings",
      "Submit a document template",
      "Trigger signing flow via API",
    ],
    status: "available",
    rating: 4.4,
    installs: 540,
    author: "DocuSeal",
    accent: "#10b981",
    icon: "FileSignature",
  },
  {
    id: "notion",
    name: "Notion",
    category: "Documents",
    description:
      "Workspace for docs, wikis, databases. Internal integration token with scoped page access.",
    authType: "api_key",
    setupSteps: [
      "Go to notion.so/profile/integrations",
      "Create an internal integration + copy the secret",
      "Share target databases/pages with the integration",
      "Query via /v1/databases/{id}/query",
    ],
    status: "available",
    rating: 4.6,
    installs: 7820,
    author: "Notion Labs",
    accent: "#000000",
    icon: "BookOpen",
  },
];

// ─── All connectors (ARIA built-in + external) ─────────────────────

export const ALL_CONNECTORS: Connector[] = [...ARIA_CONNECTORS, ...CONNECTORS];

// Keep backward-compat alias.
export const CONNECTORS_ALL = ALL_CONNECTORS;

// ─── DB-backed install state ───────────────────────────────────────

/**
 * Persisted install state. Stored as a JSON array of connector IDs in
 * the Setting table under key "connector.installed". Built-in ARIA
 * connectors are always "installed" regardless of this set.
 */
async function getInstalledIds(): Promise<Set<string>> {
  try {
    const row = await db.setting.findUnique({ where: { key: "connector.installed" } });
    if (!row) return new Set();
    const ids = JSON.parse(row.value) as string[];
    return new Set(Array.isArray(ids) ? ids : []);
  } catch {
    return new Set();
  }
}

async function saveInstalledIds(ids: Set<string>): Promise<void> {
  try {
    const value = JSON.stringify([...ids]);
    await db.setting.upsert({
      where: { key: "connector.installed" },
      create: { key: "connector.installed", value, category: "general" },
      update: { value },
    });
  } catch (err) {
    logger.warn("connector-marketplace.save-failed", { error: String(err) });
  }
}

function cloneConnector(c: Connector): Connector {
  return {
    ...c,
    setupSteps: [...c.setupSteps],
  };
}

function withInstallState(c: Connector, installedIds: Set<string>): Connector {
  const cloned = cloneConnector(c);
  // Built-in ARIA connectors are always installed.
  if (c.builtIn || installedIds.has(c.id)) {
    cloned.status = "installed";
  }
  return cloned;
}

// ─── Public API (async, DB-backed) ─────────────────────────────────

/**
 * List all connectors, optionally filtered by category. Each returned
 * connector carries its current install state.
 */
export async function listConnectors(category?: ConnectorCategory): Promise<Connector[]> {
  const installedIds = await getInstalledIds();
  const filtered = category
    ? ALL_CONNECTORS.filter((c) => c.category === category)
    : ALL_CONNECTORS;
  return filtered.map((c) => withInstallState(c, installedIds));
}

/**
 * Install a connector by id. Persists to the DB so the install survives
 * process restarts. Built-in ARIA connectors are always installed —
 * calling this on them is a no-op.
 */
export async function installConnector(id: string): Promise<{ ok: boolean; connector: Connector | null }> {
  const connector = ALL_CONNECTORS.find((c) => c.id === id);
  if (!connector) {
    logger.warn("connector-marketplace.install.not_found", { id });
    return { ok: false, connector: null };
  }
  if (connector.builtIn) {
    return { ok: true, connector: cloneConnector(connector) };
  }
  if (connector.status === "coming_soon") {
    logger.warn("connector-marketplace.install.coming_soon", { id });
    const installedIds = await getInstalledIds();
    return { ok: false, connector: withInstallState(connector, installedIds) };
  }
  const installedIds = await getInstalledIds();
  installedIds.add(id);
  await saveInstalledIds(installedIds);
  logger.info("connector-marketplace.installed", { id, name: connector.name });
  return { ok: true, connector: withInstallState(connector, installedIds) };
}

/**
 * Uninstall an external connector. Built-in ARIA connectors cannot be uninstalled.
 */
export async function uninstallConnector(id: string): Promise<{ ok: boolean; connector: Connector | null }> {
  const connector = ALL_CONNECTORS.find((c) => c.id === id);
  if (!connector || connector.builtIn) {
    return { ok: false, connector: connector ? cloneConnector(connector) : null };
  }
  const installedIds = await getInstalledIds();
  installedIds.delete(id);
  await saveInstalledIds(installedIds);
  logger.info("connector-marketplace.uninstalled", { id });
  return { ok: true, connector: withInstallState(connector, installedIds) };
}

/**
 * Return only the connectors currently installed.
 */
export async function getInstalledConnectors(): Promise<Connector[]> {
  const installedIds = await getInstalledIds();
  return ALL_CONNECTORS.filter((c) => c.builtIn || installedIds.has(c.id)).map(
    (c) => withInstallState(c, installedIds),
  );
}

/**
 * Return the list of available connector categories.
 */
export function listCategories(): ConnectorCategory[] {
  return ["ARIA", "CRM", "Comms", "Payments", "Documents"];
}
