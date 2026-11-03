/** Shared shapes of the notjev accuracy bench (results.jsonl, sample.json, progress.json) */

export type BenchQuestion = 'format' | 'theme' | 'importance'
export const QUESTIONS: BenchQuestion[] = ['format', 'theme', 'importance']

/** production: as classify.ts · shuffled: options permuted · reasoned: thinking-on reference */
export type BenchReading = 'production' | 'shuffled' | 'reasoned'
export const READINGS: BenchReading[] = ['production', 'shuffled', 'reasoned']

export const CALLS_PER_ARTICLE = QUESTIONS.length * READINGS.length

export function recordKey(articleId: number, reading: BenchReading, question: BenchQuestion): string {
  return `${articleId}|${reading}|${question}`
}

interface RecordBase {
  key: string
  articleId: number
  question: BenchQuestion
  /** The question line sent (importance: built from the reader context) */
  questionText: string
  /** Option ids in the order they were shown (letters A, B, C… follow this order) */
  options: string[]
  /** The exact request body */
  request: Record<string, unknown>
  ms: number
  at: string
}

/** One-token readout (production or shuffled) */
export interface DecideRecord extends RecordBase {
  reading: 'production' | 'shuffled'
  theta: number
  /** The server response as parsed: re-read offline by notjev's readResponse */
  resp: unknown
  choice: string | null
  top: string
  p1: number
  p2: number
  margin: number
  band: string
  coverage: number
  degraded: boolean
  undecided: boolean
  letters: string[]
  probabilities: number[]
}

export type ReasonedStatus = 'ok' | 'unreadable' | 'truncated'

/** Reasoned reference: same prompt, thinking on, final letter parsed from the text */
export interface ReasonedRecord extends RecordBase {
  reading: 'reasoned'
  status: ReasonedStatus
  letter: string | null
  choice: string | null
  content: string
  reasoning: string | null
  finishReason: string | null
  usage: unknown
}

export type BenchRecord = DecideRecord | ReasonedRecord

export type Label = 'positive' | 'negative' | 'conflict'

export interface ArticleMeta {
  id: number
  title: string
  feed: string | null
  url: string
  excerpt: string
  stored: { format: string | null; theme: string | null; importance: string | null; classifiedAt: string | null }
  label: Label | null
  labelSources: string[]
}

export interface ReadSettings {
  vllmBaseUrl: string
  baseUrlSetting: string | null
  classifyModel: string | null
  summaryModel: string | null
  model: string
  apiKeyPresent: boolean
  formatTheta: number
  themeTheta: number
  importanceTheta: number
  themes: { id: string; label: string; description: string }[]
}

export interface SampleFile {
  createdAt: string
  seed: number
  trial: boolean
  requested: number
  settings: ReadSettings
  articles: ArticleMeta[]
  counts: {
    labeledAvailable: number
    labeledUsed: number
    excludedAsInjectedExamples: number
    injectedTitles: number
    complementPool: number
    complementUsed: number
  }
}

export type ProgressStatus = 'running' | 'done' | 'error' | 'stopped'

export interface ProgressFile {
  status: ProgressStatus
  phase: 'snapshot' | 'sample' | 'calls' | 'report'
  message: string
  trial: boolean
  articlesTotal: number
  callsTotal: number
  callsDone: number
  errors: number
  startedAt: string
  updatedAt: string
  finishedAt: string | null
  pid: number
}

/** Verdict on one disagreement, keyed `${articleId}|${question}` */
export type Arbitration = 'notjev' | 'reference' | 'neither'

export interface ArbitrationFile {
  version: 1
  run: string
  items: Record<string, Arbitration>
}
