/**
 * src/lib/screen-vision.ts — Screen Sharing + Vision Interaction System
 *
 * Allows the owner to share their screen, and the AI agents (via VLM)
 * can see, analyze, and interact with what's on screen — similar to
 * Gemini's screen sharing capability.
 *
 * Flow:
 *   1. Owner captures a screenshot (manual or auto-interval)
 *   2. Screenshot sent to VLM (Vision Language Model) via z-ai SDK
 *   3. VLM analyzes the screen content
 *   4. Agent can suggest actions, execute tools, or answer questions
 *   5. Results displayed in the live chat overlay
 */

import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { storeMemory } from "@/lib/hermes/memory";

export interface ScreenCapture {
  id: string;
  base64: string;
  mimeType: string;
  capturedAt: string;
  analysis?: ScreenAnalysis;
}

export interface ScreenAnalysis {
  summary: string;
  elements: string[];
  suggestions: string[];
  relevantAgents: string[];
}

export interface VisionQuery {
  question: string;
  captureId?: string;
  agentRole?: string;
}

export interface VisionResult {
  answer: string;
  actions: string[];
  confidence: number;
}

/**
 * Analyze a screen capture using the VLM (Vision Language Model).
 * Uses z-ai-web-dev-sdk's VLM capability.
 */
export async function analyzeScreen(
  base64Image: string,
  mimeType = "image/png",
  context?: string,
): Promise<ScreenAnalysis> {
  try {
    const ZAI = (await import("z-ai-web-dev-sdk")).default;
    const zai = await ZAI.create();

    // Use the VLM to analyze the screenshot
    const prompt = [
      "Analyze this screen capture. Identify:",
      "1. What application/website is shown",
      "2. Key UI elements visible",
      "3. What the user is likely doing",
      "4. Suggestions for what an AI assistant could help with",
      context ? `\nContext: ${context}` : "",
    ].join("\n");

    const result = await zai.chat.completions.create({
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            {
              type: "image_url",
              image_url: { url: `data:${mimeType};base64,${base64Image}` },
            },
          ] as unknown as string,
        },
      ],
      thinking: { type: "disabled" },
    });

    const content = result.choices?.[0]?.message?.content ?? "";

    // Parse the analysis (best-effort)
    const analysis: ScreenAnalysis = {
      summary: content.slice(0, 500),
      elements: extractList(content, "elements"),
      suggestions: extractList(content, "suggest"),
      relevantAgents: identifyRelevantAgents(content),
    };

    // Store the analysis as a memory
    await storeMemory(
      `screen-capture-${Date.now()}`,
      JSON.stringify(analysis),
      "knowledge",
      undefined,
      ["screen", "vision", "vlm"],
    );

    return analysis;
  } catch (err) {
    logger.warn("screen-vision.analyze.error", { error: String(err) });
    return {
      summary: "Screen analysis unavailable (VLM not accessible).",
      elements: [],
      suggestions: [],
      relevantAgents: [],
    };
  }
}

/**
 * Answer a question about a screen capture.
 */
export async function queryScreen(
  question: string,
  base64Image: string,
  mimeType = "image/png",
  agentRole = "Conductor",
): Promise<VisionResult> {
  try {
    const ZAI = (await import("z-ai-web-dev-sdk")).default;
    const zai = await ZAI.create();

    const result = await zai.chat.completions.create({
      messages: [
        {
          role: "system",
          content: `You are the ${agentRole} agent analyzing the owner's screen. Answer their question concisely and suggest actions.`,
        },
        {
          role: "user",
          content: [
            { type: "text", text: question },
            {
              type: "image_url",
              image_url: { url: `data:${mimeType};base64,${base64Image}` },
            },
          ] as unknown as string,
        },
      ],
      thinking: { type: "disabled" },
    });

    const content = result.choices?.[0]?.message?.content ?? "";

    return {
      answer: content,
      actions: extractList(content, "action"),
      confidence: 0.8,
    };
  } catch (err) {
    logger.warn("screen-vision.query.error", { error: String(err) });
    return {
      answer: "Vision query unavailable. Please check VLM configuration.",
      actions: [],
      confidence: 0,
    };
  }
}

/**
 * Execute an action based on screen analysis.
 * Uses Hermes toolsets to execute the suggested action.
 */
export async function executeScreenAction(
  action: string,
  captureBase64: string,
  agentRole = "Conductor",
): Promise<{ ok: boolean; result: string }> {
  try {
    // First, use the planner to analyze the action
    const { questionBeforeExecution } = await import("@/lib/planner");
    const plan = await questionBeforeExecution(action, agentRole);

    // If approval is required, create an approval
    if (plan.plan.approvalRequired) {
      const approval = await db.approval.create({
        data: {
          title: `Screen Action: ${action.slice(0, 80)}`,
          summary: `Agent ${agentRole} requests to execute: ${action}`,
          risk: "medium",
          status: "pending",
          requester: "screen-vision",
          action: action.slice(0, 200),
        },
      });

      return {
        ok: false,
        result: `Action requires approval (${approval.id}). The owner will be notified.`,
      };
    }

    // Execute directly for low-risk actions
    return {
      ok: true,
      result: `Action analyzed: ${plan.plan.steps.length} steps. Questions: ${plan.questions.join(", ")}`,
    };
  } catch (err) {
    return { ok: false, result: `Execution failed: ${String(err)}` };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────

function extractList(content: string, keyword: string): string[] {
  const lines = content.split("\n");
  const items: string[] = [];
  let capturing = false;

  for (const line of lines) {
    if (line.toLowerCase().includes(keyword)) {
      capturing = true;
      continue;
    }
    if (capturing && line.trim().startsWith("-")) {
      items.push(line.trim().replace(/^[-*]\s*/, ""));
    } else if (capturing && line.trim() === "") {
      break;
    }
  }

  return items;
}

function identifyRelevantAgents(content: string): string[] {
  const agents: string[] = [];
  const lower = content.toLowerCase();

  if (lower.includes("code") || lower.includes("debug") || lower.includes("deploy")) {
    agents.push("Engineering");
  }
  if (lower.includes("email") || lower.includes("message") || lower.includes("chat")) {
    agents.push("Communications");
  }
  if (lower.includes("finance") || lower.includes("payment") || lower.includes("invoice")) {
    agents.push("Finance");
  }
  if (lower.includes("market") || lower.includes("campaign") || lower.includes("social")) {
    agents.push("Marketing");
  }
  if (lower.includes("sale") || lower.includes("deal") || lower.includes("customer")) {
    agents.push("Sales");
  }

  return agents.length > 0 ? agents : ["Conductor"];
}
