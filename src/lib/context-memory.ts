// =====================================================================
// context-memory.ts — Context window management for LLM calls.
// =====================================================================
// Tracks recent shell/tool inputs+outputs in an in-memory ring buffer so
// the agent-loop can inject a bounded context window into the LLM prompt
// without unbounded growth. Distinct from working-memory.ts (which is
// taskId-scoped KV with TTL) — this module is a single global context
// window shared across one process.
// =====================================================================

interface CommandLogEntry {
  id: string
  command: string
  stdout: string
  stderr: string
  exitCode: number | null
  timestamp: string
  success: boolean
}

interface ContextEntry {
  role: string
  content: string
  timestamp: string
  tokensEstimate: number
}

const commandLog: CommandLogEntry[] = []
const contextWindow: ContextEntry[] = []
const MAX_CONTEXT_TOKENS = 8000
const MAX_COMMAND_LOG = 100
const MAX_ENTRY_CHARS = 5000
const MAX_STDOUT_SNIPPET = 2000

export function logCommand(cmd: string, result: { stdout?: string; stderr?: string; exitCode: number | null; success: boolean }): void {
  commandLog.unshift({
    id: `cmd-${Date.now()}`,
    command: cmd.slice(0, 500),
    stdout: (result.stdout ?? '').slice(0, MAX_STDOUT_SNIPPET),
    stderr: (result.stderr ?? '').slice(0, MAX_STDOUT_SNIPPET),
    exitCode: result.exitCode,
    timestamp: new Date().toISOString(),
    success: result.success,
  })
  if (commandLog.length > MAX_COMMAND_LOG) commandLog.length = MAX_COMMAND_LOG
  addContextEntry('tool', `$ ${cmd}\n${(result.stdout ?? '').slice(0, 500)}`, 600)
}

export function getRecentCommands(count = 10): CommandLogEntry[] {
  return commandLog.slice(0, count)
}

export function addContextEntry(role: string, content: string, tokens?: number): void {
  contextWindow.push({
    role,
    content: content.slice(0, MAX_ENTRY_CHARS),
    timestamp: new Date().toISOString(),
    tokensEstimate: tokens ?? Math.ceil(content.length / 4),
  })
  let total = contextWindow.reduce((s, e) => s + e.tokensEstimate, 0)
  while (total > MAX_CONTEXT_TOKENS && contextWindow.length > 5) {
    const removed = contextWindow.shift()
    if (removed) total -= removed.tokensEstimate
  }
}

export function getContextMessages(): Array<{ role: string; content: string }> {
  return contextWindow.map((e) => ({ role: e.role, content: e.content }))
}

export function initDefaultPreferences(): void {
  addContextEntry(
    'system',
    `OS: ${process.platform}, Shell: ${process.platform === 'win32' ? 'powershell' : 'bash'}, Project: ${process.cwd()}`,
    50,
  )
}
