// logger.ts — leveled, structured, dev-friendly console logger.
// Used across all server-side lib modules + API routes.

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "success";

const LEVEL_ORDER: Record<LogLevel, number> = {
  trace: 5,
  debug: 10,
  info: 20,
  success: 25,
  warn: 30,
  error: 40,
};

const MIN_LEVEL: LogLevel =
  (process.env.ARIA_LOG_LEVEL as LogLevel) || (process.env.NODE_ENV === "production" ? "info" : "debug");

const COLORS: Record<LogLevel, string> = {
  trace: "\x1b[90m",
  debug: "\x1b[90m",
  info: "\x1b[36m",
  success: "\x1b[32m",
  warn: "\x1b[33m",
  error: "\x1b[31m",
};
const RESET = "\x1b[0m";

function fmt(meta?: Record<string, unknown>): string {
  if (!meta || Object.keys(meta).length === 0) return "";
  try {
    return " " + JSON.stringify(meta);
  } catch {
    return " [unserializable meta]";
  }
}

function emit(level: LogLevel, scope: string, message: string, meta?: Record<string, unknown>) {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[MIN_LEVEL]) return;
  const ts = new Date().toISOString();
  const scopeTag = `[${scope}]`;
  if (process.env.NODE_ENV !== "production") {
    console.log(
      `${COLORS[level]}${ts}${RESET} ${COLORS[level]}${level.padEnd(7)}${RESET} ${scopeTag.padEnd(22)} ${message}${fmt(meta)}`
    );
  } else {
    console.log(JSON.stringify({ ts, level, scope, message, meta }));
  }
}

export interface Logger {
  trace: (msg: string, meta?: Record<string, unknown>) => void;
  debug: (msg: string, meta?: Record<string, unknown>) => void;
  info: (msg: string, meta?: Record<string, unknown>) => void;
  success: (msg: string, meta?: Record<string, unknown>) => void;
  warn: (msg: string, meta?: Record<string, unknown>) => void;
  error: (msg: string, meta?: Record<string, unknown>) => void;
  child: (scope: string) => Logger;
}

export function createLogger(scope: string): Logger {
  return {
    trace: (m, meta) => emit("trace", scope, m, meta),
    debug: (m, meta) => emit("debug", scope, m, meta),
    info: (m, meta) => emit("info", scope, m, meta),
    success: (m, meta) => emit("success", scope, m, meta),
    warn: (m, meta) => emit("warn", scope, m, meta),
    error: (m, meta) => emit("error", scope, m, meta),
    child: (s) => createLogger(`${scope}:${s}`),
  };
}

export const logger = createLogger("aria");
