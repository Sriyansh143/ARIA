// Vision Agent — port of Microsoft UFO's screenshot analysis pattern.
//
// Uses z-ai-web-dev-sdk's vision endpoint (glm-4.6v) to:
//   1. Analyze a screenshot of the screen
//   2. Identify clickable elements
//   3. Decide which element to interact with
//   4. Generate the action (click at x,y / type text / press key)
//
// Usage:
//   import { analyzeScreenshot, planAction } from '@/lib/vision-agent'
//   const analysis = await analyzeScreenshot(screenshotBuffer)
//   const action = await planAction(screenshotBuffer, 'Click the login button')

import { logger } from '@/lib/logger'

export interface ScreenElement {
  type: 'button' | 'input' | 'link' | 'text' | 'image' | 'menu' | 'other'
  label: string
  bbox?: { x: number; y: number; width: number; height: number }
  clickable: boolean
}

export interface ScreenshotAnalysis {
  description: string
  elements: ScreenElement[]
  activeApp?: string
  suggestedActions: string[]
}

export interface VisionAction {
  type: 'click' | 'type' | 'key' | 'scroll' | 'wait' | 'done' | 'failed'
  x?: number
  y?: number
  text?: string
  key?: string
  scrollAmount?: number
  reasoning: string
  confidence: number  // 0-1
}

// Lazy-load z-ai SDK (server-only)
let _zai: Awaited<ReturnType<typeof import('z-ai-web-dev-sdk').default.create>> | null = null
async function getZai() {
  if (!_zai) {
    const ZAI = (await import('z-ai-web-dev-sdk')).default
    _zai = await ZAI.create()
  }
  return _zai
}

function extractJsonObject(raw: string): unknown | null {
  if (!raw) return null
  try { return JSON.parse(raw) } catch { /* fall through */ }
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) {
    try { return JSON.parse(fence[1]) } catch { /* fall through */ }
  }
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start !== -1 && end > start) {
    try { return JSON.parse(raw.slice(start, end + 1)) } catch { /* fall through */ }
  }
  return null
}

/**
 * Analyze a screenshot and extract UI elements.
 */
export async function analyzeScreenshot(screenshot: Buffer): Promise<ScreenshotAnalysis> {
  const base64 = screenshot.toString('base64')
  const dataUrl = `data:image/png;base64,${base64}`

  const prompt = `Analyze this screenshot. Respond with JSON only:
{
  "description": "Brief description of what's on screen",
  "active_app": "Name of the active application/window (if identifiable)",
  "elements": [
    {
      "type": "button|input|link|text|image|menu|other",
      "label": "Visible text or aria-label",
      "clickable": true/false,
      "bbox": {"x": 0, "y": 0, "width": 100, "height": 30}
    }
  ],
  "suggested_actions": ["Possible next actions the user might take"]
}

Identify up to 10 most important elements. Estimate bounding boxes as percentages of screen dimensions (0-100).`

  try {
    const zai = await getZai()
    const response = await zai.chat.completions.createVision({
      model: 'glm-4.6v',
      messages: [
        { role: 'assistant', content: [{ type: 'text', text: 'Output only JSON, no prose.' }] },
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        },
      ],
      thinking: { type: 'disabled' },
    })
    const content = response.choices?.[0]?.message?.content ?? ''
    const parsed = extractJsonObject(content) as Partial<{
      description: string; active_app: string; elements: ScreenElement[]; suggested_actions: string[]
    }> | null
    if (parsed) {
      return {
        description: parsed.description || 'Unable to describe screen',
        activeApp: parsed.active_app,
        elements: Array.isArray(parsed.elements) ? parsed.elements : [],
        suggestedActions: Array.isArray(parsed.suggested_actions) ? parsed.suggested_actions : [],
      }
    }
    return {
      description: content || 'No response',
      elements: [],
      suggestedActions: [],
    }
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'vision-agent: analyzeScreenshot failed')
    return { description: `Analysis failed: ${err instanceof Error ? err.message : String(err)}`, elements: [], suggestedActions: [] }
  }
}

/**
 * Plan the next action to take on the screen to accomplish a goal.
 */
export async function planAction(
  screenshot: Buffer,
  goal: string,
  previousActions: VisionAction[] = [],
): Promise<VisionAction> {
  const base64 = screenshot.toString('base64')
  const dataUrl = `data:image/png;base64,${base64}`

  const previousActionsStr = previousActions.length > 0
    ? `\n\nPrevious actions taken:\n${previousActions.map((a, i) => `${i + 1}. ${a.type}: ${a.reasoning}`).join('\n')}`
    : ''

  const prompt = `Goal: ${goal}${previousActionsStr}

Look at the screenshot and decide the NEXT action to take to accomplish the goal.

Respond with JSON only:
{
  "type": "click|type|key|scroll|wait|done|failed",
  "x": 450,           // for click — pixel x coordinate (or percentage 0-100 if you can't tell exact pixels)
  "y": 320,           // for click — pixel y coordinate
  "text": "...",      // for type — text to type
  "key": "Enter",     // for key — key name (Enter, Tab, Escape, Backspace, etc.)
  "scroll_amount": -3, // for scroll — positive = down, negative = up
  "reasoning": "Why I chose this action",
  "confidence": 0.9   // 0-1, how confident you are this is the right action
}

Use "done" when the goal is accomplished. Use "failed" if you can't accomplish it.`

  try {
    const zai = await getZai()
    const response = await zai.chat.completions.createVision({
      model: 'glm-4.6v',
      messages: [
        { role: 'assistant', content: [{ type: 'text', text: 'Output only JSON, no prose.' }] },
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        },
      ],
      thinking: { type: 'disabled' },
    })
    const content = response.choices?.[0]?.message?.content ?? ''
    const parsed = extractJsonObject(content) as Partial<{
      type: string; x: number; y: number; text: string; key: string
      scroll_amount: number; reasoning: string; confidence: number
    }> | null
    if (parsed) {
      return {
        type: (parsed.type as VisionAction['type']) || 'failed',
        x: typeof parsed.x === 'number' ? parsed.x : undefined,
        y: typeof parsed.y === 'number' ? parsed.y : undefined,
        text: typeof parsed.text === 'string' ? parsed.text : undefined,
        key: typeof parsed.key === 'string' ? parsed.key : undefined,
        scrollAmount: typeof parsed.scroll_amount === 'number' ? parsed.scroll_amount : undefined,
        reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : 'No reasoning provided',
        confidence: typeof parsed.confidence === 'number' ? Math.max(0, Math.min(1, parsed.confidence)) : 0.5,
      }
    }
    return { type: 'failed', reasoning: content || 'No response', confidence: 0 }
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'vision-agent: planAction failed')
    return { type: 'failed', reasoning: `Vision call failed: ${err instanceof Error ? err.message : String(err)}`, confidence: 0 }
  }
}

/**
 * Run a multi-step vision task — takes screenshots + performs actions
 * until the goal is accomplished or maxSteps is reached.
 */
export async function runVisionTask(opts: {
  goal: string
  maxSteps?: number  // default 10, max 30
  captureScreenshot: () => Promise<Buffer | null>
  performAction: (action: VisionAction) => Promise<void>
  onStep?: (step: number, action: VisionAction, analysis: ScreenshotAnalysis) => void
}): Promise<{ accomplished: boolean; stepsTaken: number; actions: VisionAction[] }> {
  const maxSteps = Math.min(opts.maxSteps ?? 10, 30)
  const actions: VisionAction[] = []

  for (let step = 1; step <= maxSteps; step++) {
    const screenshot = await opts.captureScreenshot()
    if (!screenshot) {
      logger.warn({ step }, 'vision-agent: failed to capture screenshot')
      break
    }

    const analysis = await analyzeScreenshot(screenshot)
    const action = await planAction(screenshot, opts.goal, actions)

    actions.push(action)
    opts.onStep?.(step, action, analysis)

    if (action.type === 'done') {
      return { accomplished: true, stepsTaken: step, actions }
    }
    if (action.type === 'failed') {
      logger.warn({ step, reasoning: action.reasoning }, 'vision-agent: action failed')
      return { accomplished: false, stepsTaken: step, actions }
    }

    await opts.performAction(action)
    await new Promise(r => setTimeout(r, 1000))
  }

  return { accomplished: false, stepsTaken: maxSteps, actions }
}

/**
 * Check if a model supports vision (image input).
 * In this build, only glm-4.6v is configured for vision.
 */
export function isVisionCapableModel(model: string): boolean {
  const m = model.toLowerCase()
  return m.includes('glm-4.6v') || m.includes('vision') || m.includes('vl') || m.includes('llava')
}
