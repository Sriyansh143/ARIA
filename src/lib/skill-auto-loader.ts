// skill-auto-loader.ts — Scans the /skills directory (project root),
// discovers every ClawHub-style skill by parsing each skill's SKILL.md
// frontmatter, and registers them in the Prisma `Skill` table. Idempotent:
// re-running updates existing rows in place rather than duplicating.
//
// Each skill folder is expected to contain a `SKILL.md` file with YAML
// frontmatter of at least:
//   ---
//   name: <skill-name>
//   description: <one-line description>
//   ---

import { readdirSync, readFileSync, statSync, existsSync } from 'fs'
import { join } from 'path'
import { db } from '@/lib/db'
import { logger } from '@/lib/logger'

const SKILLS_DIR = join(process.cwd(), 'skills')

export interface DiscoveredSkill {
  /** Folder name (kebab-case) — used as the unique key */
  id: string
  name: string
  description: string
  category: string
  hasScripts: boolean
  hasSetup: boolean
  path: string
  /** Raw frontmatter object (best-effort parse) */
  meta: Record<string, unknown>
}

// ── Minimal YAML frontmatter parser ───────────────────────────────────
function parseFrontmatter(raw: string): Record<string, unknown> {
  const m = raw.match(/^---\s*\n([\s\S]*?)\n---/)
  if (!m) return {}
  const body = m[1]
  const out: Record<string, unknown> = {}
  let i = 0
  const lines = body.split('\n')
  while (i < lines.length) {
    const line = lines[i]
    const kvMatch = line.match(/^([a-zA-Z_][a-zA-Z0-9_-]*):\s*(.*)$/)
    if (!kvMatch) { i++; continue }
    const key = kvMatch[1]
    let value = kvMatch[2].trim()
    if (value === '>' || value === '|') {
      const collected: string[] = []
      i++
      while (i < lines.length && /^\s+/.test(lines[i])) {
        collected.push(lines[i].replace(/^\s+/, ''))
        i++
      }
      out[key] = collected.join(' ').trim()
      continue
    }
    if (value === '' && lines[i + 1] && /^\s+/.test(lines[i + 1])) {
      const nested: Record<string, unknown> = {}
      i++
      while (i < lines.length && /^\s+/.test(lines[i])) {
        const nk = lines[i].match(/^\s+([a-zA-Z_][a-zA-Z0-9_-]*):\s*(.*)$/)
        if (nk) nested[nk[1]] = stripQuotes(nk[2].trim())
        i++
      }
      out[key] = nested
      continue
    }
    out[key] = stripQuotes(value)
    i++
  }
  return out
}

function stripQuotes(s: string): string {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1)
  }
  return s
}

// ── Category inference ────────────────────────────────────────────────
const CATEGORY_RULES: Array<{ pattern: RegExp; category: string }> = [
  { pattern: /browser|agent-browser|web-reader|web-search|multi-search|screen/i, category: 'media' },
  { pattern: /xlsx|pdf|docx|pptx|cheat-sheet|writing|blog|seo|content|storyboard|quiz|study|resume|jd|job|interview|gift|dream|mindfulness|fortune|anti-pua|writing-plans|podcast/i, category: 'media' },
  { pattern: /coding|fullstack|version|ui-ux|design|visual-design|charts/i, category: 'code' },
  { pattern: /image|video|charts|pptx|pdf/i, category: 'media' },
  { pattern: /stock|finance|market-research|gaokao|aminer|academic/i, category: 'data' },
  { pattern: /ASR|TTS|VLM|LLM|image-understand|video-understand|image-search|image-edit|image-generation|video-generation/i, category: 'media' },
]
function inferCategory(name: string): string {
  for (const rule of CATEGORY_RULES) if (rule.pattern.test(name)) return rule.category
  return 'general'
}

// ── discoverSkills() ──────────────────────────────────────────────────
export function discoverSkills(): DiscoveredSkill[] {
  if (!existsSync(SKILLS_DIR)) return []
  const out: DiscoveredSkill[] = []
  let entries: string[] = []
  try {
    entries = readdirSync(SKILLS_DIR)
  } catch {
    return []
  }
  for (const entry of entries) {
    const skillPath = join(SKILLS_DIR, entry)
    let isDir = false
    try {
      isDir = statSync(skillPath).isDirectory()
    } catch {
      continue
    }
    if (!isDir) continue
    const skillMdPath = join(skillPath, 'SKILL.md')
    if (!existsSync(skillMdPath)) continue
    let raw = ''
    try {
      raw = readFileSync(skillMdPath, 'utf8')
    } catch {
      continue
    }
    const meta = parseFrontmatter(raw)
    const name = String(meta.name || entry)
    const description = String(meta.description || '')
    const hasScripts = existsSync(join(skillPath, 'scripts'))
    const hasSetup = existsSync(join(skillPath, 'setup.sh'))
    out.push({
      id: entry,
      name,
      description: description.slice(0, 500),
      category: inferCategory(entry),
      hasScripts,
      hasSetup,
      path: skillPath,
      meta,
    })
  }
  return out
}

// ── autoLoadSkills() ──────────────────────────────────────────────────
export interface AutoLoadResult {
  discovered: number
  created: number
  updated: number
  unchanged: number
  failed: number
  errors: string[]
  skills: Array<{ id: string; name: string; category: string; action: 'created' | 'updated' | 'unchanged' | 'failed' }>
}

export async function autoLoadSkills(): Promise<AutoLoadResult> {
  const result: AutoLoadResult = {
    discovered: 0, created: 0, updated: 0, unchanged: 0, failed: 0,
    errors: [], skills: [],
  }
  const discovered = discoverSkills()
  result.discovered = discovered.length

  for (const skill of discovered) {
    try {
      const existing = await db.skill.findUnique({ where: { key: skill.id } })
      const config = JSON.stringify({ path: skill.path, hasScripts: skill.hasScripts, displayName: skill.name })
      if (!existing) {
        await db.skill.create({
          data: {
            key: skill.id,
            name: skill.name,
            description: skill.description,
            category: skill.category,
            enabled: false,
            config,
          },
        })
        result.created++
        result.skills.push({ id: skill.id, name: skill.name, category: skill.category, action: 'created' })
      } else {
        const needsUpdate =
          existing.description !== skill.description ||
          existing.category !== skill.category
        if (needsUpdate) {
          await db.skill.update({
            where: { key: skill.id },
            data: {
              description: skill.description,
              category: skill.category,
              config,
            },
          })
          result.updated++
          result.skills.push({ id: skill.id, name: skill.name, category: skill.category, action: 'updated' })
        } else {
          result.unchanged++
          result.skills.push({ id: skill.id, name: skill.name, category: skill.category, action: 'unchanged' })
        }
      }
    } catch (err) {
      result.failed++
      const msg = err instanceof Error ? err.message : String(err)
      result.errors.push(`${skill.id}: ${msg}`)
      result.skills.push({ id: skill.id, name: skill.name, category: skill.category, action: 'failed' })
      logger.warn({ err: msg, skillId: skill.id }, 'skill-auto-loader: failed to upsert skill')
    }
  }
  return result
}
