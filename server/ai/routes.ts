import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { z } from 'zod'
import { startSSE } from '../lib/sse.js'
import {
  getArticleById,
  updateArticleContent,
  updateScore,
  type ArticleDetail,
} from '../db.js'
import { requireJson } from '../auth/index.js'
import { summarizeArticle, translateArticle, streamSummarizeArticle, streamTranslateArticle } from './tasks.js'
import type { AiTextResult } from './tasks.js'
import { translateArticleTitle } from './queue.js'
import { getSetting } from '../db/settings.js'
import { DEFAULT_LANGUAGE } from '../../shared/lang.js'
import { NumericIdParams } from '../lib/validation.js'

export function getTranslateTargetLang(): string {
  return getSetting('translate.target_lang') || getSetting('general.language') || DEFAULT_LANGUAGE
}

const StreamQuery = z.object({ stream: z.string().optional() })

// --- Known error codes that the frontend can i18n-translate ---

const KNOWN_ERROR_CODES = new Set([
  'ANTHROPIC_KEY_NOT_SET',
  'GEMINI_KEY_NOT_SET',
  'OPENAI_KEY_NOT_SET',
  'GOOGLE_TRANSLATE_KEY_NOT_SET',
  'DEEPL_KEY_NOT_SET',
  'SUMMARIZATION_FAILED',
  'TRANSLATION_FAILED',
])

function extractKnownErrorCode(err: unknown): string | null {
  if (err instanceof Error) {
    if (KNOWN_ERROR_CODES.has(err.message)) return err.message
    const code = (err as Error & { code?: string }).code
    if (code && KNOWN_ERROR_CODES.has(code)) return code
  }
  return null
}

// --- Shared AI handler for summarize/translate ---

interface AiHandlerConfig {
  getCached: (article: ArticleDetail) => string | null
  validate?: (article: ArticleDetail) => string | null
  streamFn: (fullText: string, onDelta: (d: string) => void) => Promise<{ text: string } & AiTextResult>
  nonStreamFn: (fullText: string) => Promise<{ text: string } & AiTextResult>
  applyResult: (articleId: number, text: string) => void
  errorMessage: string
  errorCode: string
}

function createAiHandler(config: AiHandlerConfig) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const params = NumericIdParams.parse(request.params)
    const article = getArticleById(params.id)
    if (!article) {
      reply.status(404).send({ error: 'Article not found' })
      return
    }

    const cached = config.getCached(article)
    if (cached) {
      reply.send({ text: cached, cached: true })
      return
    }

    if (!article.full_text) {
      reply.status(400).send({ error: 'No full text available' })
      return
    }

    const validationError = config.validate?.(article)
    if (validationError) {
      reply.status(400).send({ error: validationError })
      return
    }

    const { stream } = StreamQuery.parse(request.query)

    try {
      if (stream === '1') {
        const sse = startSSE(reply)
        const result = await config.streamFn(
          article.full_text,
          (delta) => { sse.send({ type: 'delta', text: delta }) },
        )
        // An empty result is a provider failure (e.g. wrong vLLM model name,
        // reasoning-only output) — surface it instead of storing nothing
        if (!result.text.trim()) throw new Error(config.errorCode)
        config.applyResult(article.id, result.text)
        const usage = formatUsage(result)
        sse.send({ type: 'done', usage })
        sse.end()
      } else {
        const result = await config.nonStreamFn(article.full_text)
        if (!result.text.trim()) throw new Error(config.errorCode)
        config.applyResult(article.id, result.text)
        reply.send({ text: result.text, usage: formatUsage(result) })
      }
    } catch (err) {
      request.log.error(err, config.errorMessage)
      const errorCode = extractKnownErrorCode(err)
      const errorMsg = errorCode ?? config.errorCode
      if (reply.raw.headersSent) {
        reply.raw.write(`data: ${JSON.stringify({ type: 'error', error: errorMsg })}\n\n`)
        reply.raw.end()
      } else {
        reply.status(500).send({ error: errorMsg })
      }
    }
  }
}

function formatUsage(result: AiTextResult) {
  return {
    input_tokens: result.inputTokens,
    output_tokens: result.outputTokens,
    billing_mode: result.billingMode,
    model: result.model,
    ...(result.monthlyChars != null ? { monthly_chars: result.monthlyChars } : {}),
  }
}

export async function aiArticleRoutes(api: FastifyInstance): Promise<void> {
  api.post(
    '/api/articles/:id/summarize',
    { preHandler: [requireJson] },
    createAiHandler({
      getCached: (article) => article.summary,
      streamFn: async (fullText, onDelta) => {
        const r = await streamSummarizeArticle(fullText, onDelta)
        return { text: r.summary, ...r }
      },
      nonStreamFn: async (fullText) => {
        const r = await summarizeArticle(fullText)
        return { text: r.summary, ...r }
      },
      applyResult: (articleId, text) => {
        updateArticleContent(articleId, { summary: text })
      },
      errorMessage: 'Summarization failed',
      errorCode: 'SUMMARIZATION_FAILED',
    }),
  )

  api.post(
    '/api/articles/:id/translate',
    { preHandler: [requireJson] },
    createAiHandler({
      getCached: (article) => {
        const userLang = getTranslateTargetLang()
        return article.translated_lang === userLang ? article.full_text_translated : null
      },
      validate: (article) => {
        const userLang = getTranslateTargetLang()
        return article.lang === userLang ? `Article is already in ${userLang}` : null
      },
      streamFn: async (fullText, onDelta) => {
        const r = await streamTranslateArticle(fullText, onDelta)
        return { text: r.fullTextTranslated, ...r }
      },
      nonStreamFn: async (fullText) => {
        const r = await translateArticle(fullText)
        return { text: r.fullTextTranslated, ...r }
      },
      applyResult: (articleId, text) => {
        const userLang = getTranslateTargetLang()
        updateArticleContent(articleId, { full_text_translated: text, translated_lang: userLang })
        updateScore(articleId)
        // Best-effort: translate the title too so the list matches the reader
        translateArticleTitle(articleId)
      },
      errorMessage: 'Translation failed',
      errorCode: 'TRANSLATION_FAILED',
    }),
  )
}
