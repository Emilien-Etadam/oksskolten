import { setArticleQuality } from '../../db.js'
import { scoreArticleQuality } from '../../quality.js'
import type { EnrichStep } from './types.js'

export const quality: EnrichStep = {
  name: 'quality',
  appliesTo: ['new', 'retry'],
  run(ctx) {
    // A repaired body changes the quality verdict
    if (ctx.kind === 'retry' && !ctx.content.fullText) return
    setArticleQuality(
      ctx.articleId,
      scoreArticleQuality({ title: ctx.title, text: ctx.content.fullText, url: ctx.url }).score,
    )
  },
}
