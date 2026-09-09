import { applyRulesToArticle } from '../../rules.js'
import type { EnrichStep } from './types.js'

export const rules: EnrichStep = {
  name: 'rules',
  appliesTo: ['new'],
  run(ctx) {
    applyRulesToArticle(ctx.articleId, ctx.feedId, {
      title: ctx.title,
      url: ctx.url,
      content: ctx.content.fullText,
    })
  },
}
