import notjev from 'notjev'
import { getSetting, upsertSetting } from '../db.js'
import { getVllmBaseUrl, getVllmApiKey } from './providers/llm/vllm.js'
import {
  FORMATS,
  DEFAULT_THEMES,
  DEFAULT_FORMAT_THETA,
  DEFAULT_THEME_THETA,
  MAX_THEMES,
  normalizeClassId,
  type ClassOption,
  type ClassificationSettings,
} from '../../shared/classification.js'

/**
 * Article classification (format + theme) read out of the vLLM server as a
 * closed-choice decision: the options are shown as letters, the model answers
 * one token with logprobs, and notjev turns the letter mass into a verdict
 * plus a margin. Below the margin threshold (theta) the answer is null:
 * undecided, never a guess.
 */

const KEYS = {
  enabled: 'classify.enabled',
  model: 'classify.model',
  formatTheta: 'classify.format_theta',
  themeTheta: 'classify.theme_theta',
  themes: 'classify.themes',
} as const

/** Characters of body the model reads after the title */
const BODY_CHARS = 1500

function parseTheta(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === '') return fallback
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : fallback
}

/** Validate a theme list: ids normalized and unique, 1..MAX_THEMES entries. */
export function sanitizeThemes(input: unknown): ClassOption[] | null {
  if (!Array.isArray(input)) return null
  const seen = new Set<string>()
  const themes: ClassOption[] = []
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') return null
    const r = raw as Record<string, unknown>
    const label = typeof r.label === 'string' ? r.label.trim() : ''
    const id = normalizeClassId(typeof r.id === 'string' && r.id.trim() ? r.id : label)
    if (!id || seen.has(id)) return null
    seen.add(id)
    const description = typeof r.description === 'string' ? r.description.trim() : ''
    themes.push({ id, label: label || id, description })
  }
  if (themes.length === 0 || themes.length > MAX_THEMES) return null
  return themes
}

export function getThemes(): ClassOption[] {
  const raw = getSetting(KEYS.themes)
  if (!raw) return DEFAULT_THEMES
  try {
    return sanitizeThemes(JSON.parse(raw)) ?? DEFAULT_THEMES
  } catch {
    return DEFAULT_THEMES
  }
}

export function getClassificationSettings(): ClassificationSettings {
  return {
    enabled: getSetting(KEYS.enabled) === 'on',
    model: getSetting(KEYS.model) || '',
    formatTheta: parseTheta(getSetting(KEYS.formatTheta), DEFAULT_FORMAT_THETA),
    themeTheta: parseTheta(getSetting(KEYS.themeTheta), DEFAULT_THEME_THETA),
    themes: getThemes(),
  }
}

export function isClassificationEnabled(): boolean {
  return getSetting(KEYS.enabled) === 'on'
}

export function saveClassificationSettings(patch: Partial<ClassificationSettings>): void {
  if (patch.enabled !== undefined) upsertSetting(KEYS.enabled, patch.enabled ? 'on' : 'off')
  if (patch.model !== undefined) upsertSetting(KEYS.model, patch.model.trim())
  if (patch.formatTheta !== undefined) upsertSetting(KEYS.formatTheta, String(patch.formatTheta))
  if (patch.themeTheta !== undefined) upsertSetting(KEYS.themeTheta, String(patch.themeTheta))
  if (patch.themes !== undefined) upsertSetting(KEYS.themes, JSON.stringify(patch.themes))
}

function resolveModel(settings: ClassificationSettings): string {
  return settings.model || getSetting('summary.model') || ''
}

export interface ClassifyInput {
  title: string
  feedName?: string | null
  body?: string | null
}

export interface ClassifyResult {
  format: string | null
  theme: string | null
  formatP1: number
  themeP1: number
  /** The model's top guess, even when undecided */
  formatTop: string
  themeTop: string
  model: string
  ms: number
}

export function buildClassifyState(input: ClassifyInput): string {
  const body = (input.body ?? '').replace(/\s+/g, ' ').trim().slice(0, BODY_CHARS)
  return `Title: ${input.title}\nSource: ${input.feedName ?? 'unknown'}\n\n${body}\n`
}

function toOptions(list: ClassOption[]) {
  return list.map(o => ({ id: o.id, description: o.description || o.label }))
}

/**
 * Ask the two questions (format, theme) about one article. Throws on a
 * network or server error so the queue can retry later; an undecided answer
 * is a normal result with a null field.
 */
export async function classifyArticle(input: ClassifyInput): Promise<ClassifyResult> {
  const settings = getClassificationSettings()
  const model = resolveModel(settings)
  if (!model) throw new Error('No model configured for classification')
  const client = notjev.createClient({
    baseUrl: getVllmBaseUrl(),
    apiKey: getVllmApiKey() || undefined,
    model,
  })
  const state = buildClassifyState(input)
  // Sequential on purpose: the second request reuses the server's prefix
  // cache for the shared article text
  const format = await client.decide({
    state,
    question: 'What is the format of this article?',
    options: toOptions(FORMATS),
    theta: settings.formatTheta,
  })
  const theme = await client.decide({
    state,
    question: 'What is the main theme of this article?',
    options: toOptions(settings.themes),
    theta: settings.themeTheta,
  })
  if (format.degraded && theme.degraded) {
    // No option letter at all: the server returned no logprobs, or the model
    // answered something else entirely. Treat as a failure, not "undecided".
    throw new Error('Classification degraded: the server returned no usable logprobs')
  }
  return {
    format: format.choice,
    theme: theme.choice,
    formatP1: format.p1,
    themeP1: theme.p1,
    formatTop: format.top,
    themeTop: theme.top,
    model,
    ms: (format.ms ?? 0) + (theme.ms ?? 0),
  }
}
