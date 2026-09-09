import { getSetting } from '../../db.js'
import { enqueueAutoTranslate, enqueueAutoSummarize, isAutoTranslateEnabled, isAutoSummarizeEnabled } from '../../fetcher/ai-queue.js'
import { DEFAULT_LANGUAGE } from '../../../shared/lang.js'
import type { EnrichStep } from './types.js'

export const aiQueue: EnrichStep = {
  name: 'ai-queue',
  appliesTo: ['new', 'retry'],
  run(ctx) {
    if (ctx.content.fullText && isAutoSummarizeEnabled()) {
      enqueueAutoSummarize(ctx.articleId, ctx.content.fullText)
    }
    if (!isAutoTranslateEnabled() || !ctx.content.fullText || !ctx.lang || ctx.lang === 'unknown') return
    const targetLang = getSetting('translate.target_lang') || getSetting('general.language') || DEFAULT_LANGUAGE
    if (ctx.lang === targetLang) return
    enqueueAutoTranslate(ctx.articleId, ctx.content.fullText)
  },
}
