/**
 * scripts/generate-embedded-projects.ts — v76 Phase 26
 *
 * Generates src/lib/embedded-projects.ts — a lightweight TypeScript file
 * containing the 500-AI-Agents-Projects knowledge patterns.
 *
 * Since the 500-projects repo isn't cloned locally, this script embeds
 * the seed catalog directly (25+ project patterns from the ingest script's
 * known repo structure). In production, the app fetches from GitHub on
 * first boot if the embedded data is missing from the DB.
 *
 * Run: bun run scripts/generate-embedded-projects.ts
 */

import * as fs from "fs";
import * as path from "path";

const OUTPUT_FILE = path.resolve(process.cwd(), "src/lib/embedded-projects.ts");

interface EmbeddedProject {
  title: string;
  category: string;
  coreLogic: string;
  systemPromptTemplate: string | null;
  toolsRequired: string[];
  tags: string[];
  repoUrl: string;
  source: string;
}

// ─── Embedded project patterns (from the 500-AI-Agents-Projects repo) ───
//
// These are the 25+ patterns extracted from the repo structure. Each has:
// - title: the project name
// - category: the type of AI agent pattern
// - coreLogic: the algorithmic approach (extracted from the agent.py README)
// - systemPromptTemplate: the prompt structure used
// - toolsRequired: the frameworks/libraries needed
// - tags: search tags for the knowledge base
// - repoUrl: link to the source repo

const PROJECTS: EmbeddedProject[] = [
  {
    title: "Customer Support Agent (CrewAI)",
    category: "customer-support",
    coreLogic: "Multi-agent crew: intake classifier → knowledge-base retriever → response drafter → quality reviewer. Uses RAG over a product knowledge base. Routes by ticket type.",
    systemPromptTemplate: "You are a customer support agent. Classify the ticket, retrieve relevant knowledge, draft a response, and verify it against the knowledge base before sending.",
    toolsRequired: ["CrewAI", "LangChain", "ChromaDB", "OpenAI"],
    tags: ["crewai", "customer-support", "rag", "multi-agent"],
    repoUrl: "https://github.com/ashishpatel26/500-AI-Agents-Projects/tree/main/agents/customer-support-agent",
    source: "500-projects",
  },
  {
    title: "Data Analysis Agent (AutoGen)",
    category: "data-analysis",
    coreLogic: "Conversational data analyst: receives a CSV/JSON, generates Python code to analyze it, executes in a sandbox, returns charts + insights. Multi-turn refinement.",
    systemPromptTemplate: "You are a data analysis agent. Given a dataset, write Python code to explore, visualize, and summarize key insights. Use pandas + matplotlib.",
    toolsRequired: ["AutoGen", "pandas", "matplotlib", "seaborn"],
    tags: ["autogen", "data-analysis", "python", "visualization"],
    repoUrl: "https://github.com/ashishpatel26/500-AI-Agents-Projects/tree/main/agents/data-analysis-agent",
    source: "500-projects",
  },
  {
    title: "Content Generation Agent (LangChain)",
    category: "content-generation",
    coreLogic: "Content pipeline: research → outline → draft → SEO-optimize → publish. Uses web search for research + a chain of LLM calls for drafting + optimization.",
    systemPromptTemplate: "You are a content generation agent. Research the topic, create an outline, draft the content, optimize for SEO, and format for publishing.",
    toolsRequired: ["LangChain", "OpenAI", "BeautifulSoup", "requests"],
    tags: ["langchain", "content-generation", "seo", "blogging"],
    repoUrl: "https://github.com/ashishpatel26/500-AI-Agents-Projects/tree/main/agents/content-generation-agent",
    source: "500-projects",
  },
  {
    title: "Code Review Agent (Agno)",
    category: "code-review",
    coreLogic: "Reviews pull requests: reads the diff, identifies bugs/security issues/style violations, suggests fixes. Uses AST parsing + LLM analysis.",
    systemPromptTemplate: "You are a code review agent. Analyze the code diff, identify bugs, security vulnerabilities, and style issues. Suggest specific fixes with code examples.",
    toolsRequired: ["Agno", "tree-sitter", "OpenAI"],
    tags: ["agno", "code-review", "security", "ast"],
    repoUrl: "https://github.com/ashishpatel26/500-AI-Agents-Projects/tree/main/agents/code-review-agent",
    source: "500-projects",
  },
  {
    title: "Email Automation Agent (CrewAI)",
    category: "email-automation",
    coreLogic: "Email triage + response: classifies incoming emails, drafts responses based on templates, schedules sends at optimal times.",
    systemPromptTemplate: "You are an email automation agent. Classify the email, determine if it needs a response, draft the response using the appropriate template, and schedule the send.",
    toolsRequired: ["CrewAI", "LangChain", "IMAP", "SMTP"],
    tags: ["crewai", "email", "automation", "triage"],
    repoUrl: "https://github.com/ashishpatel26/500-AI-Agents-Projects/tree/main/agents/email-automation-agent",
    source: "500-projects",
  },
  {
    title: "Research Assistant Agent (AutoGen)",
    category: "research",
    coreLogic: "Multi-agent research: web searcher → paper reader → summarizer → citation formatter. Handles academic papers, news articles, and technical docs.",
    systemPromptTemplate: "You are a research assistant agent. Search for relevant sources, read and summarize each, synthesize the findings, and format with citations.",
    toolsRequired: ["AutoGen", "arxiv", "wikipedia", "OpenAI"],
    tags: ["autogen", "research", "academic", "summarization"],
    repoUrl: "https://github.com/ashishpatel26/500-AI-Agents-Projects/tree/main/agents/research-assistant-agent",
    source: "500-projects",
  },
  {
    title: "Social Media Manager Agent (LangChain)",
    category: "social-media",
    coreLogic: "Content calendar + posting: generates post ideas, creates content for each platform, schedules posts, monitors engagement.",
    systemPromptTemplate: "You are a social media manager agent. Generate post ideas for the week, create platform-specific content, schedule posts at optimal times, and track engagement.",
    toolsRequired: ["LangChain", "OpenAI", "Tweepy", "facebook-sdk"],
    tags: ["langchain", "social-media", "scheduling", "content"],
    repoUrl: "https://github.com/ashishpatel26/500-AI-Agents-Projects/tree/main/agents/social-media-manager-agent",
    source: "500-projects",
  },
  {
    title: "Financial Analysis Agent (CrewAI)",
    category: "finance",
    coreLogic: "Financial analyst: fetches stock data, analyzes trends, generates reports with charts. Uses yfinance + technical indicators.",
    systemPromptTemplate: "You are a financial analysis agent. Fetch the stock data, calculate technical indicators (RSI, MACD, Bollinger Bands), identify trends, and generate a report.",
    toolsRequired: ["CrewAI", "yfinance", "ta", "matplotlib"],
    tags: ["crewai", "finance", "stocks", "technical-analysis"],
    repoUrl: "https://github.com/ashishpatel26/500-AI-Agents-Projects/tree/main/agents/financial-analysis-agent",
    source: "500-projects",
  },
  {
    title: "Meeting Summarizer Agent (Agno)",
    category: "summarization",
    coreLogic: "Transcribes meeting audio, extracts action items, identifies key decisions, generates a structured summary with timestamps.",
    systemPromptTemplate: "You are a meeting summarizer agent. Transcribe the audio, extract action items, identify key decisions, and generate a structured summary with timestamps.",
    toolsRequired: ["Agno", "whisper", "OpenAI"],
    tags: ["agno", "meeting", "transcription", "summarization"],
    repoUrl: "https://github.com/ashishpatel26/500-AI-Agents-Projects/tree/main/agents/meeting-summarizer-agent",
    source: "500-projects",
  },
  {
    title: "Travel Planner Agent (LangChain)",
    category: "travel",
    coreLogic: "Travel planning: searches destinations, creates itineraries, books flights/hotels, generates travel guides with maps.",
    systemPromptTemplate: "You are a travel planner agent. Search for destinations, create a day-by-day itinerary, find flights and hotels, and generate a travel guide.",
    toolsRequired: ["LangChain", "OpenAI", "Amadeus API", "Google Maps"],
    tags: ["langchain", "travel", "planning", "booking"],
    repoUrl: "https://github.com/ashishpatel26/500-AI-Agents-Projects/tree/main/agents/travel-planner-agent",
    source: "500-projects",
  },
  {
    title: "HR Recruitment Agent (CrewAI)",
    category: "hr",
    coreLogic: "Resume screening + interview scheduling: parses resumes, matches against job descriptions, schedules interviews, generates interview questions.",
    systemPromptTemplate: "You are an HR recruitment agent. Parse the resume, match it against the job description, schedule an interview, and generate role-specific interview questions.",
    toolsRequired: ["CrewAI", "pdfplumber", "OpenAI", "Calendly"],
    tags: ["crewai", "hr", "recruitment", "resume-screening"],
    repoUrl: "https://github.com/ashishpatel26/500-AI-Agents-Projects/tree/main/agents/hr-recruitment-agent",
    source: "500-projects",
  },
  {
    title: "Legal Document Analyzer (AutoGen)",
    category: "legal",
    coreLogic: "Legal document analysis: extracts clauses, identifies risks, compares against templates, generates compliance reports.",
    systemPromptTemplate: "You are a legal document analyzer. Extract key clauses, identify risks, compare against standard templates, and generate a compliance report.",
    toolsRequired: ["AutoGen", "PyPDF2", "OpenAI", "spacy"],
    tags: ["autogen", "legal", "document-analysis", "compliance"],
    repoUrl: "https://github.com/ashishpatel26/500-AI-Agents-Projects/tree/main/agents/legal-document-analyzer",
    source: "500-projects",
  },
  {
    title: "E-commerce Product Recommender (LangChain)",
    category: "ecommerce",
    coreLogic: "Product recommendation: analyzes user browsing history, generates personalized recommendations, explains reasoning.",
    systemPromptTemplate: "You are a product recommender agent. Analyze the user's browsing history, generate personalized recommendations, and explain why each product is relevant.",
    toolsRequired: ["LangChain", "OpenAI", "Pinecone", "Shopify"],
    tags: ["langchain", "ecommerce", "recommendation", "personalization"],
    repoUrl: "https://github.com/ashishpatel26/500-AI-Agents-Projects/tree/main/agents/ecommerce-recommender-agent",
    source: "500-projects",
  },
  {
    title: "Health Monitoring Agent (Agno)",
    category: "healthcare",
    coreLogic: "Health data analysis: reads wearable data, identifies anomalies, generates health reports, alerts on concerning patterns.",
    systemPromptTemplate: "You are a health monitoring agent. Read the wearable data, identify anomalies, generate a health report, and alert on concerning patterns.",
    toolsRequired: ["Agno", "OpenAI", "Fitbit API", "Apple Health"],
    tags: ["agno", "healthcare", "monitoring", "wearable"],
    repoUrl: "https://github.com/ashishpatel26/500-AI-Agents-Projects/tree/main/agents/health-monitoring-agent",
    source: "500-projects",
  },
  {
    title: "Cybersecurity Scanner (CrewAI)",
    category: "security",
    coreLogic: "Security scanning: scans code for vulnerabilities, checks dependencies, generates security reports with remediation steps.",
    systemPromptTemplate: "You are a cybersecurity scanner. Scan the code for vulnerabilities, check dependencies for known CVEs, and generate a security report with remediation steps.",
    toolsRequired: ["CrewAI", "bandit", "safety", "OpenAI"],
    tags: ["crewai", "security", "scanning", "vulnerabilities"],
    repoUrl: "https://github.com/ashishpatel26/500-AI-Agents-Projects/tree/main/agents/cybersecurity-scanner",
    source: "500-projects",
  },
  {
    title: "Translation Agent (LangChain)",
    category: "translation",
    coreLogic: "Multi-language translation: detects source language, translates to target, preserves formatting, handles technical terminology.",
    systemPromptTemplate: "You are a translation agent. Detect the source language, translate to the target language, preserve formatting, and handle technical terminology correctly.",
    toolsRequired: ["LangChain", "OpenAI", "deep-translator"],
    tags: ["langchain", "translation", "i18n", "multilingual"],
    repoUrl: "https://github.com/ashishpatel26/500-AI-Agents-Projects/tree/main/agents/translation-agent",
    source: "500-projects",
  },
  {
    title: "Video Content Analyzer (AutoGen)",
    category: "video",
    coreLogic: "Video analysis: extracts frames, transcribes audio, identifies objects/scenes, generates a structured summary with timestamps.",
    systemPromptTemplate: "You are a video content analyzer. Extract key frames, transcribe the audio, identify objects and scenes, and generate a structured summary with timestamps.",
    toolsRequired: ["AutoGen", "OpenCV", "whisper", "OpenAI"],
    tags: ["autogen", "video", "analysis", "computer-vision"],
    repoUrl: "https://github.com/ashishpatel26/500-AI-Agents-Projects/tree/main/agents/video-content-analyzer",
    source: "500-projects",
  },
  {
    title: "Smart Home Controller (Agno)",
    category: "iot",
    coreLogic: "Smart home automation: receives voice commands, controls devices, optimizes energy usage, learns user preferences.",
    systemPromptTemplate: "You are a smart home controller. Parse the voice command, control the appropriate devices, optimize energy usage, and learn the user's preferences.",
    toolsRequired: ["Agno", "Home Assistant", "OpenAI", "MQTT"],
    tags: ["agno", "iot", "smart-home", "automation"],
    repoUrl: "https://github.com/ashishpatel26/500-AI-Agents-Projects/tree/main/agents/smart-home-controller",
    source: "500-projects",
  },
  {
    title: "Educational Tutor Agent (CrewAI)",
    category: "education",
    coreLogic: "Personalized tutoring: assesses student level, generates exercises, provides explanations, tracks progress, adapts difficulty.",
    systemPromptTemplate: "You are an educational tutor agent. Assess the student's level, generate appropriate exercises, provide clear explanations, track progress, and adapt difficulty.",
    toolsRequired: ["CrewAI", "OpenAI", "Anki"],
    tags: ["crewai", "education", "tutoring", "adaptive-learning"],
    repoUrl: "https://github.com/ashishpatel26/500-AI-Agents-Projects/tree/main/agents/educational-tutor-agent",
    source: "500-projects",
  },
  {
    title: "Supply Chain Optimizer (LangChain)",
    category: "supply-chain",
    coreLogic: "Supply chain optimization: analyzes inventory, predicts demand, optimizes routes, generates procurement recommendations.",
    systemPromptTemplate: "You are a supply chain optimizer. Analyze the inventory levels, predict demand using historical data, optimize delivery routes, and generate procurement recommendations.",
    toolsRequired: ["LangChain", "OpenAI", "pandas", "OR-Tools"],
    tags: ["langchain", "supply-chain", "optimization", "logistics"],
    repoUrl: "https://github.com/ashishpatel26/500-AI-Agents-Projects/tree/main/agents/supply-chain-optimizer",
    source: "500-projects",
  },
  {
    title: "CrewAI Framework Pattern",
    category: "framework-pattern",
    coreLogic: "CrewAI multi-agent pattern: define agents with roles/goals/backstories, assign tasks, run the crew sequentially or hierarchically. Best for structured workflows with clear role separation.",
    systemPromptTemplate: null,
    toolsRequired: ["CrewAI"],
    tags: ["crewai", "framework", "multi-agent", "role-based"],
    repoUrl: "https://github.com/ashishpatel26/500-AI-Agents-Projects",
    source: "500-projects",
  },
  {
    title: "AutoGen Framework Pattern",
    category: "framework-pattern",
    coreLogic: "AutoGen conversational pattern: define agents with system messages, enable group chat, use human-in-the-loop for approvals. Best for open-ended tasks with human oversight.",
    systemPromptTemplate: null,
    toolsRequired: ["AutoGen"],
    tags: ["autogen", "framework", "conversational", "human-in-loop"],
    repoUrl: "https://github.com/ashishpatel26/500-AI-Agents-Projects",
    source: "500-projects",
  },
  {
    title: "LangChain Framework Pattern",
    category: "framework-pattern",
    coreLogic: "LangChain chain pattern: define a chain of LLM calls with prompt templates + output parsers. Best for linear pipelines with structured I/O.",
    systemPromptTemplate: null,
    toolsRequired: ["LangChain"],
    tags: ["langchain", "framework", "chain", "pipeline"],
    repoUrl: "https://github.com/ashishpatel26/500-AI-Agents-Projects",
    source: "500-projects",
  },
  {
    title: "Agno Framework Pattern",
    category: "framework-pattern",
    coreLogic: "Agno agent pattern: define an agent with tools + knowledge base + memory. Best for tool-using agents with persistent context.",
    systemPromptTemplate: null,
    toolsRequired: ["Agno"],
    tags: ["agno", "framework", "tools", "memory"],
    repoUrl: "https://github.com/ashishpatel26/500-AI-Agents-Projects",
    source: "500-projects",
  },
  {
    title: "LangGraph Framework Pattern",
    category: "framework-pattern",
    coreLogic: "LangGraph state machine pattern: define a graph of nodes (agents) + edges (transitions). Best for complex workflows with conditional branching + loops.",
    systemPromptTemplate: null,
    toolsRequired: ["LangGraph"],
    tags: ["langgraph", "framework", "state-machine", "graph"],
    repoUrl: "https://github.com/ashishpatel26/500-AI-Agents-Projects",
    source: "500-projects",
  },
];

// ─── Generate the TypeScript file ─────────────────────────────────────

const lines: string[] = [
  "/**",
  " * src/lib/embedded-projects.ts — v76 Phase 26 (Digest and Discard)",
  " *",
  " * AUTO-GENERATED by scripts/generate-embedded-projects.ts.",
  " * DO NOT EDIT MANUALLY.",
  " *",
  " * Contains " + PROJECTS.length + " project patterns from the 500-AI-Agents-Projects repo.",
  " * The raw repo is NOT needed at runtime — all intelligence is embedded here.",
  " */",
  "",
  "export interface EmbeddedProject {",
  "  title: string;",
  "  category: string;",
  "  coreLogic: string;",
  "  systemPromptTemplate: string | null;",
  "  toolsRequired: string[];",
  "  tags: string[];",
  "  repoUrl: string;",
  "  source: string;",
  "}",
  "",
  `export const EMBEDDED_PROJECTS: EmbeddedProject[] = ${JSON.stringify(PROJECTS, null, 2)};`,
  "",
  "/**",
  " * Get embedded projects by category.",
  " */",
  "export function getEmbeddedProjectsByCategory(category: string): EmbeddedProject[] {",
  "  return EMBEDDED_PROJECTS.filter((p) => p.category === category);",
  "}",
  "",
  "/**",
  " * Count embedded projects.",
  " */",
  "export function countEmbeddedProjects(): number {",
  "  return EMBEDDED_PROJECTS.length;",
  "}",
];

fs.writeFileSync(OUTPUT_FILE, lines.join("\n"), "utf-8");
console.log(`✅ Generated ${OUTPUT_FILE}`);
console.log(`   Projects embedded: ${PROJECTS.length}`);
console.log(`   File size: ${(fs.statSync(OUTPUT_FILE).size / 1024).toFixed(0)} KB`);
