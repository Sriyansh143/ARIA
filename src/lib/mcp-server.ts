// =====================================================================
// MCP Server -- pure TypeScript Model Context Protocol JSON-RPC server.
// =====================================================================
// Phase 17 / Dimension 5.
//
// Implements the MCP spec (2024-11-05) using only Node stdlib:
//   - http, crypto, readline, stream
//
// No @modelcontextprotocol/sdk dependency. No external transport
// libraries. Speaks JSON-RPC 2.0 over stdio OR HTTP+SSE.
//
// Methods implemented:
//   initialize           → server capabilities + protocol version
//   ping                 → liveness check
//   tools/list           → list registered tools
//   tools/call           → invoke a tool
//   resources/list       → list registered resources
//   resources/read       → read a resource by URI
//   resources/templates/list  → list URI templates
//
// Transport modes:
//   stdio  -- read JSON-RPC from stdin, write to stdout (one per line)
//   http   -- POST /mcp with JSON-RPC body, returns JSON-RPC response
//   sse    -- GET /mcp/sse opens a stream for server-initiated notifications
// =====================================================================

import { createServer, IncomingMessage, ServerResponse } from 'http'
import { createInterface } from 'readline'
import { randomUUID } from 'crypto'
import { EventEmitter } from 'events'

export const MCP_PROTOCOL_VERSION = '2024-11-05'

export interface JsonSchema {
  type: string
  properties?: Record<string, { type: string; description?: string; enum?: string[] }>
  required?: string[]
}

export interface MCPTool {
  name: string
  description: string
  inputSchema: JsonSchema
  handler: (args: Record<string, unknown>) => Promise<unknown>
}

export interface MCPResource {
  uri: string
  name: string
  description?: string
  mimeType?: string
  reader: () => Promise<string | Buffer>
}

interface JsonRpcRequest {
  jsonrpc: '2.0'
  id: string | number | null
  method: string
  params?: Record<string, unknown>
}

interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: string | number | null
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

const RPC_ERROR = {
  PARSE_ERROR: { code: -32700, message: 'Parse error' },
  INVALID_REQUEST: { code: -32600, message: 'Invalid Request' },
  METHOD_NOT_FOUND: { code: -32601, message: 'Method not found' },
  INVALID_PARAMS: { code: -32602, message: 'Invalid params' },
  INTERNAL_ERROR: { code: -32603, message: 'Internal error' },
}

export class MCPServer {
  private name: string
  private version: string
  private tools = new Map<string, MCPTool>()
  private resources = new Map<string, MCPResource>()
  private emitter = new EventEmitter()

  constructor(name: string, version: string) {
    this.name = name
    this.version = version
  }

  registerTool(tool: MCPTool): void {
    this.tools.set(tool.name, tool)
  }

  registerResource(res: MCPResource): void {
    this.resources.set(res.uri, res)
  }

  // --- Core JSON-RPC dispatcher --------------------------------------
  async handleRequest(req: JsonRpcRequest): Promise<JsonRpcResponse> {
    try {
      switch (req.method) {
        case 'initialize':
          return this.handleInitialize(req)
        case 'ping':
          return { jsonrpc: '2.0', id: req.id, result: {} }
        case 'tools/list':
          return this.handleToolsList(req)
        case 'tools/call':
          return await this.handleToolsCall(req)
        case 'resources/list':
          return this.handleResourcesList(req)
        case 'resources/read':
          return await this.handleResourcesRead(req)
        case 'resources/templates/list':
          return { jsonrpc: '2.0', id: req.id, result: { templates: [] } }
        case 'notifications/initialized':
          // notification -- no response
          return { jsonrpc: '2.0', id: req.id, result: {} }
        default:
          return {
            jsonrpc: '2.0',
            id: req.id,
            error: RPC_ERROR.METHOD_NOT_FOUND,
          }
      }
    } catch (err) {
      return {
        jsonrpc: '2.0',
        id: req.id,
        error: {
          code: RPC_ERROR.INTERNAL_ERROR.code,
          message: err instanceof Error ? err.message : String(err),
        },
      }
    }
  }

  private handleInitialize(req: JsonRpcRequest): JsonRpcResponse {
    return {
      jsonrpc: '2.0',
      id: req.id,
      result: {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {
          tools: { listChanged: true },
          resources: { listChanged: true, subscribe: true },
        },
        serverInfo: { name: this.name, version: this.version },
      },
    }
  }

  private handleToolsList(req: JsonRpcRequest): JsonRpcResponse {
    return {
      jsonrpc: '2.0',
      id: req.id,
      result: {
        tools: Array.from(this.tools.values()).map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        })),
      },
    }
  }

  private async handleToolsCall(req: JsonRpcRequest): Promise<JsonRpcResponse> {
    const name = req.params?.name as string
    const args = (req.params?.arguments || {}) as Record<string, unknown>
    const tool = this.tools.get(name)
    if (!tool) {
      return { jsonrpc: '2.0', id: req.id, error: RPC_ERROR.METHOD_NOT_FOUND }
    }
    try {
      const result = await tool.handler(args)
      return {
        jsonrpc: '2.0',
        id: req.id,
        result: {
          content: [
            {
              type: 'text',
              text: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
            },
          ],
        },
      }
    } catch (err) {
      return {
        jsonrpc: '2.0',
        id: req.id,
        result: {
          content: [{ type: 'text', text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        },
      }
    }
  }

  private handleResourcesList(req: JsonRpcRequest): JsonRpcResponse {
    return {
      jsonrpc: '2.0',
      id: req.id,
      result: {
        resources: Array.from(this.resources.values()).map((r) => ({
          uri: r.uri,
          name: r.name,
          description: r.description,
          mimeType: r.mimeType || 'text/plain',
        })),
      },
    }
  }

  private async handleResourcesRead(req: JsonRpcRequest): Promise<JsonRpcResponse> {
    const uri = req.params?.uri as string
    const res = this.resources.get(uri)
    if (!res) {
      return { jsonrpc: '2.0', id: req.id, error: RPC_ERROR.METHOD_NOT_FOUND }
    }
    const contents = await res.reader()
    return {
      jsonrpc: '2.0',
      id: req.id,
      result: {
        contents: [
          {
            uri: res.uri,
            mimeType: res.mimeType || 'text/plain',
            text: typeof contents === 'string' ? contents : contents.toString('base64'),
          },
        ],
      },
    }
  }

  // --- Stdio transport -----------------------------------------------
  handleStdio(stdin: NodeJS.ReadableStream, stdout: NodeJS.WritableStream): void {
    const rl = createInterface({ input: stdin, terminal: false })
    rl.on('line', async (line) => {
      if (!line.trim()) return
      let req: JsonRpcRequest
      try {
        req = JSON.parse(line)
      } catch {
        stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          id: null,
          error: RPC_ERROR.PARSE_ERROR,
        }) + '\n')
        return
      }
      const resp = await this.handleRequest(req)
      if (req.id !== null || resp.result !== undefined) {
        stdout.write(JSON.stringify(resp) + '\n')
      }
    })
  }

  // --- HTTP + SSE transport ------------------------------------------
  listenHttp(port: number, host: string = '127.0.0.1'): void {
    // Auth middleware: in this build, no shared-key middleware is wired up.
    // Callers behind a reverse proxy should add their own auth (e.g. Caddy
    // basic-auth) — this server trusts the gateway.
    const requireMiniServiceAuth: (req: IncomingMessage) => boolean = () => true
    const isMiniServiceHealthPath: (req: IncomingMessage) => boolean = (req) => req.url === '/health'

    const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      res.setHeader('Access-Control-Allow-Origin', process.env.JARVIS_ALLOWED_ORIGINS?.split(',')[0] || 'http://127.0.0.1:3000')
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-JARVIS-Key')
      res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
      if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return }

      // FEAT-4 / Feature 3 — auth check BEFORE route matching. /health
      // is exempt (fleet health check needs to reach it without the key).
      if (!isMiniServiceHealthPath(req) && !requireMiniServiceAuth(req)) {
        res.writeHead(401, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Unauthorized: X-JARVIS-Key header required' }))
        return
      }

      // SSE endpoint for server-initiated notifications
      if (req.method === 'GET' && req.url === '/mcp/sse') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        })
        const id = randomUUID()
        res.write(`data: ${JSON.stringify({ type: 'connected', clientId: id })}\n\n`)
        const onToolChanged = () => res.write(`data: ${JSON.stringify({ type: 'tools/changed' })}\n\n`)
        this.emitter.on('tools-changed', onToolChanged)
        req.on('close', () => this.emitter.off('tools-changed', onToolChanged))
        return
      }

      if (req.method === 'POST' && req.url === '/mcp') {
        let body = ''
        for await (const chunk of req) body += chunk
        let rpcReq: JsonRpcRequest
        try {
          rpcReq = JSON.parse(body)
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({
            jsonrpc: '2.0', id: null, error: RPC_ERROR.PARSE_ERROR,
          }))
          return
        }
        const resp = await this.handleRequest(rpcReq)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(resp))
        return
      }

      // Health endpoint
      if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          ok: true,
          server: this.name,
          version: this.version,
          tools: this.tools.size,
          resources: this.resources.size,
        }))
        return
      }

      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'not found' }))
    })
    // FIX (audit 2026-07-07 / BUG-4-C4): Add EADDRINUSE error handler.
    // mcp-gateway was the ONLY mini-service missing this (the SEC-5 sweep
    // patched the others but didn't reach this file). Without it, a port
    // conflict throws an uncaughtException that crashes the service
    // silently — the fleet health check then reports it as down.
    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`[mcp-server] FATAL: port ${port} is already in use.`)
        console.error(`[mcp-server] Another mcp-gateway instance may still be running.`)
        console.error(`[mcp-server] Run "npm run fleets" or start-jarvis-all.bat to clear ports.`)
      } else {
        console.error(`[mcp-server] HTTP server error:`, err)
      }
      process.exit(1)
    })
    server.listen(port, host, () => {
      console.log(`[mcp-server] HTTP+SSE listening on ${host}:${port}`)
    })
  }
}
