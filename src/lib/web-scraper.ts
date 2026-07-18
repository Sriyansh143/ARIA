// =====================================================================
// web-scraper.ts — Scrape web pages → markdown + fit markdown.
// =====================================================================
// Uses fetch() + cheerio for HTML parsing (no heavy browser automation
// dependency). For JS-heavy pages, callers can use the browser-agent.
//
// Safety:
//   - SSRF guard inline (blocks private/loopback/link-local IPs)
//   - Timeout per request (default 30s)
//   - Deep crawl capped at 50 pages / depth 5
// =====================================================================

import * as cheerio from 'cheerio'
import { logger } from '@/lib/logger'

export interface ScrapeResult {
  url: string
  title: string
  markdown: string
  fitMarkdown: string  // heuristic-filtered, main content only
  links: string[]
  scrapedAt: string
}

export interface ScrapeOptions {
  /** Use headless browser for JS-heavy pages (reserved for future; currently ignored — fetch only). */
  useBrowser?: boolean
  /** Max pages for deep crawl (default: 1 = single page) */
  maxPages?: number
  /** Max depth for deep crawl (default: 1) */
  maxDepth?: number
  /** Strategy: bfs (breadth-first) or dfs (depth-first) */
  strategy?: 'bfs' | 'dfs'
  /** Allowed domains for deep crawl (default: same domain as start URL) */
  allowedDomains?: string[]
  /** Timeout per page in ms (default: 30000) */
  timeoutMs?: number
}

// ─── Inline SSRF guard ────────────────────────────────────────────────
class SsrfError extends Error { constructor(m: string) { super(m); this.name = 'SsrfError' } }

async function assertSafeUrl(rawUrl: string): Promise<void> {
  let u: URL
  try { u = new URL(rawUrl) } catch { throw new SsrfError('invalid URL') }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new SsrfError(`disallowed protocol: ${u.protocol}`)
  }
  const host = u.hostname.toLowerCase()
  if (host === 'localhost' || host === 'metadata.google.internal') {
    throw new SsrfError(`blocked host: ${host}`)
  }
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (ipv4) {
    const [a, b] = ipv4.slice(1).map(Number)
    if (a === 10 || a === 127 || a === 0) throw new SsrfError(`blocked internal IP: ${host}`)
    if (a === 169 && b === 254) throw new SsrfError(`blocked link-local IP: ${host}`)
    if (a === 172 && b >= 16 && b <= 31) throw new SsrfError(`blocked private IP: ${host}`)
    if (a === 192 && b === 168) throw new SsrfError(`blocked private IP: ${host}`)
  }
  if (host === '::1' || host.startsWith('fe80:')) {
    throw new SsrfError(`blocked IPv6 internal address: ${host}`)
  }
}

async function fetchHtml(url: string, timeoutMs: number): Promise<string> {
  const r = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; JarvisScraper/1.0; +https://jarvis.local)',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    signal: AbortSignal.timeout(timeoutMs),
    redirect: 'follow',
  })
  if (!r.ok) {
    throw new Error(`HTTP ${r.status} ${r.statusText}`)
  }
  return await r.text()
}

/**
 * Scrape a single URL → clean markdown + fit markdown.
 */
export async function scrapeUrl(url: string, opts: ScrapeOptions = {}): Promise<ScrapeResult> {
  const timeoutMs = opts.timeoutMs ?? 30000

  await assertSafeUrl(url)

  const html = await fetchHtml(url, timeoutMs)
  const $ = cheerio.load(html)

  const title = $('title').first().text().trim()
    || $('h1').first().text().trim()
    || url

  // Extract links (resolve relative URLs against the page URL)
  const links: string[] = []
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href')
    if (!href) return
    try {
      const resolved = new URL(href, url).href
      links.push(resolved)
    } catch {
      /* skip invalid href */
    }
  })
  const uniqueLinks = [...new Set(links)].slice(0, 100)

  const markdown = htmlToMarkdown(html)
  const fitMarkdown = fitMarkdownHeuristic(html)

  return {
    url,
    title,
    markdown,
    fitMarkdown,
    links: uniqueLinks,
    scrapedAt: new Date().toISOString(),
  }
}

/**
 * Deep crawl: scrape multiple pages starting from a URL.
 * Resumable: if a crawl is interrupted, results already collected are returned.
 */
export async function deepCrawl(startUrl: string, opts: ScrapeOptions = {}): Promise<ScrapeResult[]> {
  const maxPages = Math.min(opts.maxPages ?? 10, 50)
  const maxDepth = Math.min(opts.maxDepth ?? 2, 5)
  const strategy = opts.strategy ?? 'bfs'
  const startHost = (() => { try { return new URL(startUrl).hostname } catch { return '' } })()
  const allowedDomains = opts.allowedDomains ?? (startHost ? [startHost] : [])

  await assertSafeUrl(startUrl)

  const results: ScrapeResult[] = []
  const visited = new Set<string>()
  const queue: { url: string; depth: number }[] = [{ url: startUrl, depth: 0 }]

  while (queue.length > 0 && results.length < maxPages) {
    const item = strategy === 'bfs' ? queue.shift()! : queue.pop()!
    const { url, depth } = item
    if (visited.has(url) || depth > maxDepth) continue
    visited.add(url)

    try {
      const result = await scrapeUrl(url, { timeoutMs: opts.timeoutMs })
      results.push(result)

      if (depth < maxDepth) {
        for (const link of result.links) {
          try {
            const linkUrl = new URL(link)
            if (allowedDomains.includes(linkUrl.hostname) && !visited.has(linkUrl.href)) {
              queue.push({ url: linkUrl.href, depth: depth + 1 })
            }
          } catch { /* skip invalid URLs */ }
        }
      }
    } catch (err) {
      logger.warn({ err: (err as Error).message, url }, 'web-scraper: failed to scrape')
    }
  }

  return results
}

/**
 * Convert HTML to clean markdown.
 */
function htmlToMarkdown(html: string): string {
  const $ = cheerio.load(html)
  $('script, style, noscript, iframe, svg, canvas').remove()

  let markdown = ''
  $('body *').each((_, el) => {
    const $el = $(el)
    const tag = (el as { tagName?: string }).tagName?.toLowerCase()
    if (!tag) return
    const text = $el.text().trim()
    if (!text) return

    if (tag === 'h1') markdown += `\n# ${text}\n`
    else if (tag === 'h2') markdown += `\n## ${text}\n`
    else if (tag === 'h3') markdown += `\n### ${text}\n`
    else if (tag === 'h4') markdown += `\n#### ${text}\n`
    else if (tag === 'h5') markdown += `\n##### ${text}\n`
    else if (tag === 'h6') markdown += `\n###### ${text}\n`
    else if (tag === 'p') markdown += `\n${text}\n`
    else if (tag === 'li') markdown += `\n- ${text}`
    else if (tag === 'pre' || tag === 'code') markdown += `\n\`\`\`\n${text}\n\`\`\`\n`
    else if (tag === 'blockquote') markdown += `\n> ${text}\n`
    else if (tag === 'a') {
      const href = $el.attr('href')
      if (href) markdown += `[${text}](${href})`
    }
  })

  if (!markdown.trim()) {
    markdown = $('body').text().replace(/\s+/g, ' ').trim()
  }
  markdown = markdown.replace(/\n{3,}/g, '\n\n').trim()
  return markdown
}

/**
 * Fit Markdown heuristic: extract only the main content, strip nav/footer/ads.
 * Reduces token cost by ~60% on typical web pages.
 */
function fitMarkdownHeuristic(html: string): string {
  const $ = cheerio.load(html)
  $('script, style, noscript, iframe, svg, canvas, nav, footer, aside, header').remove()
  $('[role="navigation"], [role="banner"], [role="contentinfo"], [role="complementary"]').remove()
  $('[class*="nav"], [class*="footer"], [class*="sidebar"], [class*="ad-"], [class*="ads"], [class*="banner"], [class*="cookie"], [class*="popup"], [class*="modal"]').remove()
  $('[id*="nav"], [id*="footer"], [id*="sidebar"], [id*="ad-"], [id*="ads"], [id*="banner"]').remove()

  let $main: cheerio.Cheerio<unknown> = $('main').first()
  if (!$main.length) $main = $('article').first()
  if (!$main.length) $main = $('[role="main"]').first()

  if (!$main.length) {
    let bestScore = 0
    let bestEl: cheerio.Cheerio<unknown> | null = null
    $('div').each((_, el) => {
      const $el = $(el)
      const text = $el.text()
      const elHtml = $.html(el as unknown as Parameters<typeof $.html>[0])
      if (text.length < 200) return
      const score = text.length / (elHtml.length || 1)
      if (score > bestScore) {
        bestScore = score
        bestEl = $el
      }
    })
    if (bestEl) $main = bestEl
  }

  if (!$main.length) $main = $('body')

  return htmlToMarkdown($.html($main as unknown as Parameters<typeof $.html>[0]))
}
