import { applyRulesToArticle } from '../../intelligence/index.js'
import type { EnrichStep } from './types.js'

export const rules: EnrichStep = {
  name: 'rules',
  appliesTo: ['new', 'clip'],
  run(ctx) {
    applyRulesToArticle(ctx.articleId, ctx.feedId, {
      title: ctx.title,
      url: ctx.url,
      content: ctx.content.fullText,
    })
  },
}
