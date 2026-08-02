import { franc } from 'franc-min'
import { getSetting } from '../db.js'
import { getProvider } from '../providers/llm/index.js'
import { googleTranslate } from '../providers/translate/google-translate.js'
import { deeplTranslate } from '../providers/translate/deepl.js'
import { TASK_DEFAULTS } from '../../shared/models.js'
import { DEFAULT_LANGUAGE, languageName } from '../../shared/lang.js'

const MIN_DETECT_LENGTH = 10
const DETECT_SAMPLE_LENGTH = 1000

/** ISO 639-3 (franc) → ISO 639-1 */
const ISO639_3_TO_1: Record<string, string> = {
  ara: 'ar', bul: 'bg', ces: 'cs', dan: 'da', deu: 'de', ell: 'el', eng: 'en',
  spa: 'es', est: 'et', fin: 'fi', fra: 'fr', heb: 'he', hin: 'hi', hrv: 'hr',
  hun: 'hu', ind: 'id', ita: 'it', jpn: 'ja', kor: 'ko', lit: 'lt', lav: 'lv',
  nld: 'nl', nor: 'no', pol: 'pl', por: 'pt', ron: 'ro', rus: 'ru', slk: 'sk',
  slv: 'sl', swe: 'sv', tur: 'tr', ukr: 'uk', vie: 'vi', zho: 'zh', cmn: 'zh',
}

const detectCache = new Map<string, string>()

export type AiBillingMode = 'anthropic' | 'gemini' | 'openai' | 'claude-code' | 'ollama' | 'vllm' | 'google-translate' | 'deepl'

export interface AiTextResult {
  inputTokens: number
  outputTokens: number
  billingMode: AiBillingMode
  model: string
  monthlyChars?: number
}

function mapIso639_3(code: string): string {
  return ISO639_3_TO_1[code] ?? code
}

export function detectLanguage(fullText: string): string {
  const trimmed = fullText.trim()
  if (!trimmed || trimmed.length < MIN_DETECT_LENGTH) return 'unknown'

  const sample = trimmed.slice(0, DETECT_SAMPLE_LENGTH)
  const cached = detectCache.get(sample)
  if (cached) return cached

  const iso3 = franc(sample)
  const lang = iso3 === 'und' ? 'unknown' : mapIso639_3(iso3)
  detectCache.set(sample, lang)
  return lang
}

/** @internal test helper */
export function _clearDetectLanguageCache(): void {
  detectCache.clear()
}


function buildSummarizePrompt(fullText: string): string {
  const lang = getSetting('general.language') || DEFAULT_LANGUAGE
  return `Summarize the following article in ${languageName(lang)}. Follow the format strictly.

## Format
Line 1: A concise 1-2 sentence summary of the article's main point (what the article is about and the author's key argument or conclusion)
Line 2: Empty line
Line 3+: Key points as bullet points. Each item should follow the format "**Point title** — supplementary explanation" (only the title in bold)

## Rules
- Each bullet point must faithfully reflect the article's arguments, claims, or facts
- Maintain the order of the article's flow
- Minimize the number of points (3-4 is ideal). Only add more if the content is truly wide-ranging, but never exceed 7
- Output in Markdown (bullet points start with "- ")
- Do not include any text other than the summary (no headings, preambles, or notes)

--- Article body ---
${fullText}`
}

function buildTranslatePrompt(fullText: string): string {
  const lang = getSetting('translate.target_lang') || getSetting('general.language') || DEFAULT_LANGUAGE
  const targetLang = languageName(lang)
  return `Translate the following article into ${targetLang}.
Translate every word faithfully — do not summarize, compress, or omit anything.
The translation must be 1:1 with the original text in volume.
Preserve Markdown formatting. In particular, keep blockquote lines starting with ">".

--- Article body ---
${fullText}`
}

interface AiTaskConfig {
  providerKey: string
  modelKey: string
  defaultModel: string
  maxTokensKey: string
  defaultMaxTokens: number
  buildPrompt: (text: string) => string
}

/**
 * Resolve the max output tokens for an AI task. A positive integer stored in
 * settings overrides the built-in default; anything else (unset, empty,
 * malformed) falls back. Lets users with local LLMs (vLLM, Ollama) whose
 * context window is smaller than the defaults lower the completion cap.
 */
function resolveMaxTokens(config: AiTaskConfig): number {
  const raw = getSetting(config.maxTokensKey)
  if (!raw) return config.defaultMaxTokens
  const parsed = Number(raw)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : config.defaultMaxTokens
}

async function runAiTask(
  config: AiTaskConfig,
  fullText: string,
  onText?: (delta: string) => void,
  providerOverride?: string,
): Promise<{ text: string } & AiTextResult> {
  const providerName = providerOverride || getSetting(config.providerKey) || TASK_DEFAULTS.summarize.provider
  const model = getSetting(config.modelKey) || config.defaultModel
  const provider = getProvider(providerName)
  provider.requireKey()
  const prompt = config.buildPrompt(fullText)
  const maxTokens = resolveMaxTokens(config)
  const result = onText
    ? await provider.streamMessage(
        { model, maxTokens, messages: [{ role: 'user', content: prompt }] },
        onText,
      )
    : await provider.createMessage({
        model,
        maxTokens,
        messages: [{ role: 'user', content: prompt }],
      })
  return {
    // Strip a leading <think>…</think> block that some local reasoning models
    // emit inline, so only the actual answer is stored
    text: result.text.replace(/^\s*<think>[\s\S]*?<\/think>\s*/, ''),
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    billingMode: providerName as AiBillingMode,
    model,
  }
}

const SUMMARIZE_MAX_TOKENS = 2048
const TRANSLATE_MAX_TOKENS = 16384

const summarizeConfig: AiTaskConfig = {
  providerKey: 'summary.provider',
  modelKey: 'summary.model',
  defaultModel: TASK_DEFAULTS.summarize.model,
  maxTokensKey: 'summary.max_tokens',
  defaultMaxTokens: SUMMARIZE_MAX_TOKENS,
  buildPrompt: buildSummarizePrompt,
}

const translateConfig: AiTaskConfig = {
  providerKey: 'translate.provider',
  modelKey: 'translate.model',
  defaultModel: TASK_DEFAULTS.translate.model,
  maxTokensKey: 'translate.max_tokens',
  defaultMaxTokens: TRANSLATE_MAX_TOKENS,
  buildPrompt: buildTranslatePrompt,
}

const TITLE_MAX_TOKENS = 256

function buildTranslateTitlePrompt(title: string): string {
  const lang = getSetting('translate.target_lang') || getSetting('general.language') || DEFAULT_LANGUAGE
  return `Translate the following article title into ${languageName(lang)}. Output only the translated title, nothing else.

${title}`
}

const translateTitleConfig: AiTaskConfig = {
  providerKey: 'translate.provider',
  modelKey: 'translate.model',
  defaultModel: TASK_DEFAULTS.translate.model,
  maxTokensKey: 'translate.title_max_tokens',
  defaultMaxTokens: TITLE_MAX_TOKENS,
  buildPrompt: buildTranslateTitlePrompt,
}

/** Remove wrapping quotes a model may add around a translated title. */
function unquoteTitle(text: string): string {
  const trimmed = text.trim()
  const pairs: Array<[string, string]> = [['"', '"'], ['«', '»'], ['“', '”'], ['「', '」']]
  for (const [open, close] of pairs) {
    if (trimmed.startsWith(open) && trimmed.endsWith(close) && trimmed.length > open.length + close.length) {
      return trimmed.slice(open.length, -close.length).trim()
    }
  }
  return trimmed
}

export async function translateTitle(
  title: string,
  options?: { provider?: string },
): Promise<{ titleTranslated: string } & AiTextResult> {
  const provider = options?.provider || getSetting('translate.provider') || TASK_DEFAULTS.translate.provider
  if (!options?.provider) {
    if (provider === 'google-translate') {
      const r = await runGoogleTranslate(title)
      return { titleTranslated: unquoteTitle(r.fullTextTranslated), inputTokens: r.inputTokens, outputTokens: r.outputTokens, billingMode: r.billingMode, model: r.model, monthlyChars: r.monthlyChars }
    }
    if (provider === 'deepl') {
      const r = await runDeepl(title)
      return { titleTranslated: unquoteTitle(r.fullTextTranslated), inputTokens: r.inputTokens, outputTokens: r.outputTokens, billingMode: r.billingMode, model: r.model, monthlyChars: r.monthlyChars }
    }
  }
  const r = await runAiTask(translateTitleConfig, title, undefined, options?.provider)
  return { titleTranslated: unquoteTitle(r.text), inputTokens: r.inputTokens, outputTokens: r.outputTokens, billingMode: r.billingMode, model: r.model }
}

export async function summarizeArticle(
  fullText: string,
  options?: { provider?: string },
): Promise<{ summary: string } & AiTextResult> {
  const r = await runAiTask(summarizeConfig, fullText, undefined, options?.provider)
  return { summary: r.text, inputTokens: r.inputTokens, outputTokens: r.outputTokens, billingMode: r.billingMode, model: r.model }
}

export async function streamSummarizeArticle(
  fullText: string,
  onText: (delta: string) => void,
): Promise<{ summary: string } & AiTextResult> {
  const r = await runAiTask(summarizeConfig, fullText, onText)
  return { summary: r.text, inputTokens: r.inputTokens, outputTokens: r.outputTokens, billingMode: r.billingMode, model: r.model }
}

export async function translateArticle(
  fullText: string,
  options?: { provider?: string },
): Promise<{ fullTextTranslated: string } & AiTextResult> {
  const provider = options?.provider || getSetting('translate.provider') || TASK_DEFAULTS.translate.provider
  if (!options?.provider) {
    if (provider === 'google-translate') {
      return runGoogleTranslate(fullText)
    }
    if (provider === 'deepl') {
      return runDeepl(fullText)
    }
  }
  const r = await runAiTask(translateConfig, fullText, undefined, options?.provider)
  return { fullTextTranslated: r.text, inputTokens: r.inputTokens, outputTokens: r.outputTokens, billingMode: r.billingMode, model: r.model }
}

export async function streamTranslateArticle(
  fullText: string,
  onText: (delta: string) => void,
): Promise<{ fullTextTranslated: string } & AiTextResult> {
  const provider = getSetting('translate.provider') || TASK_DEFAULTS.translate.provider
  if (provider === 'google-translate') {
    const result = await runGoogleTranslate(fullText)
    onText(result.fullTextTranslated)
    return result
  }
  if (provider === 'deepl') {
    const result = await runDeepl(fullText)
    onText(result.fullTextTranslated)
    return result
  }
  const r = await runAiTask(translateConfig, fullText, onText)
  return { fullTextTranslated: r.text, inputTokens: r.inputTokens, outputTokens: r.outputTokens, billingMode: r.billingMode, model: r.model }
}

function getTargetLang(): string {
  return getSetting('translate.target_lang') || getSetting('general.language') || DEFAULT_LANGUAGE
}

async function runGoogleTranslate(fullText: string): Promise<{ fullTextTranslated: string } & AiTextResult> {
  const result = await googleTranslate(fullText, getTargetLang())
  return {
    fullTextTranslated: result.translatedText,
    inputTokens: result.characters,
    outputTokens: result.translatedText.length,
    billingMode: 'google-translate',
    model: 'google-translate-v2',
    monthlyChars: result.monthlyChars,
  }
}

async function runDeepl(fullText: string): Promise<{ fullTextTranslated: string } & AiTextResult> {
  const result = await deeplTranslate(fullText, getTargetLang())
  return {
    fullTextTranslated: result.translatedText,
    inputTokens: result.characters,
    outputTokens: result.translatedText.length,
    billingMode: 'deepl',
    model: 'deepl-v2',
    monthlyChars: result.monthlyChars,
  }
}
