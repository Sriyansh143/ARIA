// Browser Agent — port of Browser-Use's autonomous web browsing pattern.
//
// Browser-Use lets an LLM navigate websites by:
//   1. Extracting the DOM and labeling interactive elements (1, 2, 3...)
//   2. Asking the LLM "which element should I interact with next?"
//   3. Performing the action (click / type / select)
//   4. Repeating until the goal is accomplished
//
// We port this using Playwright (already a dependency via browser-login).
// The LLM sees a simplified text representation of the page (not the full
// HTML) — this reduces token usage by 90% vs sending raw HTML.
//
// Usage:
//   import { runBrowserTask } from '@/lib/browser-agent'
//   const result = await runBrowserTask({
//     goal: 'Find the price of iPhone 15 on amazon.com',
//     model: 'gpt-4o-mini',
//     startUrl: 'https://amazon.com',
//   })

import { chat } from '@/lib/llm'
import { logger } from '@/lib/logger'

// Inline SSRF guard (replaces @/lib/ssrf-guard dependency).
async function assertSafeUrl(rawUrl: string, _opts?: { allowLoopback?: boolean; allowPrivate?: boolean; allowLinkLocal?: boolean }): Promise<void> {
  let u: URL
  try { u = new URL(rawUrl) } catch { throw new Error('invalid URL') }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error(`disallowed protocol: ${u.protocol}`)
  }
  const host = u.hostname.toLowerCase()
  if (host === 'localhost' || host === 'metadata.google.internal') {
    throw new Error(`blocked host: ${host}`)
  }
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (ipv4) {
    const [a, b] = ipv4.slice(1).map(Number)
    if (a === 10 || a === 127 || a === 0) throw new Error(`blocked internal IP: ${host}`)
    if (a === 169 && b === 254) throw new Error(`blocked link-local IP: ${host}`)
    if (a === 172 && b >= 16 && b <= 31) throw new Error(`blocked private IP: ${host}`)
    if (a === 192 && b === 168) throw new Error(`blocked private IP: ${host}`)
  }
  if (host === '::1' || host.startsWith('fe80:')) {
    throw new Error(`blocked IPv6 internal address: ${host}`)
  }
}

export interface BrowserElement {
  id: number  // 1, 2, 3... (what the LLM sees)
  tag: string  // button, input, a, select, textarea
  role?: string  // accessibility role
  text: string  // visible text
  placeholder?: string
  href?: string
  ariaLabel?: string
}

export interface BrowserAction {
  type: 'click' | 'type' | 'select' | 'scroll' | 'navigate' | 'done' | 'failed' | 'extract'
  elementId?: number  // which element to interact with
  text?: string  // for type/select
  url?: string  // for navigate
  reasoning: string
  extractData?: string  // for extract — what to extract from the page
}

export interface BrowserTaskResult {
  accomplished: boolean
  stepsTaken: number
  actions: BrowserAction[]
  extractedData: string
  finalUrl: string
  finalTitle: string
  error?: string
}

const MAX_STEPS_DEFAULT = 15
const MAX_STEPS_CAP = 30

/**
 * Extract interactive elements from a Playwright page.
 * Returns a labeled list (element 1, 2, 3...) for the LLM.
 */
async function extractElements(page: Page): Promise<{ elements: BrowserElement[]; pageText: string; pageTitle: string }> {
  const result = await page.evaluate(() => {
    const elements: any[] = []
    const interactiveSelectors = [
      'a[href]', 'button', 'input', 'select', 'textarea',
      '[role="button"]', '[role="link"]', '[role="checkbox"]', '[role="tab"]',
      '[onclick]', '[contenteditable="true"]',
    ]

    let id = 1
    for (const selector of interactiveSelectors) {
      const els = document.querySelectorAll(selector)
      for (const el of Array.from(els)) {
        if (id > 50) break  // cap at 50 elements to control token usage
        const rect = (el as HTMLElement).getBoundingClientRect()
        if (rect.width === 0 || rect.height === 0) continue  // hidden

        const text = (el as HTMLElement).innerText?.trim().slice(0, 100) ||
                     (el as HTMLInputElement).value?.slice(0, 100) || ''
        elements.push({
          id: id++,
          tag: el.tagName.toLowerCase(),
          role: el.getAttribute('role') || undefined,
          text,
          placeholder: (el as HTMLInputElement).placeholder || undefined,
          href: (el as HTMLAnchorElement).href || undefined,
          ariaLabel: el.getAttribute('aria-label') || undefined,
        })
      }
      if (id > 50) break
    }

    // Get visible page text (simplified — first 2000 chars)
    const bodyText = document.body.innerText?.slice(0, 2000) || ''

    return {
      elements,
      pageText: bodyText,
      pageTitle: document.title,
    }
  })

  return result
}

/**
 * Format the page state for the LLM.
 * Keeps it compact to save tokens.
 */
function formatPageState(elements: BrowserElement[], pageText: string, pageTitle: string): string {
  const elementsStr = elements.map(e => {
    const parts = [`[${e.id}] <${e.tag}>`]
    if (e.text) parts.push(`"${e.text}"`)
    if (e.placeholder) parts.push(`placeholder="${e.placeholder}"`)
    if (e.href) parts.push(`href="${e.href}"`)
    if (e.ariaLabel) parts.push(`aria="${e.ariaLabel}"`)
    return parts.join(' ')
  }).join('\n')

  return `PAGE TITLE: ${pageTitle}

INTERACTIVE ELEMENTS:
${elementsStr || '(none found)'}

VISIBLE TEXT (first 2000 chars):
${pageText}`
}

/**
 * Ask the LLM what action to take next.
 */
async function planBrowserAction(
  model: string,
  goal: string,
  pageState: string,
  previousActions: BrowserAction[],
): Promise<BrowserAction> {
  const previousStr = previousActions.length > 0
    ? `\n\nPrevious actions:\n${previousActions.map((a, i) => `${i + 1}. ${a.type}${a.elementId ? `(${a.elementId})` : ''}: ${a.reasoning}`).join('\n')}`
    : ''

  const prompt = `Goal: ${goal}${previousStr}

Current page state:
${pageState}

Decide the NEXT action. Respond with JSON only:
{
  "type": "click|type|select|scroll|navigate|done|failed|extract",
  "element_id": 5,        // for click/type/select — the [N] of the element
  "text": "...",          // for type/select — text to enter or option to select
  "url": "https://...",   // for navigate
  "extract_data": "...",  // for extract — describe what to extract
  "reasoning": "Why this action"
}

Use "done" when the goal is accomplished. Use "extract" to pull specific data from the page before saying done.
Use "failed" only if the goal is impossible.`

  try {
    const result = await chat(prompt)
    const jsonMatch = result.content.match(/\{[\s\S]*\}/)
    const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : null
    if (parsed) {
      return {
        type: parsed.type || 'failed',
        elementId: typeof parsed.element_id === 'number' ? parsed.element_id : undefined,
        text: typeof parsed.text === 'string' ? parsed.text : undefined,
        url: typeof parsed.url === 'string' ? parsed.url : undefined,
        reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : 'No reasoning',
        extractData: typeof parsed.extract_data === 'string' ? parsed.extract_data : undefined,
      }
    }
    return { type: 'failed', reasoning: result.content }
  } catch (err) {
    return { type: 'failed', reasoning: `LLM call failed: ${err instanceof Error ? err.message : String(err)}` }
  }
}

/**
 * Execute a browser action on a Playwright page.
 */
async function executeBrowserAction(page: Page, action: BrowserAction, elements: BrowserElement[]): Promise<string> {
  switch (action.type) {
    case 'click': {
      if (!action.elementId) return 'error: no elementId'
      const el = elements.find(e => e.id === action.elementId)
      if (!el) return `error: element ${action.elementId} not found`
      // Find the element on the page by its properties
      const selector = el.href ? `a[href="${el.href}"]` :
                       el.text ? `text="${el.text}"` :
                       el.ariaLabel ? `[aria-label="${el.ariaLabel}"]` : null
      if (!selector) return 'error: could not build selector'
      await page.click(selector, { timeout: 5000 }).catch(() => {})
      return `clicked element ${action.elementId}`
    }

    case 'type': {
      if (!action.elementId || !action.text) return 'error: need elementId + text'
      const el = elements.find(e => e.id === action.elementId)
      if (!el) return `error: element ${action.elementId} not found`
      const selector = el.placeholder ? `[placeholder="${el.placeholder}"]` :
                       el.ariaLabel ? `[aria-label="${el.ariaLabel}"]` :
                       el.text ? `text="${el.text}"` : 'input, textarea'
      await page.fill(selector, action.text, { timeout: 5000 }).catch(() => {})
      return `typed "${action.text}" into element ${action.elementId}`
    }

    case 'select': {
      if (!action.elementId || !action.text) return 'error: need elementId + text'
      await page.selectOption(`select >> nth=${action.elementId - 1}`, action.text, { timeout: 5000 }).catch(() => {})
      return `selected "${action.text}" in element ${action.elementId}`
    }

    case 'scroll': {
      await page.evaluate(() => window.scrollBy(0, 500))
      return 'scrolled down'
    }

    case 'navigate': {
      if (!action.url) return 'error: no url'
      // PATCH (audit 2026-07 / N7): SSRF guard. The browser agent's navigate
      // action was the only URL-taking code path that did NOT route through
      // ssrf-guard.ts. An LLM (or attacker via prompt injection on a visited
      // page) could navigate the headless browser to http://127.0.0.1:3011/list
      // (credential vault), http://169.254.169.254/latest/meta-data/ (cloud
      // metadata), or internal admin endpoints, then use 'extract' to read
      // the response body. Now we assert the URL is safe first.
      try {
        await assertSafeUrl(action.url, { allowLoopback: false, allowPrivate: false, allowLinkLocal: false })
      } catch (err) {
        return `error: URL rejected by SSRF guard: ${err instanceof Error ? err.message : String(err)}`
      }
      await page.goto(action.url, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {})
      return `navigated to ${action.url}`
    }

    case 'extract': {
      const text = await page.evaluate(() => document.body.innerText)
      return `extracted: ${text.slice(0, 2000)}`
    }

    case 'done':
      return 'goal accomplished'

    case 'failed':
      return `failed: ${action.reasoning}`

    default:
      return `unknown action: ${action.type}`
  }
}

/**
 * Run an autonomous browser task.
 *
 * @example
 * const result = await runBrowserTask({
 *   goal: 'Find the price of iPhone 15 on amazon.com',
 *   model: 'gpt-4o-mini',
 *   startUrl: 'https://amazon.com',
 * })
 */
export async function runBrowserTask(opts: {
  goal: string
  model: string
  startUrl?: string
  maxSteps?: number
  headless?: boolean  // default true
  onStep?: (step: number, action: BrowserAction, pageTitle: string) => void
}): Promise<BrowserTaskResult> {
  const maxSteps = Math.min(opts.maxSteps ?? MAX_STEPS_DEFAULT, MAX_STEPS_CAP)
  const actions: BrowserAction[] = []
  let extractedData = ''

  let browser: Browser | null = null
  try {
    const { chromium } = await import('playwright')
    // Qwen 3.7 Enhancement: Anti-ban stealth mode for social media automation.
    // These launch options mask automation fingerprints that Instagram,
    // LinkedIn, WhatsApp detect to block bots.
    browser = await chromium.launch({
      headless: opts.headless ?? true,
      args: [
        '--disable-blink-features=AutomationControlled',  // hide webdriver flag
        '--disable-features=IsolateOrigins,site-per-process',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--window-size=1920,1080',
        '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      ],
    }) as unknown as Browser
    const page = await browser.newPage() as unknown as Page

    // Inject stealth scripts to mask automation
    await page.addInitScript(() => {
      // Remove webdriver property
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
      // Mock plugins
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] })
      // Mock languages
      Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] })
      // Mock chrome runtime
      // @ts-ignore
      window.chrome = { runtime: {} }
      // Mock permissions
      const originalQuery = window.navigator.permissions.query
      window.navigator.permissions.query = (parameters: any) =>
        parameters.name === 'notifications'
          ? Promise.resolve({ state: Notification.permission } as any)
          : originalQuery(parameters)
    })

    if (opts.startUrl) {
      // PATCH (audit 2026-07 / L1): SSRF guard on the initial startUrl. The
      // navigate-action guard (line 232) only covers LLM-driven navigations
      // AFTER the browser is open. An attacker could pass startUrl=
      // http://127.0.0.1:3011/list (credential vault) or
      // http://169.254.169.254/latest/meta-data/ (cloud metadata) and the
      // LLM's 'extract' action would read the response body. Guard here too.
      try {
        await assertSafeUrl(opts.startUrl, { allowLoopback: false, allowPrivate: false, allowLinkLocal: false })
      } catch (err) {
        return {
          accomplished: false,
          stepsTaken: 0,
          actions: actions,
          extractedData: '',
          finalUrl: '',
          finalTitle: '',
          error: `startUrl rejected by SSRF guard: ${err instanceof Error ? err.message : String(err)}`,
        }
      }
      await page.goto(opts.startUrl, { waitUntil: 'domcontentloaded', timeout: 20000 })
    }

    for (let step = 1; step <= maxSteps; step++) {
      const { elements, pageText, pageTitle } = await extractElements(page)
      const pageState = formatPageState(elements, pageText, pageTitle)
      const action = await planBrowserAction(opts.model, opts.goal, pageState, actions)

      actions.push(action)
      opts.onStep?.(step, action, pageTitle)

      if (action.type === 'done') {
        return {
          accomplished: true,
          stepsTaken: step,
          actions,
          extractedData,
          finalUrl: page.url(),
          finalTitle: pageTitle,
        }
      }

      if (action.type === 'failed') {
        return {
          accomplished: false,
          stepsTaken: step,
          actions,
          extractedData,
          finalUrl: page.url(),
          finalTitle: pageTitle,
          error: action.reasoning,
        }
      }

      if (action.type === 'extract') {
        const result = await executeBrowserAction(page, action, elements)
        extractedData += result + '\n'
        continue
      }

      const result = await executeBrowserAction(page, action, elements)
      logger.debug({ step, action: action.type, result }, 'browser-agent: step')

      // Wait for page to settle
      await page.waitForTimeout(1500)
    }

    return {
      accomplished: false,
      stepsTaken: maxSteps,
      actions,
      extractedData,
      finalUrl: page.url(),
      finalTitle: await page.title(),
      error: 'Max steps reached without accomplishing goal',
    }
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : String(err) }, 'browser-agent: task failed')
    return {
      accomplished: false,
      stepsTaken: actions.length,
      actions,
      extractedData,
      finalUrl: '',
      finalTitle: '',
      error: err instanceof Error ? err.message : String(err),
    }
  } finally {
    if (browser) await browser.close().catch(() => {})
  }
}

// Re-export types for callers (the original chromium import exposed these).
export type Browser = { newPage: () => Promise<Page>; close: () => Promise<void> }
export type Page = {
  goto: (url: string, opts?: { waitUntil?: string; timeout?: number }) => Promise<unknown>
  title: () => Promise<string>
  url: () => string
  evaluate: <T>(fn: () => T) => Promise<T>
  click: (selector: string, opts?: { timeout?: number }) => Promise<void>
  fill: (selector: string, text: string, opts?: { timeout?: number }) => Promise<void>
  selectOption: (selector: string, value: string, opts?: { timeout?: number }) => Promise<void>
  waitForTimeout: (ms: number) => Promise<void>
  addInitScript: (fn: () => void) => Promise<void>
}
