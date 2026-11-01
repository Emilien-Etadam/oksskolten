import { getSetting, markArticlesSeen } from '../db.js'
import { getProvider } from '../ai/providers/llm/index.js'
import { getClassificationSettings } from '../ai/classify.js'
import { TASK_DEFAULTS } from '../../shared/models.js'
import { DEFAULT_LANGUAGE, languageName } from '../../shared/lang.js'
import { NO_THEME_KEY } from '../../shared/journal.js'
import type { JournalContent, JournalEssential, JournalSection, JournalSource } from '../../shared/journal.js'
import { logger } from '../logger.js'
import {
  createEdition,
  failEdition,
  failStaleEditions,
  finishEdition,
  getArticlesForPeriod,
  getFeedbackExamples,
  getInstructions,
  getLastPeriodEnd,
  getRunningEdition,
  nowSql,
  setSectionsDone,
  type JournalArticle,
} from './journal-db.js'

const log = logger.child('journal')

/** Articles shown to the model per theme; the rest are counted, not read */
export const MAX_ARTICLES_PER_SECTION = 40
const BODY_CHARS = 280
const SECTION_MAX_TOKENS = 1200
const ESSENTIALS_MAX_TOKENS = 600
const MAX_ESSENTIALS = 3

export interface ThemeBucket {
  theme: string
  label: string
  articles: JournalArticle[]
}

/**
 * Group articles by theme, in the reader's theme order. Articles without a
 * theme, or whose theme was removed since, go to the NO_THEME_KEY bucket,
 * last. Empty themes are dropped.
 */
export function groupByTheme(articles: JournalArticle[], themes: { id: string; label: string }[]): ThemeBucket[] {
  const known = new Map(themes.map(t => [t.id, t.label]))
  const byTheme = new Map<string, JournalArticle[]>()
  for (const article of articles) {
    const key = article.theme && known.has(article.theme) && article.theme !== 'OTHER' ? article.theme : NO_THEME_KEY
    const list = byTheme.get(key) ?? []
    list.push(article)
    byTheme.set(key, list)
  }
  const buckets: ThemeBucket[] = []
  for (const theme of themes) {
    const list = byTheme.get(theme.id)
    if (list) buckets.push({ theme: theme.id, label: theme.label, articles: list })
  }
  const rest = byTheme.get(NO_THEME_KEY)
  if (rest) buckets.push({ theme: NO_THEME_KEY, label: 'Other', articles: rest })
  return buckets
}

function oneLine(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

export function buildSectionPrompt(input: {
  label: string
  language: string
  articles: JournalArticle[]
  totalCount: number
  instruction?: string
  liked: string[]
  disliked: string[]
}): string {
  const list = input.articles.map((a, i) => {
    const body = a.body ? `\n    ${oneLine(a.body, BODY_CHARS)}` : ''
    return `[${i + 1}] ${oneLine(a.title, 200)} (${a.feed_name})${body}`
  }).join('\n')
  const skipped = input.totalCount - input.articles.length
  const lines = [
    `You write one section of a personal news digest for a single reader. The section covers the theme "${input.label}".`,
    `Write it in ${input.language}.`,
    '',
    '## Task',
    '- Tell the reader what matters among the articles below, in 1 to 3 short paragraphs of plain prose.',
    '- Merge articles about the same subject into one statement.',
    '- Cite every statement with the number of its article in square brackets, like [3] or [2][5]. Only cite numbers from the list.',
    '- Prefer concrete facts, results and first-hand experience over announcements and hype.',
    '- If nothing is noteworthy, say so in one sentence.',
    '- Output only the paragraphs: no title, no list, no preamble.',
  ]
  if (input.instruction) lines.push('', '## Reader instruction for this theme', input.instruction)
  if (input.liked.length) lines.push('', '## The reader asked for more articles like these', ...input.liked.map(t => `- ${t}`))
  if (input.disliked.length) lines.push('', '## The reader asked for fewer articles like these', ...input.disliked.map(t => `- ${t}`))
  lines.push('', `## Articles${skipped > 0 ? ` (the ${input.articles.length} most relevant of ${input.totalCount})` : ''}`, list)
  return lines.join('\n')
}

export function buildEssentialsPrompt(language: string, sections: { label: string; summary: string }[]): string {
  const text = sections.map(s => `### ${s.label}\n${s.summary}`).join('\n\n')
  return [
    `Below is a personal news digest. Pick the ${MAX_ESSENTIALS} most important points for the reader, at most.`,
    `Write each as one short sentence in ${language}, on its own line starting with "- ".`,
    'Keep the citation numbers in square brackets from the text it comes from, like [4].',
    'Output only the lines.',
    '',
    text,
  ].join('\n')
}

/**
 * Rewrite the model's local citations ([k], [k, j]) to edition-wide numbers.
 * Unknown numbers are dropped. Returns the text and the numbers used, in order.
 */
export function remapCitations(text: string, toGlobal: (local: number) => number | undefined): { text: string; refs: number[] } {
  const refs: number[] = []
  const out = text.replace(/\[(\d+(?:\s*[,;]\s*\d+)*)\]/g, (_, group: string) => {
    const nums = group.split(/[,;]/).map(s => toGlobal(Number(s.trim()))).filter((n): n is number => n !== undefined)
    for (const n of nums) if (!refs.includes(n)) refs.push(n)
    return nums.map(n => `[${n}]`).join('')
  })
  return { text: out.replace(/[ \t]+([.,;:])/g, '$1').trim(), refs }
}

function stripThinking(text: string): string {
  return text.replace(/^\s*<think>[\s\S]*?<\/think>\s*/, '').trim()
}

interface Llm {
  ask(prompt: string, maxTokens: number): Promise<string>
}

/** The summary task's provider and model; throws when the provider needs a key it lacks */
function resolveLlm(): Llm {
  const providerName = getSetting('summary.provider') || TASK_DEFAULTS.summarize.provider
  const model = getSetting('summary.model') || TASK_DEFAULTS.summarize.model
  const provider = getProvider(providerName)
  provider.requireKey()
  return {
    async ask(prompt, maxTokens) {
      const result = await provider.createMessage({ model, maxTokens, messages: [{ role: 'user', content: prompt }] })
      return stripThinking(result.text)
    },
  }
}

async function writeEdition(editionId: number, buckets: ThemeBucket[], llm: Llm): Promise<JournalContent> {
  const language = languageName(getSetting('general.language') || DEFAULT_LANGUAGE)
  const instructions = getInstructions()
  const sources: JournalSource[] = []
  const sourceByArticle = new Map<number, number>()
  const sections: JournalSection[] = []

  for (const [index, bucket] of buckets.entries()) {
    const shown = bucket.articles.slice(0, MAX_ARTICLES_PER_SECTION)
    const examples = getFeedbackExamples(bucket.theme === NO_THEME_KEY ? null : bucket.theme)
    const raw = await llm.ask(buildSectionPrompt({
      label: bucket.label,
      language,
      articles: shown,
      totalCount: bucket.articles.length,
      instruction: instructions[bucket.theme],
      liked: examples.liked,
      disliked: examples.disliked,
    }), SECTION_MAX_TOKENS)

    const { text, refs } = remapCitations(raw, local => {
      const article = shown[local - 1]
      if (!article) return undefined
      let n = sourceByArticle.get(article.id)
      if (n === undefined) {
        n = sources.length + 1
        sourceByArticle.set(article.id, n)
        sources.push({
          n,
          article_id: article.id,
          title: article.title,
          url: article.url,
          feed_name: article.feed_name,
          published_at: article.published_at,
        })
      }
      return n
    })

    sections.push({
      theme: bucket.theme,
      label: bucket.label,
      summary: text,
      article_count: bucket.articles.length,
      refs,
      article_ids: bucket.articles.map(a => a.id),
      uncited: bucket.articles
        .filter(a => !sourceByArticle.has(a.id))
        .map(a => ({ article_id: a.id, title: a.title, url: a.url, feed_name: a.feed_name })),
    })
    setSectionsDone(editionId, index + 1)
  }

  const essentials = await writeEssentials(sections, sources, language, llm)
  return { essentials, sections, sources }
}

async function writeEssentials(sections: JournalSection[], sources: JournalSource[], language: string, llm: Llm): Promise<JournalEssential[]> {
  const withContent = sections.filter(s => s.refs.length > 0)
  if (withContent.length === 0) return []
  const themeOfRef = new Map<number, string>()
  for (const section of sections) for (const n of section.refs) if (!themeOfRef.has(n)) themeOfRef.set(n, section.theme)
  try {
    const raw = await llm.ask(buildEssentialsPrompt(language, withContent), ESSENTIALS_MAX_TOKENS)
    const known = new Set(sources.map(s => s.n))
    return raw.split('\n')
      .map(line => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim())
      .filter(Boolean)
      .slice(0, MAX_ESSENTIALS)
      .map(line => {
        const { text, refs } = remapCitations(line, n => (known.has(n) ? n : undefined))
        return { text, refs, theme: themeOfRef.get(refs[0]) ?? NO_THEME_KEY }
      })
  } catch (err) {
    // The sections are what matters: an edition without its summary box is still useful
    log.warn(`essentials failed: ${err instanceof Error ? err.message : String(err)}`)
    return []
  }
}

export class JournalBusyError extends Error {
  constructor() { super('An edition is already being generated') }
}

/**
 * Start a new edition covering every article arrived since the previous one.
 * Returns null when there is nothing new. The edition is written in the
 * background; `done` settles when it is finished or failed.
 */
export function startEdition(): { id: number; done: Promise<void> } | null {
  failStaleEditions()
  if (getRunningEdition()) throw new JournalBusyError()
  const llm = resolveLlm()

  const periodStart = getLastPeriodEnd()
  const periodEnd = nowSql()
  const articles = getArticlesForPeriod(periodStart, periodEnd)
  if (articles.length === 0) return null

  const settings = getClassificationSettings()
  const buckets = groupByTheme(articles, settings.enabled ? settings.themes : [])
  const id = createEdition({ periodStart, periodEnd, articleCount: articles.length, sectionsTotal: buckets.length })

  const done = writeEdition(id, buckets, llm).then(content => {
    finishEdition(id, content)
    markArticlesSeen(articles.map(a => a.id))
    log.info(`edition ${id}: ${articles.length} articles, ${buckets.length} sections`)
  }).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err)
    log.error(`edition ${id} failed: ${message}`)
    failEdition(id, message)
  })
  return { id, done }
}
