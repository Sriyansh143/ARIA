/**
 * src/lib/services/catalog.ts — ARIA Service Catalog.
 *
 * Defines every service ARIA can build and sell to paying customers.
 * Each service has: id, name, category, description, price, build template,
 * and a system prompt for the LLM that generates the deliverable.
 *
 * The catalog is the single source of truth — the /services UI, the crypto
 * checkout endpoint, and the builder engine all read from here.
 *
 * Task ID: v30-SERVICES (Task 2).
 */

export type ServiceCategory =
  | "web"        // websites, landing pages
  | "3d"         // 3D / Three.js sites
  | "voice"      // voice agents (TTS + ASR)
  | "saas"       // full SaaS scaffolds
  | "tool"       // CLI tools, scripts
  | "api"        // API services
  | "content"    // written content (blog, copy, docs)
  | "data";      // data analysis, dashboards

export interface ServiceDef {
  id: string;
  name: string;
  category: ServiceCategory;
  tagline: string;
  description: string;
  /** Price in USD cents (e.g., 2900 = $29.00). */
  priceCents: number;
  /** Estimated delivery time in hours (shown to customer). */
  deliveryHours: number;
  /** What the customer provides. */
  inputs: string[];
  /** What ARIA delivers. */
  deliverables: string[];
  /** Key in AGENT_SYSTEM_PROMPTS or a custom prompt. */
  builderPrompt: string;
  /** File extension for the zip. */
  outputFormat: "zip" | "pdf" | "docx" | "md";
  /** Whether a free preview is available (rate-limited). */
  freePreview: boolean;
  /** Icon (lucide-react name). */
  icon: string;
  /** Accent color (tailwind). */
  accent: string;
}

export const SERVICE_CATALOG: ServiceDef[] = [
  {
    id: "website-static",
    name: "Static Website",
    category: "web",
    tagline: "Responsive, SEO-ready, deployable in minutes",
    description:
      "A complete static website — HTML + CSS + JS — tailored to your spec. Responsive, accessible (WCAG AA), SEO-optimized with meta tags + structured data. Ships with a README showing how to deploy to Netlify, Vercel, or GitHub Pages for free.",
    priceCents: 2900, // $29
    deliveryHours: 1,
    inputs: ["Business name", "Industry/niche", "Color preferences", "Pages needed", "Contact info"],
    deliverables: ["index.html", "styles.css", "script.js", "README.md", "robots.txt", "sitemap.xml"],
    builderPrompt: "ServiceBuilder",
    outputFormat: "zip",
    freePreview: true,
    icon: "Globe",
    accent: "cyan",
  },
  {
    id: "landing-page",
    name: "Landing Page",
    category: "web",
    tagline: "High-converting single-page site with CTA",
    description:
      "A conversion-optimized landing page with hero, value props, social proof, features, pricing, FAQ, and CTA. Built with semantic HTML + Tailwind CSS (CDN, no build step). Includes analytics snippet + A/B test hook.",
    priceCents: 1900, // $19
    deliveryHours: 1,
    inputs: ["Product name", "Value proposition", "Target audience", "CTA (e.g., 'Sign up', 'Buy now')", "Pricing tiers"],
    deliverables: ["index.html", "README.md"],
    builderPrompt: "ServiceBuilder",
    outputFormat: "zip",
    freePreview: true,
    icon: "Layout",
    accent: "violet",
  },
  {
    id: "3d-website",
    name: "3D Interactive Website",
    category: "3d",
    tagline: "Three.js-powered immersive 3D experience",
    description:
      "A 3D website using Three.js (via CDN). Includes an interactive 3D scene, camera controls, lighting, and responsive canvas. Perfect for product showcases, portfolios, or creative brand experiences. No build step — open index.html in a browser.",
    priceCents: 4900, // $49
    deliveryHours: 2,
    inputs: ["What the 3D scene should show", "Color scheme", "Interactions (rotate, zoom, click)", "Brand name"],
    deliverables: ["index.html", "scene.js", "styles.css", "README.md"],
    builderPrompt: "ServiceBuilder",
    outputFormat: "zip",
    freePreview: true,
    icon: "Box",
    accent: "emerald",
  },
  {
    id: "voice-agent",
    name: "Voice Agent",
    category: "voice",
    tagline: "Node.js voice agent with TTS + ASR",
    description:
      "A Node.js voice agent script using the z-ai-web-dev-sdk for text-to-speech (TTS) and automatic speech recognition (ASR). Includes a conversation loop, intent detection, and configurable persona. Runs on any machine with Node 18+.",
    priceCents: 3900, // $39
    deliveryHours: 2,
    inputs: ["Agent persona/role", "Conversation domain", "Response language", "Voice gender preference"],
    deliverables: ["agent.ts", "package.json", "README.md", ".env.example"],
    builderPrompt: "ServiceBuilder",
    outputFormat: "zip",
    freePreview: false,
    icon: "Mic",
    accent: "amber",
  },
  {
    id: "saas-scaffold",
    name: "SaaS Scaffold",
    category: "saas",
    tagline: "Next.js + Prisma + NextAuth + crypto-ready",
    description:
      "A production-ready SaaS scaffold: Next.js 16 (App Router) + TypeScript + Tailwind + Prisma (SQLite) + NextAuth (credentials) + crypto/UPI checkout + dashboard layout + landing page. Just add your idea and deploy to Vercel.",
    priceCents: 9900, // $99
    deliveryHours: 4,
    inputs: ["SaaS name", "Core feature description", "Pricing tiers", "Target user"],
    deliverables: ["Full Next.js project", "package.json", "prisma/schema.prisma", ".env.example", "README.md", "Dockerfile"],
    builderPrompt: "ServiceBuilder",
    outputFormat: "zip",
    freePreview: false,
    icon: "Layers",
    accent: "rose",
  },
  {
    id: "cli-tool",
    name: "CLI Tool",
    category: "tool",
    tagline: "Node.js CLI with argument parsing + help",
    description:
      "A Node.js CLI tool with argument parsing (commander), colored output (chalk), help text, and error handling. Cross-platform. Ships with a README, package.json, and example usage.",
    priceCents: 2400, // $24
    deliveryHours: 1,
    inputs: ["What the tool does", "Input/output format", "Command name", "Key flags/options"],
    deliverables: ["cli.ts", "package.json", "README.md", ".env.example"],
    builderPrompt: "ServiceBuilder",
    outputFormat: "zip",
    freePreview: true,
    icon: "Terminal",
    accent: "cyan",
  },
  {
    id: "api-service",
    name: "API Service",
    category: "api",
    tagline: "REST API with Express + Swagger docs",
    description:
      "A Node.js REST API using Express, with Swagger/OpenAPI docs, request validation (zod), error middleware, CORS, and a health check. Includes a README with curl examples. Deploy to Render, Railway, or Fly.io.",
    priceCents: 4900, // $49
    deliveryHours: 2,
    inputs: ["API domain (e.g., 'task management')", "Key endpoints", "Data model", "Auth (none, API key, JWT)"],
    deliverables: ["server.ts", "routes.ts", "package.json", "README.md", ".env.example"],
    builderPrompt: "ServiceBuilder",
    outputFormat: "zip",
    freePreview: false,
    icon: "Server",
    accent: "violet",
  },
  {
    id: "dashboard",
    name: "Analytics Dashboard",
    category: "data",
    tagline: "React dashboard with charts + filters",
    description:
      "A React dashboard with Recharts visualizations, filter controls, a data table, and a summary KPI bar. Single-page, CDN-based (no build step). Just plug in your data source.",
    priceCents: 3900, // $39
    deliveryHours: 2,
    inputs: ["Dashboard title", "KPIs to track", "Chart types (bar, line, pie)", "Data source (JSON/CSV/API)"],
    deliverables: ["index.html", "dashboard.js", "styles.css", "sample-data.json", "README.md"],
    builderPrompt: "ServiceBuilder",
    outputFormat: "zip",
    freePreview: true,
    icon: "BarChart3",
    accent: "emerald",
  },
  {
    id: "blog-post",
    name: "SEO Blog Post",
    category: "content",
    tagline: "2000-word SEO-optimized article + meta",
    description:
      "A 2000-word, SEO-optimized blog post on your topic. Includes keyword-targeted title, meta description, H1/H2/H3 structure, internal linking suggestions, and a CTA. Delivered as Markdown.",
    priceCents: 900, // $9
    deliveryHours: 1,
    inputs: ["Topic", "Target keyword", "Tone (professional, casual, technical)", "Word count target"],
    deliverables: ["blog-post.md", "meta.json"],
    builderPrompt: "ContentCreator",
    outputFormat: "md",
    freePreview: true,
    icon: "PenTool",
    accent: "amber",
  },
  {
    id: "api-docs",
    name: "API Documentation",
    category: "content",
    tagline: "OpenAPI spec + interactive docs page",
    description:
      "Complete API documentation: OpenAPI 3.0 spec (YAML) + an interactive HTML docs page (Swagger UI via CDN). Covers all endpoints, request/response schemas, error codes, and auth flows.",
    priceCents: 3400, // $34
    deliveryHours: 2,
    inputs: ["API base URL", "Endpoints to document", "Auth method", "Example responses"],
    deliverables: ["openapi.yaml", "index.html", "README.md"],
    builderPrompt: "ServiceBuilder",
    outputFormat: "zip",
    freePreview: false,
    icon: "FileText",
    accent: "rose",
  },
];

/**
 * Get a service by ID.
 */
export function getService(id: string): ServiceDef | undefined {
  return SERVICE_CATALOG.find((s) => s.id === id);
}

/**
 * Get all services in a category.
 */
export function getServicesByCategory(category: ServiceCategory): ServiceDef[] {
  return SERVICE_CATALOG.filter((s) => s.category === category);
}

/**
 * Get all categories with their service counts.
 */
export function getCategories(): { id: ServiceCategory; label: string; count: number; icon: string }[] {
  const cats: ServiceCategory[] = ["web", "3d", "voice", "saas", "tool", "api", "content", "data"];
  const labels: Record<ServiceCategory, string> = {
    web: "Web",
    "3d": "3D",
    voice: "Voice",
    saas: "SaaS",
    tool: "Tools",
    api: "API",
    content: "Content",
    data: "Data",
  };
  const icons: Record<ServiceCategory, string> = {
    web: "Globe",
    "3d": "Box",
    voice: "Mic",
    saas: "Layers",
    tool: "Terminal",
    api: "Server",
    content: "PenTool",
    data: "BarChart3",
  };
  return cats.map((c) => ({
    id: c,
    label: labels[c],
    count: SERVICE_CATALOG.filter((s) => s.category === c).length,
    icon: icons[c],
  }));
}
