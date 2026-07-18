// Structured logger — minimal dependency-free implementation.
//
// Replaces console.log/error/warn across the codebase with structured JSON
// logs that log aggregators (Loki, Datadog, Better Stack) can parse.
//
// In development: pretty-prints to stdout for readability.
// In production: emits JSON to stdout (Docker/journald captures it).
//
// Usage:
//   import { logger } from '@/lib/llm'
//   logger.info({ route: '/api/chat', model, latencyMs }, 'chat completed')
//   logger.error({ err, route }, 'chat failed')

type Level = 'debug' | 'info' | 'warn' | 'error' | 'fatal'

const isDev = process.env.NODE_ENV !== 'production'
const LEVEL_PRIORITY: Record<Level, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  fatal: 60,
}
const MIN_LEVEL: Level = (process.env.LOG_LEVEL as Level) || (isDev ? 'debug' : 'info')

function format(level: Level, objOrMsg: unknown, msg?: string): string {
  const ts = new Date().toISOString()
  const base: Record<string, unknown> = { level, time: ts }
  if (msg) base.msg = msg
  if (objOrMsg instanceof Error) {
    base.err = { message: objOrMsg.message, stack: objOrMsg.stack, name: objOrMsg.name }
  } else if (typeof objOrMsg === 'object' && objOrMsg !== null) {
    Object.assign(base, objOrMsg)
  } else if (typeof objOrMsg === 'string' && !msg) {
    base.msg = objOrMsg
  } else if (objOrMsg !== undefined) {
    base.data = objOrMsg
  }
  if (isDev) {
    // Pretty-print: level colored + msg + key fields
    const colors: Record<Level, string> = {
      debug: '\x1b[90m',
      info: '\x1b[32m',
      warn: '\x1b[33m',
      error: '\x1b[31m',
      fatal: '\x1b[35m',
    }
    const reset = '\x1b[0m'
    const tsShort = ts.slice(11, 19)
    const message = (base.msg as string) || ''
    const extras = Object.entries(base)
      .filter(([k]) => k !== 'level' && k !== 'time' && k !== 'msg')
      .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`)
      .join(' ')
    return `${colors[level]}${level.toUpperCase().padEnd(5)}${reset} ${tsShort} ${message} ${extras}`.trim()
  }
  return JSON.stringify(base)
}

function log(level: Level, objOrMsg: unknown, msg?: string): void {
  if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[MIN_LEVEL]) return
  const line = format(level, objOrMsg, msg)
  switch (level) {
    case 'debug':
      console.debug(line)
      break
    case 'info':
      console.info(line)
      break
    case 'warn':
      console.warn(line)
      break
    case 'error':
    case 'fatal':
      console.error(line)
      break
  }
}

export interface Logger {
  debug: (objOrMsg: unknown, msg?: string) => void
  info: (objOrMsg: unknown, msg?: string) => void
  warn: (objOrMsg: unknown, msg?: string) => void
  error: (objOrMsg: unknown, msg?: string) => void
  fatal: (objOrMsg: unknown, msg?: string) => void
  child: (bindings: Record<string, unknown>) => Logger
}

export const logger: Logger = {
  debug: (o, m) => log('debug', o, m),
  info: (o, m) => log('info', o, m),
  warn: (o, m) => log('warn', o, m),
  error: (o, m) => log('error', o, m),
  fatal: (o, m) => log('fatal', o, m),
  child: (bindings) => childLogger(bindings),
}

function childLogger(bindings: Record<string, unknown>): Logger {
  return {
    debug: (o, m) => log('debug', mergeBindings(bindings, o), m),
    info: (o, m) => log('info', mergeBindings(bindings, o), m),
    warn: (o, m) => log('warn', mergeBindings(bindings, o), m),
    error: (o, m) => log('error', mergeBindings(bindings, o), m),
    fatal: (o, m) => log('fatal', mergeBindings(bindings, o), m),
    child: (extra) => childLogger({ ...bindings, ...extra }),
  }
}

function mergeBindings(bindings: Record<string, unknown>, objOrMsg: unknown): unknown {
  if (objOrMsg instanceof Error) {
    return { ...bindings, err: { message: objOrMsg.message, name: objOrMsg.name, stack: objOrMsg.stack } }
  }
  if (typeof objOrMsg === 'object' && objOrMsg !== null) {
    return { ...bindings, ...(objOrMsg as Record<string, unknown>) }
  }
  return bindings
}
