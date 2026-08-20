/**
 * src/lib/mcp-client.ts — Model Context Protocol client registry.
 *
 * Server-only. Maintains a registry of MCP servers in the `Setting`
 * table (key="mcp.servers", JSON array). Each server has a name, URL,
 * status, and advertised tool list.
 *
 * `callTool()` returns a typed stub result — no live MCP transport is
 * established. This is the v25 porting target: a registry that lets
 * agents reference external MCP servers by name without breaking when
 * a server is offline.
 */

import { db } from "./db";
import { logger } from "./logger";

export interface McpServerEntry {
  name: string;
  url: string;
  status: "online" | "offline" | "unverified";
  tools: string[];
}

const SETTING_KEY = "mcp.servers";

const DEMO_SERVERS: McpServerEntry[] = [
  {
    name: "filesystem-mcp",
    url: "stdio://./mcp-servers/filesystem",
    status: "online",
    tools: ["read_file", "write_file", "list_dir", "search_files"],
  },
  {
    name: "browser-mcp",
    url: "http://localhost:3001/sse",
    status: "unverified",
    tools: ["navigate", "click", "extract_text", "screenshot"],
  },
];

async function readServers(): Promise<McpServerEntry[]> {
  try {
    const row = await db.setting.findUnique({ where: { key: SETTING_KEY } });
    if (!row) {
      // Seed the demo servers on first access.
      await db.setting.create({
        data: {
          key: SETTING_KEY,
          value: JSON.stringify(DEMO_SERVERS),
          category: "general",
        },
      });
      return [...DEMO_SERVERS];
    }
    const parsed = JSON.parse(row.value) as McpServerEntry[];
    if (!Array.isArray(parsed)) return [...DEMO_SERVERS];
    return parsed;
  } catch (err) {
    logger.error("mcp-client.read.failed", { error: String(err) });
    return [...DEMO_SERVERS];
  }
}

async function writeServers(servers: McpServerEntry[]): Promise<void> {
  const existing = await db.setting.findUnique({ where: { key: SETTING_KEY } });
  if (existing) {
    await db.setting.update({
      where: { key: SETTING_KEY },
      data: { value: JSON.stringify(servers) },
    });
  } else {
    await db.setting.create({
      data: {
        key: SETTING_KEY,
        value: JSON.stringify(servers),
        category: "general",
      },
    });
  }
}

// ─── listServers ────────────────────────────────────────────────────

export async function listServers(): Promise<McpServerEntry[]> {
  try {
    return await readServers();
  } catch (err) {
    logger.error("mcp-client.list.failed", { error: String(err) });
    return [];
  }
}

// ─── registerServer ─────────────────────────────────────────────────

export async function registerServer(input: {
  name: string;
  url: string;
  tools?: string[];
}): Promise<{ ok: boolean }> {
  try {
    const servers = await readServers();
    const idx = servers.findIndex((s) => s.name === input.name);
    const entry: McpServerEntry = {
      name: input.name,
      url: input.url,
      status: "unverified",
      tools: input.tools ?? [],
    };
    if (idx >= 0) {
      servers[idx] = entry;
    } else {
      servers.push(entry);
    }
    await writeServers(servers);
    logger.success("mcp-client.registered", { name: input.name });
    return { ok: true };
  } catch (err) {
    logger.error("mcp-client.register.failed", { error: String(err) });
    return { ok: false };
  }
}

// ─── callTool (stub) ────────────────────────────────────────────────

export async function callTool(input: {
  server: string;
  tool: string;
  args: Record<string, unknown>;
}): Promise<{ result: Record<string, unknown>; status: "ok" | "not_found" }> {
  try {
    const servers = await readServers();
    const server = servers.find((s) => s.name === input.server);
    if (!server) {
      return {
        result: { error: `server not found: ${input.server}` },
        status: "not_found",
      };
    }
    // Stub: echo back the args + server + tool so callers can verify wiring.
    return {
      result: {
        echo: input.args,
        server: input.server,
        tool: input.tool,
        timestamp: new Date().toISOString(),
      },
      status: "ok",
    };
  } catch (err) {
    logger.error("mcp-client.call.failed", { error: String(err) });
    return {
      result: { error: err instanceof Error ? err.message : String(err) },
      status: "not_found",
    };
  }
}
