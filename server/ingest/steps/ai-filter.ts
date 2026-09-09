import { enqueueAiFilter } from '../../ai/index.js'
import type { EnrichStep } from './types.js'

export const aiFilter: EnrichStep = {
  name: 'ai-filter',
  appliesTo: ['new'],
  run(ctx) {
    enqueueAiFilter(ctx.articleId, ctx.feedId)
  },
}
