import { insertArticle, updateArticleContent } from '../db.js'
import { MIN_EXTRACTED_LENGTH } from '../fetcher/content.js'
import { logger } from '../logger.js'
import { fetchArticleContent, type FetchedContent } from './fetch-content.js'
import { enrichSteps } from './steps/index.js'
import type { ArticleContext } from './steps/types.js'
import type { ArticleTask } from './tasks.js'

const log = logger.child('fetcher')

export async function enrichArticle(ctx: ArticleContext, steps = enrichSteps): Promise<void> {
  for (const step of steps) {
    if (step.appliesTo && !step.appliesTo.includes(ctx.kind)) continue
    if (step.background) {
      void Promise.resolve(step.run(ctx)).catch(err => {
        log.warn({ step: step.name, articleId: ctx.articleId }, err)
      })
      continue
    }
    try {
      await step.run(ctx)
    } catch (err) {
      log.warn({ step: step.name, articleId: ctx.articleId }, err)
    }
  }
}

function articleContext(
  task: ArticleTask,
  articleId: number,
  content: FetchedContent,
  lang: string | null,
): ArticleContext {
  if (task.kind === 'new') {
    return {
      articleId,
      kind: 'new',
      feedId: task.feed_id,
      title: task.title,
      url: task.url,
      publishedAt: task.published_at,
      content,
      lang,
    }
  }
  return {
    articleId,
    kind: 'retry',
    feedId: task.article.feed_id,
    title: task.article.title,
    url: task.article.url,
    publishedAt: task.article.published_at,
    content,
    lang,
  }
}

/** Returns true if the retry article still has an error after processing. */
export async function processArticle(task: ArticleTask): Promise<boolean> {
  const articleUrl = task.kind === 'new' ? task.url : task.article.url

  const content = await fetchArticleContent(articleUrl, {
    requiresJsChallenge: task.kind === 'new' ? task.requires_js_challenge : undefined,
    listingExcerpt: task.kind === 'new' ? task.excerpt : undefined,
    existingArticle: task.kind === 'retry' ? task.article : undefined,
  })

  const effectiveLang = content.lang || (task.kind === 'retry' ? task.article.lang : null)

  // Persist
  if (task.kind === 'new') {
    try {
      const articleId = insertArticle({
        feed_id: task.feed_id,
        title: task.title,
        url: task.url,
        published_at: task.published_at,
        lang: effectiveLang,
        full_text: content.fullText,
        full_text_translated: null,
        summary: null,
        excerpt: content.excerpt,
        og_image: content.ogImage,
        last_error: content.lastError,
      })
      await enrichArticle(articleContext(task, articleId, content, effectiveLang))
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (!msg.includes('UNIQUE constraint failed')) {
        log.warn(`insertArticle failed for ${task.url}: ${msg}`)
      }
    }
  } else {
    updateArticleContent(task.article.id, {
      lang: effectiveLang,
      full_text: content.fullText,
      excerpt: content.excerpt,
      og_image: content.ogImage,
      last_error: content.lastError,
    })
    await enrichArticle(articleContext(task, task.article.id, content, effectiveLang))
  }
  const extractedLen = content.fullText?.replace(/\s+/g, ' ').trim().length ?? 0
  return !!content.lastError || (task.kind === 'retry' && extractedLen < MIN_EXTRACTED_LENGTH)
}
