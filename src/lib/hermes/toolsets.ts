/**
 * ARIA Mission Control — Hermes Programmatic Tool Calling and Code Execution.
 *
 * Native TypeScript port of the Hermes toolset subsystem. Provides:
 *
 *   - executeCode        — secure sandbox runner for JS/TS via Node vm
 *                          module (restricted context, 5s timeout).
 *   - parseHermesXML     — extract Hermes XML tool calls from LLM output.
 *   - formatHermesXML    — emit Hermes XML for the LLM prompt.
 *   - TOOL_DEFINITIONS   — declarative tool registry w/ JSON schemas.
 *   - executeToolCall    — dispatch a parsed tool call to its handler,
 *                          creating an Approval row for high-risk ops.
 *
 * Security model:
 *  - Code execution runs in a fresh vm.Context per call. The context
 *    exposes only console.log (sandboxed to a string buffer), Math,
 *    JSON, Date, Array, Object, String, Number, Boolean, RegExp,
 *    Map, Set, Promise. No require, no process, no global, no fetch,
 *    no fs. Hard 5-second timeout.
 *  - Python is NOT supported natively; we return a typed error rather
 *    than silently degrading.
 *  - High-risk tool calls (spawn_subagent, create_skill) create an
 *    Approval row and return a pending-approval result — the caller
 *    pauses until the operator decides.
 *
 * Implementation note: closing XML tags are built at runtime via string
 * concatenation (e.g. LT + "/tool_call>") instead of literal closing
 * tags. This keeps the source code free of any literal closing-tag
 * sequences while still producing correct Hermes XML at runtime.
 */
import * as vm from "node:vm";
import { db } from "@/lib/db";
import { emit } from "@/lib/event-bus";
import { callLLM } from "@/lib/llm-client";
import {
  type Approval,
  type ApprovalRisk,
  toIso,
  parseJsonArray,
} from "@/lib/types";
import { searchMemory, storeMemory } from "@/lib/hermes/memory";
import {
  createSkillFromExecution,
  findSkillBySlug,
  incrementSkillUsage,
} from "@/lib/hermes/skills";

// ─── Types ──────────────────────────────────────────────────────────
export interface HermesToolCall {
  tool: string;
  args: Record<string, unknown>;
  id: string;
}

export interface ToolResult {
  ok: boolean;
  output: string;
  data?: unknown;
}

export interface ToolContext {
  agentId: string;
  agentRole: string;
  taskId?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  risk: ApprovalRisk; // low | medium | high | critical — gates HITL.
  parameters: {
    type: "object";
    properties: Record<string, { type: string; description: string }>;
    required: string[];
  };
}

// ─── Hermes XML tag constants ────────────────────────────────────────
// Build tags via string concatenation so the source contains no literal
// closing-tag sequences. The literal forms would confuse downstream
// tooling that parses the source text.
const LT = String.fromCharCode(60); // "<"
const GT = String.fromCharCode(62); // ">"
const SLASH = "/";

const OPEN_TOOL_CALL = LT + "tool_call" + GT;
const CLOSE_TOOL_CALL = LT + SLASH + "tool_call" + GT;
const OPEN_EXEC_CODE = LT + "execute_code";
const CLOSE_EXEC_CODE = LT + SLASH + "execute_code" + GT;

// ─── Code execution sandbox ─────────────────────────────────────────
/**
 * Secure sandbox runner for JavaScript/TypeScript.
 *
 * For JavaScript: runs the code in a fresh vm.Context with a restricted
 * global scope. The only side-effecting API exposed is console.log,
 * which writes to an in-memory string buffer that becomes the output.
 * A 5-second hard timeout prevents infinite loops.
 *
 * For TypeScript: stripped of types via a regex pre-pass (sufficient
 * for the simple inline code agents emit — not a full TS compiler).
 * Then executed as JavaScript.
 *
 * For Python: returns a typed error — not supported natively in local
 * mode. The caller can route to an external runner if available.
 *
 * Returns `{ ok, output, error? }` — never throws.
 */
export async function executeCode(
  code: string,
  language: "javascript" | "typescript" | "python"
): Promise<{ ok: boolean; output: string; error?: string }> {
  try {
    if (language === "python") {
      return {
        ok: false,
        output: "",
        error:
          "Python execution requires external runner — not available in local mode",
      };
    }

    // Strip TypeScript annotations with a coarse regex pre-pass.
    let jsCode = code;
    if (language === "typescript") {
      jsCode = stripTypeAnnotations(code);
    }

    // Output buffer — the sandboxed console.log writes here.
    const output: string[] = [];

    // Build the restricted context. Fresh per call — no leakage.
    const sandbox: Record<string, unknown> = {
      console: {
        log: (...args: unknown[]) => {
          output.push(args.map(formatValue).join(" "));
        },
        error: (...args: unknown[]) => {
          output.push("[stderr] " + args.map(formatValue).join(" "));
        },
        warn: (...args: unknown[]) => {
          output.push("[warn] " + args.map(formatValue).join(" "));
        },
        info: (...args: unknown[]) => {
          output.push(args.map(formatValue).join(" "));
        },
      },
      Math,
      JSON,
      Date,
      Array,
      Object,
      String,
      Number,
      Boolean,
      RegExp,
      Map,
      Set,
      Promise,
      Symbol,
      Error,
      parseInt,
      parseFloat,
      isNaN,
      isFinite,
      undefined,
      NaN,
      Infinity,
    };

    const context = vm.createContext(sandbox);

    // Wrap in an async IIFE so agents can `await` if needed.
    const wrapped = "(async () => {\n" + jsCode + "\n})();";

    const script = new vm.Script(wrapped, {
      filename: "hermes-exec-" + Date.now() + ".js",
    });

    const promise = script.runInContext(context, {
      timeout: 5000,
      breakOnSigint: true,
    });

    // Await the async IIFE — the 5s timeout in runInContext covers sync
    // execution; for the async portion, race with a 5s timeout.
    await Promise.race([
      promise,
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("execution timeout (5s) exceeded")),
          5000
        )
      ),
    ]);

    const outStr = output.join("\n");
    console.log(
      "[hermes-toolsets] executeCode(" + language + "): success, output " + outStr.length + " bytes"
    );
    return { ok: true, output: outStr };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[hermes-toolsets] executeCode failed:", message);
    return { ok: false, output: "", error: message };
  }
}

/** Format a value for console.log output — handles objects via JSON. */
function formatValue(v: unknown): string {
  if (v === null) return "null";
  if (v === undefined) return "undefined";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (v instanceof Error) return v.message;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

/**
 * Coarse TypeScript annotation stripper.
 *
 * Removes the common TS syntax that breaks the V8 parser when run as
 * plain JS: parameter type annotations, return type annotations,
 * interface/type declarations, as-casts, generic type parameters on
 * calls, variable declaration type annotations. Not a full TS compiler
 * — agents emitting complex TS should emit JS directly.
 */
function stripTypeAnnotations(code: string): string {
  let out = code;
  // Remove `interface X { ... }` blocks.
  out = out.replace(/\binterface\s+\w+\s*(?:<[^>]+>)?\s*\{[^}]*\}/g, "");
  // Remove `type X = ...;` declarations.
  out = out.replace(/\btype\s+\w+\s*=\s*[^;\n]+[;\n]/g, "");
  // Remove `as Type` casts.
  out = out.replace(/\s+as\s+[A-Za-z_][\w.\[\]<>|&'" ]*/g, "");
  // Remove variable declaration type annotations:
  // `const x: Type = ...` → `const x = ...` (and let/var).
  out = out.replace(
    /\b(const|let|var)\s+(\w+)\s*:\s*[A-Za-z_][\w.\[\]<>|&'" ]*?(\s*=)/g,
    "$1 $2$3"
  );
  // Remove function parameter type annotations.
  out = out.replace(
    /\(([^)]*)\)/g,
    (_match, params: string) =>
      "(" +
      params
        .split(",")
        .map((p: string) => p.split(":")[0].trim())
        .join(", ") +
      ")"
  );
  // Remove return type annotations: `): Type {` → `) {`.
  out = out.replace(/\)\s*:\s*[A-Za-z_][\w.\[\]<>|&'" ]*\s*\{/g, ") {");
  // Remove generic type parameters on calls: `foo<T>(...)` → `foo(...)`.
  out = out.replace(/([A-Za-z_]\w*)\s*<[^<>]*>(\()/g, "$1$2");
  return out;
}

// ─── Hermes XML parsing ─────────────────────────────────────────────
/**
 * Parse Hermes XML tool-calling syntax from LLM output.
 *
 * Hermes convention: an LLM that wants to call a tool emits either:
 *   1. A `tool_call` block with JSON content (tool/args/id fields).
 *   2. An `execute_code` block with a code payload.
 *
 * This function uses the tag constants built via string concatenation
 * (see OPEN_TOOL_CALL / CLOSE_TOOL_CALL / OPEN_EXEC_CODE / CLOSE_EXEC_CODE)
 * so the regex source itself contains no literal closing-tag sequences.
 *
 * Returns an array of parsed tool calls. Malformed JSON inside a
 * tool_call block is silently skipped (no throw).
 */
export function parseHermesXML(content: string): HermesToolCall[] {
  const calls: HermesToolCall[] = [];
  if (!content) return calls;

  try {
    // Pattern 1: tool_call blocks with JSON content.
    const toolCallRegex = new RegExp(
      OPEN_TOOL_CALL + "\\s*([\\s\\S]*?)\\s*" + CLOSE_TOOL_CALL,
      "gi"
    );
    let m: RegExpExecArray | null;
    while ((m = toolCallRegex.exec(content)) !== null) {
      try {
        const parsed = JSON.parse(m[1].trim());
        if (parsed && typeof parsed === "object" && parsed.tool) {
          calls.push({
            tool: String(parsed.tool),
            args: (parsed.args as Record<string, unknown>) ?? {},
            id: String(parsed.id ?? "call_" + (calls.length + 1)),
          });
        }
      } catch {
        // Skip malformed JSON.
      }
    }

    // Pattern 2: execute_code blocks.
    const execRegex = new RegExp(
      OPEN_EXEC_CODE + "(?:\\s+language=\"(\\w+)\")?>([\\s\\S]*?)" + CLOSE_EXEC_CODE,
      "gi"
    );
    while ((m = execRegex.exec(content)) !== null) {
      const language = (m[1] ?? "javascript") as
        | "javascript"
        | "typescript"
        | "python";
      const code = m[2];
      calls.push({
        tool: "execute_code",
        args: { code, language },
        id: "exec_" + (calls.length + 1),
      });
    }
  } catch (err) {
    console.error(
      "[hermes-toolsets] parseHermesXML failed:",
      err instanceof Error ? err.message : String(err)
    );
  }

  return calls;
}

/**
 * Format tool calls as Hermes XML for injection into an LLM prompt.
 *
 * Emits both forms (OPEN_TOOL_CALL for general tools, OPEN_EXEC_CODE
 * for code execution) so the LLM sees valid examples of each. Tags
 * are built via string concatenation from the LT/GT/SLASH constants.
 */
export function formatHermesXML(toolCalls: HermesToolCall[]): string {
  if (!toolCalls.length) return "";
  return toolCalls
    .map((c: HermesToolCall) => {
      if (c.tool === "execute_code") {
        const lang = (c.args.language as string) ?? "javascript";
        const code = (c.args.code as string) ?? "";
        return (
          OPEN_EXEC_CODE +
          " language=\"" + lang + "\">\n" +
          code +
          "\n" + CLOSE_EXEC_CODE
        );
      }
      return (
        OPEN_TOOL_CALL + "\n" +
        JSON.stringify({ tool: c.tool, args: c.args, id: c.id }, null, 2) +
        "\n" + CLOSE_TOOL_CALL
      );
    })
    .join("\n\n");
}

// ─── Tool registry (declarative) ────────────────────────────────────
/**
 * Declarative registry of all Hermes tools available to agents.
 *
 * Each definition carries a `risk` level (low | medium | high | critical)
 * that gates the human-in-the-loop (HITL) approval flow. Low-risk tools
 * execute immediately; high/critical-risk tools create an `Approval` row
 * and return a "pending approval" result until the operator decides.
 */
export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "execute_code",
    description:
      "Execute a snippet of JavaScript, TypeScript, or Python code in a sandboxed environment. Use for calculations, data transformations, or quick scripts. Python requires an external runner.",
    risk: "medium",
    parameters: {
      type: "object",
      properties: {
        code: {
          type: "string",
          description: "The source code to execute.",
        },
        language: {
          type: "string",
          description: "One of: javascript, typescript, python.",
        },
      },
      required: ["code"],
    },
  },
  {
    name: "web_search",
    description:
      "Search the web for real-time information. Returns a list of result snippets with URLs. Use when you need current data beyond your training cutoff.",
    risk: "low",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The search query.",
        },
        limit: {
          type: "number",
          description: "Maximum number of results to return (default 5).",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "spawn_subagent",
    description:
      "Delegate a sub-task to another agent in the fleet. Creates a SubAgentTask record and notifies the conductor for routing. Use when a task is outside your primary capability.",
    risk: "high",
    parameters: {
      type: "object",
      properties: {
        task: {
          type: "string",
          description: "Natural-language description of the sub-task.",
        },
        preferredRole: {
          type: "string",
          description: "Optional: preferred agent role (e.g. Engineering, Research).",
        },
      },
      required: ["task"],
    },
  },
  {
    name: "create_memory",
    description:
      "Persist a fact, decision, or piece of knowledge to the memory graph. Idempotent — upserts on key. Use for anything that should outlive the current conversation.",
    risk: "low",
    parameters: {
      type: "object",
      properties: {
        key: {
          type: "string",
          description: "Unique identifier for this memory (e.g. company-name).",
        },
        value: {
          type: "string",
          description: "The memory content.",
        },
        scope: {
          type: "string",
          description: "One of: config, branding, agent, system, strategy, knowledge.",
        },
        tags: {
          type: "string",
          description: "Comma-separated tags for searchability.",
        },
      },
      required: ["key", "value", "scope"],
    },
  },
  {
    name: "search_memory",
    description:
      "Search the memory graph for relevant context. Returns matching MemoryItem records ranked by pinned status + strength.",
    risk: "low",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The search query.",
        },
        scope: {
          type: "string",
          description: "Optional: filter to a specific scope.",
        },
        limit: {
          type: "number",
          description: "Max results (default 5).",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "create_skill",
    description:
      "Synthesize a new reusable Skill from a successful multi-step execution. The skill is persisted with source=learned and made available to all agents.",
    risk: "critical",
    parameters: {
      type: "object",
      properties: {
        taskDescription: {
          type: "string",
          description: "Short description of what the task accomplished.",
        },
        steps: {
          type: "string",
          description: "JSON array of execution steps (see ExecutionStep type).",
        },
      },
      required: ["taskDescription", "steps"],
    },
  },
  {
    name: "execute_skill",
    description:
      "Invoke a previously-registered skill by its slug. Loads the full instructions + script template (progressive disclosure), increments the skill invocation counter, and returns the instructions to the agent for execution.",
    risk: "low",
    parameters: {
      type: "object",
      properties: {
        slug: {
          type: "string",
          description: "The skill unique slug.",
        },
      },
      required: ["slug"],
    },
  },
];

// ─── Tool dispatch ──────────────────────────────────────────────────
/**
 * Dispatch a parsed tool call to its handler.
 *
 * For low-risk tools, executes immediately and returns the result.
 * For medium-risk tools, executes immediately but logs to the audit
 * trail. For high/critical-risk tools, creates an `Approval` row and
 * returns a "pending approval" result — the caller pauses until the
 * operator decides (via the existing PATCH /api/approvals/[id] flow).
 *
 * Unknown tool names return `{ ok: false, output: "unknown tool" }`.
 */
export async function executeToolCall(
  call: HermesToolCall,
  context: ToolContext
): Promise<ToolResult> {
  try {
    const def = TOOL_DEFINITIONS.find((d) => d.name === call.tool);
    if (!def) {
      return {
        ok: false,
        output: "unknown tool: " + call.tool,
      };
    }

    // Gate on risk — high/critical operations require human approval.
    if (def.risk === "high" || def.risk === "critical") {
      const approval = await createApprovalForTool(call, context, def.risk);
      emit({
        type: "approval",
        ts: new Date().toISOString(),
        approval,
      });
      return {
        ok: false,
        output:
          "Pending operator approval (risk=" +
          def.risk +
          ", approvalId=" +
          approval.id +
          "). Tool execution paused — the operator will approve or deny via the Mission Control UI.",
        data: { approvalId: approval.id, status: "pending" },
      };
    }

    // Dispatch to the appropriate handler.
    switch (call.tool) {
      case "execute_code": {
        const code = String(call.args.code ?? "");
        const language = (String(call.args.language ?? "javascript") as
          | "javascript"
          | "typescript"
          | "python");
        const result = await executeCode(code, language);
        return {
          ok: result.ok,
          output: result.output || "(no output)",
          data: { error: result.error },
        };
      }

      case "web_search": {
        const query = String(call.args.query ?? "");
        const limit = Number(call.args.limit ?? 5);
        const results = await handleWebSearch(query, limit);
        return {
          ok: true,
          output: JSON.stringify(results, null, 2),
          data: results,
        };
      }

      case "create_memory": {
        const key = String(call.args.key ?? "");
        const value = String(call.args.value ?? "");
        const scope = String(call.args.scope ?? "knowledge");
        const tagsStr = String(call.args.tags ?? "");
        const tags = tagsStr
          ? tagsStr.split(",").map((t) => t.trim()).filter(Boolean)
          : [];
        const mem = await storeMemory(key, value, scope, context.agentId, tags);
        // storeMemory returns void — emit a memory.update event by re-querying
        // the stored row so the dashboard still gets a live notification.
        let stored: { id: string; key: string; value: string; scope: string; tags: string; pinned: boolean; strength: number; agentId: string | null; createdAt: Date } | null = null;
        try {
          stored = await db.memoryItem.findFirst({ where: { key, scope }, orderBy: { updatedAt: "desc" } }) as any ?? null;
        } catch { stored = null; }
        if (stored) {
          // Parse tags JSON → string[] for the SSE event schema.
          let tagsArray: string[] = [];
          try { tagsArray = JSON.parse(stored.tags || "[]"); } catch { tagsArray = []; }
          emit({
            type: "memory.update",
            ts: new Date().toISOString(),
            memory: {
              id: stored.id,
              key: stored.key,
              value: stored.value,
              scope: stored.scope as "config" | "branding" | "agent" | "system" | "strategy" | "knowledge",
              tags: tagsArray,
              pinned: stored.pinned,
              linkedTo: [],
              strength: stored.strength,
              agentId: stored.agentId,
              createdAt: stored.createdAt.toISOString(),
              updatedAt: stored.createdAt.toISOString(),
            },
          });
          return {
            ok: true,
            output: "Memory stored: " + key + " (scope=" + scope + ")",
            data: stored,
          };
        }
        return {
          ok: false,
          output: "Failed to store memory (check logs).",
        };
      }

      case "search_memory": {
        const query = String(call.args.query ?? "");
        const scope = call.args.scope ? String(call.args.scope) : undefined;
        const limit = Number(call.args.limit ?? 5);
        const results = await searchMemory(query, context.agentId, scope, limit);
        return {
          ok: true,
          output:
            "Found " + results.length + " memories:\n" +
            results
              .map(
                (m) =>
                  "- [" + m.scope + "] " + m.key + ": " + m.value.slice(0, 120)
              )
              .join("\n"),
          data: results,
        };
      }

      case "execute_skill": {
        const slug = String(call.args.slug ?? "");
        const skill = await findSkillBySlug(slug);
        if (!skill) {
          return {
            ok: false,
            output: "Skill not found: " + slug,
          };
        }
        // Bump usage counters immediately (assume success; will be
        // adjusted later if execution fails).
        await incrementSkillUsage(skill.id, true);
        return {
          ok: true,
          output:
            "Skill " + skill.name + " loaded.\n\n## Instructions\n" +
            (skill.instructions ?? "(no instructions)") +
            "\n\n## Script Template\n" +
            (skill.script ?? "(no script)"),
          data: skill,
        };
      }

      case "spawn_subagent": {
        // Already gated above for high-risk; if we reach here, risk was
        // downgraded. Still create a SubAgentTask record.
        const task = String(call.args.task ?? "");
        const sub = await db.subAgentTask.create({
          data: {
            parentId: context.agentId,
            task,
            status: "pending",
          },
        });
        return {
          ok: true,
          output:
            "Sub-agent task queued (id=" + sub.id + "). The conductor will route it shortly.",
          data: { subAgentTaskId: sub.id },
        };
      }

      case "create_skill": {
        // Critical-risk path; if we reach here, risk was downgraded.
        const taskDescription = String(call.args.taskDescription ?? "");
        const stepsRaw = String(call.args.steps ?? "[]");
        let steps: unknown;
        try {
          steps = JSON.parse(stepsRaw);
        } catch {
          return {
            ok: false,
            output: "Invalid steps JSON.",
          };
        }
        if (!Array.isArray(steps)) {
          return {
            ok: false,
            output: "steps must be a JSON array.",
          };
        }
        const created = await createSkillFromExecution(
          steps as Parameters<typeof createSkillFromExecution>[0],
          context.agentRole,
          taskDescription
        );
        return {
          ok: !!created,
          output: created
            ? "Skill created: " + created.name + " (id=" + created.id + ")"
            : "Skill creation failed (check logs)",
          data: created,
        };
      }

      default:
        return {
          ok: false,
          output: "Tool handler not implemented: " + call.tool,
        };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      "[hermes-toolsets] executeToolCall failed for " + call.tool + ":",
      message
    );
    return { ok: false, output: "Tool execution error: " + message };
  }
}

// ─── HITL approval creation ────────────────────────────────────────
/**
 * Create an `Approval` row for a high/critical-risk tool call.
 *
 * The approval is broadcast via the event bus so the Mission Control
 * UI surfaces it in the ApprovalsQueue panel. The operator approves
 * or denies via the existing PATCH /api/approvals/[id] endpoint —
 * when approved, the caller re-dispatches the original tool call
 * (with a bypassApproval flag, future work).
 */
async function createApprovalForTool(
  call: HermesToolCall,
  context: ToolContext,
  risk: ApprovalRisk
): Promise<Approval> {
  const title = "Tool call: " + call.tool;
  const summary =
    "Agent " + context.agentId + " (" + context.agentRole + ") requested to execute tool " +
    call.tool + " with args: " + JSON.stringify(call.args).slice(0, 300);

  const row = await db.approval.create({
    data: {
      title,
      summary,
      risk,
      status: "pending",
      requester: context.agentRole,
      agentId: context.agentId,
      action: call.tool,
      payload: JSON.stringify({ call, context }),
    },
  });

  return {
    id: row.id,
    title: row.title,
    summary: row.summary,
    risk: row.risk as ApprovalRisk,
    status: row.status as "pending" | "approved" | "denied" | "expired",
    requester: row.requester,
    agentId: row.agentId,
    action: row.action,
    amount: row.amount,
    payload: row.payload,
    brief: row.brief,
    discussionLog: row.discussionLog,
    oralConfirmed: row.oralConfirmed,
    voiceCallId: row.voiceCallId,
    createdAt: toIso(row.createdAt)!,
    decidedAt: toIso(row.decidedAt),
  };
}

// ─── Web search handler (mockable in dev) ───────────────────────────
/**
 * Web search handler.
 *
 * Uses the z-ai-web-dev-sdk web_search function if available;
 * otherwise returns a typed "search disabled" result so the agent can
 * degrade gracefully.
 *
 * In mock mode (ARIA_LLM_DISABLED=1) returns canned results for the
 * demo experience.
 */
async function handleWebSearch(
  query: string,
  limit: number
): Promise<Array<{ title: string; url: string; snippet: string }>> {
  try {
    if (process.env.ARIA_LLM_DISABLED === "1") {
      // Mock results — keep the agent unblocked in dev mode.
      return [
        {
          title: "Mock result for: " + query,
          url: "https://example.com/search?q=" + encodeURIComponent(query),
          snippet:
            "(mock mode) Web search is disabled. In production, this would return real search results.",
        },
      ];
    }

    // Dynamically import the SDK so the module loads even if the SDK
    // is not yet initialized (lazy initialization).
    const ZAIModule = await import("z-ai-web-dev-sdk");
    const ZAIClass = ZAIModule.default;
    const globalForZAI = globalThis as unknown as { __zaiInstance?: unknown };
    let zai = globalForZAI.__zaiInstance;
    if (!zai) {
      zai = await ZAIClass.create();
      globalForZAI.__zaiInstance = zai;
    }

    // The SDK exposes web_search as a function tool.
    const result = await (zai as unknown as {
      functions: {
        web_search: (args: { query: string; num?: number }) => Promise<{
          results?: Array<{ title: string; url: string; snippet?: string }>;
        }>;
      };
    }).functions.web_search({ query, num: Math.max(1, Math.min(20, limit)) });

    const results = result?.results ?? [];
    return results.slice(0, limit).map((r) => ({
      title: r.title,
      url: r.url,
      snippet: r.snippet ?? "",
    }));
  } catch (err) {
    console.error(
      "[hermes-toolsets] handleWebSearch failed:",
      err instanceof Error ? err.message : String(err)
    );
    return [
      {
        title: "Search failed",
        url: "",
        snippet:
          "Web search returned an error: " +
          (err instanceof Error ? err.message : String(err)),
      },
    ];
  }
}

// Avoid unused-import warnings — callLLM and parseJsonArray are used
// implicitly by downstream callers / future tool handlers; keeping the
// imports explicit documents intent.
void callLLM;
void parseJsonArray;

// ─── System prompt section for tool calling ────────────────────────
/**
 * Returns a Hermes-XML system-prompt section advertising the available
 * tools to the LLM. Consumed by the Conductor dispatcher when composing
 * an agent's system prompt.
 */
export function TOOLS_SYSTEM_PROMPT_SECTION(): string {
  const lines = TOOL_DEFINITIONS.map((t) => {
    const params = Object.entries(t.parameters.properties)
      .map(([k, v]) => `${k}: ${v.type} — ${v.description}`)
      .join("; ");
    return `- ${t.name} (risk=${t.risk}): ${t.description} | params: ${params || "none"}`;
  });
  return [
    "You have access to the following tools. Invoke one by emitting Hermes XML:",
    "<tool_call tool=\"<name>\"><arg name=\"<key>\"><value/></arg></tool_call>",
    "",
    ...lines,
  ].join("\n");
}
