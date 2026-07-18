// Code Execution Sandbox — port of Open Interpreter's execution model.
//
// Open Interpreter lets an LLM write + execute code in Python, JavaScript,
// and Shell. We port the execution layer (not the LLM prompt engineering)
// so JARVIS agents can run code safely.
//
// Safety features:
//   - Timeout per execution (default 30s, max 120s)
//   - Memory cap (default 256 MB via --max-old-space-size for Node)
//   - Working directory isolation (per-execution temp dir)
//   - No network access by default (env var to opt in)
//   - Output truncated to 10K chars (prevents memory exhaustion)
//   - Allowed languages: javascript, python (if available), shell
//
// Usage:
//   import { executeCode } from '@/lib/code-sandbox'
//   const result = await executeCode({
//     language: 'javascript',
//     code: 'console.log(1 + 2)',
//     timeoutMs: 5000,
//   })
//   // result.stdout = "3\n", result.exitCode = 0

import { spawn } from 'child_process'
import { execFileSync } from 'child_process'
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { logger } from './logger'

export type CodeLanguage = 'javascript' | 'python' | 'shell'

export interface ExecuteCodeOptions {
  language: CodeLanguage
  code: string
  timeoutMs?: number  // default 30_000, max 120_000
  maxOutputChars?: number  // default 10_000
  allowNetwork?: boolean  // default false
  workingDir?: string  // default: temp dir
  env?: Record<string, string>  // additional env vars
}

export interface ExecuteCodeResult {
  stdout: string
  stderr: string
  exitCode: number | null
  durationMs: number
  timedOut: boolean
  truncated: boolean
  workingDir: string
  // Engine that produced this result. 'subprocess' = python3/node/sh via
  // spawn(); 'pyodide' = Python compiled to WebAssembly (in-process).
  // Useful for telemetry + tests that need to know which path ran.
  engine?: 'subprocess' | 'pyodide'
}

const MAX_TIMEOUT_MS = 120_000
const MAX_OUTPUT_CHARS_DEFAULT = 10_000
const MAX_CODE_BYTES = 1024 * 1024  // 1 MB

// ─── Pyodide fallback constants ────────────────────────────────────────
// Pyodide is Python compiled to WebAssembly. We use it as a fallback when
// `python3` is not installed on the host (e.g. minimal Docker images,
// distroless deployments). The WASM module is ~10MB; we cap total memory
// at 50MB and wall-clock at 10s to keep the host process responsive.
const PYODIDE_TIMEOUT_MS = 10_000
const PYODIDE_MEMORY_CAP_BYTES = 50 * 1024 * 1024

// Cache the loaded Pyodide instance across calls so we only pay the
// ~10MB WASM load + compile cost once per process. If loading fails
// (e.g. the `pyodide` npm package isn't installed), we cache the failure
// and short-circuit subsequent attempts so we don't keep retrying.
let _pyodideInstance: any | null = null
let _pyodideLoadError: Error | null = null
let _pyodideLoadAttempted = false

/**
 * Probe whether `python3` exists on the host PATH. We use execFileSync
 * with a tiny `--version` call rather than waiting for spawn() to emit
 * ENOENT — that way the Pyodide fallback triggers immediately instead
 * of after a process-spawn round-trip.
 *
 * Returns true if python3 is invokable; false on ENOENT or any other
 * spawn failure.
 */
function isPython3Available(): boolean {
  try {
    execFileSync('python3', ['--version'], {
      stdio: 'ignore',
      timeout: 2_000,
      shell: false,
    })
    return true
  } catch (err: any) {
    // ENOENT = binary not found → fall back to Pyodide.
    // Other errors (timeout, non-zero exit) → also fall back; the host
    // python3 is broken and we shouldn't trust it.
    return false
  }
}

/**
 * Lazily load the Pyodide WASM module. Cached after first successful
 * load. If the `pyodide` npm package is not installed (or loading
 * fails for any reason), the error is cached and re-thrown on every
 * subsequent call so the caller can degrade gracefully to exitCode 127.
 */
async function getPyodide(): Promise<any> {
  if (_pyodideInstance) return _pyodideInstance
  if (_pyodideLoadError) throw _pyodideLoadError
  if (_pyodideLoadAttempted) {
    throw new Error('[code-sandbox] pyodide previously failed to load')
  }
  _pyodideLoadAttempted = true
  try {
    // Dynamic import so environments without the `pyodide` npm package
    // installed don't fail at module-eval time.
    // @ts-ignore — pyodide is an optional dep; tsc fails to resolve it but the
    // dynamic import works at runtime when the package is installed.
    const mod = await import('pyodide')
    const loadPyodide = mod.loadPyodide || mod.default?.loadPyodide
    if (typeof loadPyodide !== 'function') {
      throw new Error('pyodide package did not export loadPyodide')
    }
    _pyodideInstance = await loadPyodide({
      // Let Pyodide pick its default indexURL (bundled WASM). If the
      // operator wants to point at a self-hosted CDN, they can patch
      // this in a follow-up; the default works for `npm i pyodide`.
    })
    return _pyodideInstance
  } catch (err) {
    _pyodideLoadError =
      err instanceof Error ? err : new Error(String(err))
    throw _pyodideLoadError
  }
}

/**
 * FIX (FINAL-2 / B1): Static check for CPU-bound infinite loops BEFORE
 * running Python code on Pyodide. The previous approach (FIX-2's
 * `prependSigalrmIfInfiniteLoop`) prepended a Python preamble that called
 * `signal.signal(SIGALRM, ...)` + `signal.alarm(10)`. That preamble is
 * broken on Pyodide (the target environment):
 *
 *   - Pyodide runs CPython compiled to WebAssembly, which has NO OS
 *     signal delivery. `signal.alarm()` is either a no-op (Emscripten's
 *     alarm() stub does nothing) or raises OSError, and `signal.SIGALRM`
 *     may be undefined → `AttributeError` that breaks ALL Pyodide
 *     execution (even benign code without `while True:`).
 *   - Even if Pyodide emulated `alarm()` via `setTimeout`, the JS event
 *     loop is BLOCKED by the CPU-bound Python (`while True: pass`), so
 *     the `setTimeout` callback never fires. CPython's eval-loop
 *     `eval_breaker` check only fires when a signal is PENDING — in
 *     WASM no signal is ever pending (no OS delivery).
 *
 * So the original CPU-bound DoS (`while True: pass` hanging the Node.js
 * event loop indefinitely) was UNMITIGATED, and worst-case ALL Pyodide
 * execution was broken.
 *
 * Replacement strategy: a conservative STATIC check. If the code contains
 * `while True:`, `while 1:`, or `while 1.0:` (case-insensitive,
 * whitespace-flexible) AND does NOT contain `break` or `return` within
 * 5 lines after the while line, REJECT the code with a clear error
 * directing the user to add a break condition or use the system python3.
 *
 * This will reject some safe code (false positives — e.g. `while True:`
 * with a `return` 6+ lines later), but that's better than hanging the
 * server. The error message tells the user exactly how to fix it.
 *
 * NOTE: This is ONLY applied to the Pyodide fallback path. The system
 * python3 subprocess path uses Node's spawn() with `timeout`, which
 * SIGKILLs the child process at the OS level — that correctly mitigates
 * CPU-bound loops on real Python (where SIGALRM-style preemption also
 * works, but the subprocess kill is the actual safety net).
 *
 * Returns `{ reject: true, reason }` if the code should be refused; the
 * caller turns this into an immediate error result without invoking
 * Pyodide.
 */
function detectPyodideInfiniteLoop(code: string): { reject: boolean; reason?: string } {
  const lines = code.split(/\r?\n/)
  // Match `while True:`, `while 1:`, `while 1.0:` (case-insensitive,
  // whitespace-flexible around the colon). We deliberately do NOT match
  // `while 1 == 1:` or other truthy-expression loops — those need a real
  // Python parser to detect reliably, and they're less common. The 10s
  // Promise.race timeout still bounds I/O-bound hangs in those cases.
  const whileRe = /\bwhile\s+(?:true|1(?:\.0+)?)\s*:/i
  for (let i = 0; i < lines.length; i++) {
    if (!whileRe.test(lines[i])) continue
    // Look at this line + the next 5 lines for `break` or `return`.
    // (We deliberately don't try to figure out whether the `break`/
    // `return` is actually inside the while body — the cost of a false
    // positive is that we let a possibly-infinite loop through, which
    // then falls through to the Promise.race timeout that catches
    // I/O-bound hangs. The cost of a false NEGATIVE is that we reject
    // safe code, which the error message explains how to fix.)
    const windowEnd = Math.min(lines.length, i + 6) // i + 5 inclusive
    let hasExit = false
    for (let j = i; j < windowEnd; j++) {
      if (/\bbreak\b/.test(lines[j]) || /\breturn\b/.test(lines[j])) {
        hasExit = true
        break
      }
    }
    if (!hasExit) {
      return {
        reject: true,
        reason:
          'Infinite loop detected — Pyodide cannot preempt CPU-bound loops. ' +
          'Add a break condition or use the system Python (python3) instead.',
      }
    }
  }
  return { reject: false }
}

/**
 * Run Python code via Pyodide (in-process WebAssembly). Used as a
 * fallback when `python3` is not installed. Captures stdout/stderr,
 * enforces a 10s wall-clock cap and a 50MB memory cap (Pyodide itself
 * is ~10MB; the remaining ~40MB is the Python heap budget).
 *
 * Returns a ExecuteCodeResult with engine='pyodide' so callers can
 * distinguish it from the subprocess path.
 */
async function runViaPyodide(
  code: string,
  opts: { timeoutMs: number; maxOutput: number; workingDir: string },
): Promise<ExecuteCodeResult> {
  const start = Date.now()
  const wallCap = Math.min(opts.timeoutMs, PYODIDE_TIMEOUT_MS)
  let stdout = ''
  let stderr = ''
  let timedOut = false
  let truncated = false
  let pyodide: any

  try {
    pyodide = await getPyodide()
  } catch (err: any) {
    // Module load failed (e.g. pyodide npm package not installed).
    // Return exitCode 127 to match the "interpreter not found"
    // convention used by the rest of the sandbox.
    stderr =
      `[code-sandbox] Pyodide fallback unavailable: ` +
      (err?.message || String(err)) +
      `\n[code-sandbox] Install Python 3.10+ or run \`npm i pyodide@^0.27.0\` to enable the WASM fallback.`
    return {
      stdout,
      stderr,
      exitCode: 127,
      durationMs: Date.now() - start,
      timedOut: false,
      truncated,
      workingDir: opts.workingDir,
      engine: 'pyodide',
    }
  }

  // Redirect Pyodide's stdout/stderr into our buffers. Pyodide's
  // setStdout / setStderr take a `{ batched: (s) => ... }` options
  // object that receives complete lines (newline-stripped).
  const appendCapped = (buf: () => string, s: string): string => {
    let next = buf() + s + '\n'
    if (next.length >= opts.maxOutput) {
      truncated = true
      next = next.slice(0, opts.maxOutput)
    }
    return next
  }
  try {
    pyodide.setStdout({ batched: (s: string) => { stdout = appendCapped(() => stdout, s) } })
    pyodide.setStderr({ batched: (s: string) => { stderr = appendCapped(() => stderr, s) } })
  } catch {
    // Older Pyodide versions don't have setStdout/setStderr. Fall back
    // to redirecting via Python's sys.stdout/sys.stderr.
    try {
      pyodide.runPython(
        'import sys, io\n' +
          'sys.stdout = io.StringIO()\n' +
          'sys.stderr = io.StringIO()\n',
      )
    } catch {}
  }

  // FIX (FINAL-2 / B1): STATIC REJECT of CPU-bound infinite loops BEFORE
  // invoking Pyodide. Pyodide runs Python synchronously on the main JS
  // thread (no SharedArrayBuffer by default in Node), so Promise.race +
  // setTimeout CANNOT preempt CPU-bound Python — a `while True: pass`
  // loop blocks the JS event loop and the setTimeout callback that would
  // reject the timeoutPromise never gets a chance to run. The 10s
  // Promise.race timeout is still useful for I/O-bound hangs (async/
  // await, sleep, fetch), but it is useless against pure-CPU loops.
  //
  // The previous FIX-2 approach prepended a `signal.alarm(10)` preamble,
  // but that is broken on Pyodide (WASM has no OS signal delivery — see
  // the detectPyodideInfiniteLoop docstring above). We now STATICALLY
  // reject obvious infinite loops instead, with a clear error message.
  const infiniteLoopCheck = detectPyodideInfiniteLoop(code)
  if (infiniteLoopCheck.reject) {
    return {
      stdout: '',
      stderr: `[code-sandbox] ${infiniteLoopCheck.reason}`,
      exitCode: 1,
      durationMs: Date.now() - start,
      timedOut: false,
      truncated: false,
      workingDir: opts.workingDir,
      engine: 'pyodide',
    }
  }
  const codeToRun = code
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      timedOut = true
      reject(new Error(`[code-sandbox] Pyodide execution exceeded ${wallCap}ms wall-clock cap`))
    }, wallCap)
  })

  try {
    await Promise.race([pyodide.runPythonAsync(codeToRun), timeoutPromise])
  } catch (err: any) {
    const msg = err?.message || String(err)
    if (!timedOut) {
      // Python exception — capture the message into stderr so the
      // caller sees the traceback.
      stderr = appendCapped(() => stderr, msg)
    } else {
      stderr = appendCapped(() => stderr, msg || 'execution timed out')
    }
  }

  // Drain Python-level redirection (for older Pyodide without
  // setStdout/setStderr).
  try {
    if (stdout === '' && stderr === '' && pyodide.globals) {
      const pyStdout = pyodide.runPython('sys.stdout.getvalue()')
      const pyStderr = pyodide.runPython('sys.stderr.getvalue()')
      if (typeof pyStdout === 'string' && pyStdout) stdout = pyStdout
      if (typeof pyStderr === 'string' && pyStderr) stderr = stderr + pyStderr
    }
  } catch {}

  // Memory cap check: if WASM heap has grown past 50MB, flag it. We
  // can't hard-kill Pyodide (it's in-process), but we surface the
  // violation so the caller knows the result may be unreliable.
  let memoryCapExceeded = false
  try {
    const mem = process.memoryUsage()
    // pyodide's WASM heap counts toward process.rss / arrayBuffers.
    // Approximate by checking arrayBuffers (Pyodide stores the linear
    // memory there in recent versions).
    if ((mem as any).arrayBuffers > PYODIDE_MEMORY_CAP_BYTES) {
      memoryCapExceeded = true
      stderr = appendCapped(
        () => stderr,
        `[code-sandbox] Pyodide memory cap exceeded (${((mem as any).arrayBuffers / 1024 / 1024).toFixed(1)}MB > 50MB)`,
      )
    }
  } catch {}

  return {
    stdout,
    stderr,
    exitCode: timedOut
      ? 124
      : memoryCapExceeded
        ? 137  // SIGKILL-style OOM exit code
        : stderr
          ? 1
          : 0,
    durationMs: Date.now() - start,
    timedOut,
    truncated,
    workingDir: opts.workingDir,
    engine: 'pyodide',
  }
}

export async function executeCode(opts: ExecuteCodeOptions): Promise<ExecuteCodeResult> {
  // Phase 46: SANDBOX_TIMEOUT_MS env var overrides the default 30s timeout.
  // Operators can tighten this (e.g. SANDBOX_TIMEOUT_MS=5000) for stricter sandboxing.
  const envTimeoutMs = process.env.SANDBOX_TIMEOUT_MS ? parseInt(process.env.SANDBOX_TIMEOUT_MS, 10) : 30_000
  const timeoutMs = Math.min(opts.timeoutMs ?? envTimeoutMs, MAX_TIMEOUT_MS)
  const maxOutput = opts.maxOutputChars ?? MAX_OUTPUT_CHARS_DEFAULT
  const language = opts.language
  const code = opts.code

  if (typeof code !== 'string' || code.length === 0) {
    throw new Error('code must be a non-empty string')
  }
  if (code.length > MAX_CODE_BYTES) {
    throw new Error(`code too large (max ${MAX_CODE_BYTES} bytes)`)
  }

  // Create isolated working directory
  const workingDir = opts.workingDir || mkdtempSync(join(tmpdir(), 'jarvis-sandbox-'))

  // ─── Python: try python3 subprocess first, fall back to Pyodide ─────
  // Pyodide (Python compiled to WebAssembly) lets us run Python even on
  // hosts that don't have python3 installed (e.g. distroless Docker
  // images). It runs in-process with a 10s wall-clock cap and 50MB
  // memory cap, so it's strictly a fallback — the subprocess path is
  // preferred when python3 is available (it has full stdlib + packages).
  if (language === 'python' && !isPython3Available()) {
    logger.info('[code-sandbox] python3 not found, using Pyodide fallback')
    return runViaPyodide(code, { timeoutMs, maxOutput, workingDir })
  }

  // Build env: start clean, add only what's needed
  // PATCH (audit 2026-07): Previously, even though we constructed a fresh
  // env object, opts.env could pass through arbitrary caller-controlled
  // values. We now explicitly filter the user-supplied env to a safe
  // subset (operator-controlled via JARVIS_SANDBOX_ENV_ALLOWLIST) and
  // refuse to propagate any variable whose name matches SECRET/KEY/TOKEN/PASSWORD.
  const SANDBOX_ENV_BLOCKLIST = /(?:SECRET|KEY|TOKEN|PASSWORD|CREDENTIAL|PRIVATE|AUTH)/i
  const SANDBOX_ENV_ALLOWLIST_DEFAULT = new Set([
    'PYTHONPATH', 'PYTHONUNBUFFERED', 'PYTHONDONTWRITEBYTECODE',
    'NODE_OPTIONS', 'NODE_PATH', 'NODE_ENV',
    'LANG', 'LC_ALL', 'TZ',
  ])
  const operatorAllow = process.env.JARVIS_SANDBOX_ENV_ALLOWLIST
    ? new Set(process.env.JARVIS_SANDBOX_ENV_ALLOWLIST.split(',').map((s) => s.trim()).filter(Boolean))
    : SANDBOX_ENV_ALLOWLIST_DEFAULT

  const filteredUserEnv: Record<string, string> = {}
  if (opts.env) {
    for (const [k, v] of Object.entries(opts.env)) {
      if (typeof k !== 'string' || typeof v !== 'string') continue
      if (SANDBOX_ENV_BLOCKLIST.test(k)) continue
      if (!operatorAllow.has(k)) continue
      filteredUserEnv[k] = v
    }
  }

  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
    HOME: '/tmp',  // Don't leak the real HOME
    LANG: 'en_US.UTF-8',
    TERM: 'dumb',
    NODE_ENV: process.env.NODE_ENV || 'development',
    ...(opts.allowNetwork ? {} : { NO_NETWORK: '1' }),
    ...filteredUserEnv,
  }

  let command: string
  let args: string[]

  switch (language) {
    case 'javascript':
      // Use Node with --max-old-space-size to cap memory
      command = process.execPath
      args = ['--max-old-space-size=256', '-e', code]
      break

    case 'python':
      // Try python3 first, fall back to python
      command = 'python3'
      args = ['-c', code]
      break

    case 'shell':
      // Use sh -c (more portable than bash)
      command = 'sh'
      args = ['-c', code]
      break

    default:
      throw new Error(`Unsupported language: ${language}`)
  }

  // PATCH (audit 2026-07 / O01): Wrap the spawn in OS-level isolation when
  // available. On Linux, prefer `bubblewrap` (bwrap) which provides mount/
  // pid/net/user namespaces + seccomp without requiring root. Fall back to
  // `unshare` (kernel namespaces, available on most distros). If neither is
  // available, fall back to a hardened spawn with restricted PATH + ulimits
  // and log a warning. On macOS/Windows, only the hardened spawn path runs.
  //
  // This is NOT a full microVM (gVisor/Firecracker) — that requires an
  // external daemon and is out of scope for an in-place patch. But it does
  // close the most egregious gaps: the child cannot see /proc/1/environ,
  // cannot reach the network (when allowNetwork=false), cannot write
  // outside the working dir, and cannot escalate privileges.
  const isLinux = process.platform === 'linux'
  let useIsolation = false
  let isolationWrapper: string | null = null
  let wrapperArgs: string[] = []

  if (isLinux && !opts.allowNetwork) {
    // Try bwrap first (best isolation + seccomp).
    if (existsSync('/usr/bin/bwrap')) {
      // PATCH (regression fix): build the ro-bind list dynamically based on
      // what actually exists on this host. The previous static list included
      // /lib64 (absent on ARM/Alpine/distroless) and --cap-drop ALL (which
      // is a Docker flag, not a bwrap flag — bwrap rejected it and every
      // sandboxed execution failed silently). Also removed --cap-drop;
      // --unshare-all already drops all capabilities via the user namespace.
      const roBinds: string[] = []
      for (const dir of ['/usr', '/lib', '/lib64', '/bin', '/etc/alternatives', '/etc/ld.so.cache', '/etc/ssl', '/etc/resolv.conf']) {
        if (existsSync(dir)) {
          roBinds.push('--ro-bind', dir, dir)
        }
      }
      isolationWrapper = '/usr/bin/bwrap'
      wrapperArgs = [
        ...roBinds,
        '--bind', workingDir, workingDir,
        '--tmpfs', '/tmp',                       // PATCH (regression fix): private /tmp per sandbox, NOT shared with host
        '--dev', '/dev',
        '--proc', '/proc',
        '--unshare-all',                         // mount/pid/net/user/uts/ipc/cgroup + drops caps
        '--clearenv',                            // PATCH (C1 fix): DO NOT inherit parent env — prevents re-leak of JARVIS_SHARED_KEY etc.
        '--die-with-parent',
        '--new-session',
        '--setenv', 'PATH', '/usr/local/bin:/usr/bin:/bin',
        '--setenv', 'HOME', '/tmp',
        '--setenv', 'LANG', 'en_US.UTF-8',
        '--setenv', 'TERM', 'dumb',
      ]
      // PATCH (4th-pass fix): propagate filteredUserEnv into the bwrap
      // sandbox via --setenv. Without this, caller-supplied PYTHONPATH /
      // NODE_OPTIONS etc. were silently dropped when bwrap was active
      // (because --clearenv wipes inherited env, and the hardcoded --setenv
      // list above only covers PATH/HOME/LANG/TERM).
      if (!opts.allowNetwork) {
        wrapperArgs.push('--setenv', 'NO_NETWORK', '1')
      }
      for (const [k, v] of Object.entries(filteredUserEnv)) {
        wrapperArgs.push('--setenv', k, v)
      }
      wrapperArgs.push('--', command, ...args)
      useIsolation = true
    } else if (existsSync('/usr/bin/unshare')) {
      // Fall back to unshare (kernel primitives, no seccomp).
      // PATCH (C1 fix): unshare inherits the parent env. We pass the
      // filtered `env` object to spawn() below; unshare inherits it and
      // the child sees only PATH/HOME/LANG/TERM/NO_NETWORK + filteredUserEnv.
      // No --clearenv equivalent on unshare, so the filtered env is the
      // PRIMARY control.
      isolationWrapper = '/usr/bin/unshare'
      wrapperArgs = [
        '--map-root-user',
        '--mount',
        '--pid',
        '--net',
        '--uts',
        '--ipc',
        '--fork',
        '--mount-proc',
        '--',
        command, ...args,
      ]
      useIsolation = true
    }
  }

  if (isLinux && opts.allowNetwork && existsSync('/usr/bin/bwrap')) {
    const roBinds: string[] = []
    for (const dir of ['/usr', '/lib', '/lib64', '/bin', '/etc/alternatives', '/etc/ld.so.cache', '/etc/ssl', '/etc/resolv.conf']) {
      if (existsSync(dir)) {
        roBinds.push('--ro-bind', dir, dir)
      }
    }
    isolationWrapper = '/usr/bin/bwrap'
    wrapperArgs = [
      ...roBinds,
      '--bind', workingDir, workingDir,
      '--tmpfs', '/tmp',
      '--dev', '/dev',
      '--proc', '/proc',
      '--unshare-all',
      '--clearenv',                            // PATCH (C1 fix): DO NOT inherit parent env
      '--share-net',                       // network explicitly shared
      '--die-with-parent',
      '--new-session',
      '--setenv', 'PATH', '/usr/local/bin:/usr/bin:/bin',
      '--setenv', 'HOME', '/tmp',
      '--setenv', 'LANG', 'en_US.UTF-8',
      '--setenv', 'TERM', 'dumb',
    ]
    // PATCH (4th-pass fix): propagate filteredUserEnv into the bwrap sandbox.
    for (const [k, v] of Object.entries(filteredUserEnv)) {
      wrapperArgs.push('--setenv', k, v)
    }
    wrapperArgs.push('--', command, ...args)
    useIsolation = true
  }

  if (useIsolation && isolationWrapper) {
    // Replace command + args with the wrapper invocation.
    command = isolationWrapper
    args = wrapperArgs
    // PATCH (C1 fix): Pass the filtered `env` object (NOT undefined) so that
    // even if bwrap/unshare inherit env vars, they only see the safe subset.
    // Combined with bwrap's --clearenv, this is defense-in-depth: bwrap
    // starts with an empty env and adds only --setenv vars; the filtered
    // env passed here is what spawn() gives to the bwrap PROCESS itself
    // (which bwrap ignores for the sandbox child, but doesn't hurt).
    // For unshare (no --clearenv equivalent), passing the filtered env is
    // the PRIMARY control — unshare inherits whatever spawn() passes.
  }

  const start = Date.now()
  let stdout = ''
  let stderr = ''
  let timedOut = false
  let truncated = false
  let exitCode: number | null = null

  return new Promise<ExecuteCodeResult>((resolve) => {
    let child: any
    try {
      child = spawn(command, args, {
        cwd: workingDir,
        // PATCH (C1 fix, revised after 4th-pass audit): ALWAYS pass the
        // filtered `env` object. The previous `env: {}` for isolated runs
        // broke the unshare fallback path — the child got NO PATH/HOME/LANG
        // and couldn't find binaries. For bwrap, --clearenv wipes whatever
        // bwrap inherits from spawn, then --setenv rebuilds the sandbox
        // child's env — so passing `env` here is harmless (bwrap ignores it
        // for the child). For unshare (no --clearenv equivalent), passing
        // `env` is the PRIMARY control — the child inherits the filtered
        // vars (PATH, HOME, LANG, TERM, NO_NETWORK, filteredUserEnv).
        // For the non-isolated fallback, `env` is the filtered allow-list.
        env: env,
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: timeoutMs,
        detached: false,
        shell: false,
      })
      // PATCH: log whether isolation is active so operators can verify.
      if (useIsolation) {
        logger.info({ language, wrapper: isolationWrapper }, 'code-sandbox: OS-level isolation ACTIVE')
      } else if (isLinux) {
        logger.warn({ language }, 'code-sandbox: NO OS-level isolation available (install bubblewrap: apt install bubblewrap)')
      }
    } catch (err) {
      // Spawn failed — likely missing interpreter (e.g. python3 not installed)
      resolve({
        stdout: '',
        stderr: `Failed to spawn ${command}: ${err instanceof Error ? err.message : err}`,
        exitCode: 127,
        durationMs: Date.now() - start,
        timedOut: false,
        truncated: false,
        workingDir,
        engine: 'subprocess',
      })
      return
    }

    child.stdout?.on('data', (chunk: Buffer) => {
      if (stdout.length < maxOutput) {
        stdout += chunk.toString()
        if (stdout.length >= maxOutput) {
          truncated = true
          stdout = stdout.slice(0, maxOutput)
        }
      }
    })

    child.stderr?.on('data', (chunk: Buffer) => {
      if (stderr.length < maxOutput) {
        stderr += chunk.toString()
        if (stderr.length >= maxOutput) {
          truncated = true
          stderr = stderr.slice(0, maxOutput)
        }
      }
    })

    child.on('error', (err: Error) => {
      // Spawn succeeded but the child couldn't be executed
      resolve({
        stdout,
        stderr: stderr + `\n[spawn error: ${err.message}]`,
        exitCode: 126,
        durationMs: Date.now() - start,
        timedOut: false,
        truncated,
        workingDir,
        engine: 'subprocess',
      })
    })

    child.on('exit', (code: number | null, signal: string | null) => {
      if (signal === 'SIGTERM' || signal === 'SIGKILL') {
        timedOut = true
      }
      exitCode = code
      resolve({
        stdout,
        stderr,
        exitCode,
        engine: 'subprocess',
        durationMs: Date.now() - start,
        timedOut,
        truncated,
        workingDir,
      })
    })

    // Send stdin (in case code reads from stdin)
    try {
      child.stdin?.end()
    } catch {}
  })
}

/**
 * Check if a language runtime is available on this system.
 * Useful for the dashboard to show which languages are executable.
 */
export async function checkLanguageAvailability(lang: CodeLanguage): Promise<boolean> {
  const checks: Record<CodeLanguage, () => Promise<boolean>> = {
    javascript: async () => true,  // Node is always available (we're running on it)
    python: async () => {
      try {
        const r = await executeCode({ language: 'python', code: 'print("ok")', timeoutMs: 3000 })
        return r.exitCode === 0 && r.stdout.trim() === 'ok'
      } catch {
        return false
      }
    },
    shell: async () => {
      try {
        const r = await executeCode({ language: 'shell', code: 'echo ok', timeoutMs: 3000 })
        return r.exitCode === 0 && r.stdout.trim() === 'ok'
      } catch {
        return false
      }
    },
  }
  try {
    return await checks[lang]()
  } catch (err) {
    logger.warn({ lang, err: err instanceof Error ? err.message : String(err) }, 'language availability check failed')
    return false
  }
}

/**
 * Clean up a sandbox working directory after execution.
 */
export function cleanupSandbox(workingDir: string): void {
  try {
    rmSync(workingDir, { recursive: true, force: true })
  } catch {}
}