/**
 * LobeChat-inspired Skill manifest schema.
 * Adopted from https://github.com/lobehub/lobe-chat plugin manifest format.
 */

export interface SkillManifestUIField {
  name: string
  type: 'string' | 'number' | 'boolean' | 'select'
  label: string
  description?: string
  default?: string | number | boolean
  options?: string[] // for select type
  required?: boolean
}

export interface SkillManifestAPI {
  name: string
  description: string
  parameters: Record<string, { type: string; description: string; required?: boolean }>
}

export interface SkillManifest {
  /** Unique identifier, kebab-case */
  identifier: string
  /** Metadata for the marketplace UI */
  meta: {
    title: string
    description: string
    author?: string
    tags?: string[]
    icon?: string // emoji or URL
    version?: string
    homepage?: string
  }
  /** Skill type */
  type: 'default' | 'standalone' | 'builtin'
  /** System prompt injected when this skill is active */
  systemRole?: string
  /** API functions the skill exposes (for tool-use models) */
  api?: SkillManifestAPI[]
  /** Config form fields (rendered via RJSF-style generator) */
  ui?: SkillManifestUIField[]
  /** Auto-execute on activation (default false) */
  autoExecute?: boolean
}

/** Validate a parsed JSON object against the manifest schema. Returns {valid, errors}. */
export function validateManifest(obj: any): { valid: boolean; errors: string[] } {
  const errors: string[] = []
  if (!obj || typeof obj !== 'object') {
    return { valid: false, errors: ['Manifest must be a JSON object'] }
  }
  if (!obj.identifier || typeof obj.identifier !== 'string') {
    errors.push('identifier is required and must be a string')
  } else if (!/^[a-z0-9-]+$/.test(obj.identifier)) {
    errors.push('identifier must be kebab-case (lowercase, digits, hyphens only)')
  }
  if (!obj.meta || typeof obj.meta !== 'object') {
    errors.push('meta is required')
  } else {
    if (!obj.meta.title) errors.push('meta.title is required')
    if (!obj.meta.description) errors.push('meta.description is required')
  }
  if (obj.type && !['default', 'standalone', 'builtin'].includes(obj.type)) {
    errors.push(`type must be one of: default, standalone, builtin`)
  }
  if (obj.systemRole && typeof obj.systemRole !== 'string') {
    errors.push('systemRole must be a string')
  }
  if (obj.api && !Array.isArray(obj.api)) {
    errors.push('api must be an array')
  }
  if (obj.ui && !Array.isArray(obj.ui)) {
    errors.push('ui must be an array')
  }
  if (obj.autoExecute !== undefined && typeof obj.autoExecute !== 'boolean') {
    errors.push('autoExecute must be a boolean')
  }
  return { valid: errors.length === 0, errors }
}

/** Parse a manifest from a JSON string. Returns {manifest, errors}. */
export function parseManifest(jsonStr: string): { manifest?: SkillManifest; errors: string[] } {
  try {
    const obj = JSON.parse(jsonStr)
    const { valid, errors } = validateManifest(obj)
    if (!valid) return { errors }
    return { manifest: obj as SkillManifest, errors: [] }
  } catch (e) {
    return { errors: [`JSON parse error: ${e instanceof Error ? e.message : String(e)}`] }
  }
}

/** Generate a default config object from a manifest's ui fields. */
export function defaultConfigFromManifest(manifest: SkillManifest): Record<string, any> {
  const config: Record<string, any> = {}
  for (const field of manifest.ui || []) {
    if (field.default !== undefined) {
      config[field.name] = field.default
    }
  }
  return config
}
