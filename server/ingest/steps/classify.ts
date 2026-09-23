import { enqueueClassify } from '../../ai/index.js'
import type { EnrichStep } from './types.js'

export const classify: EnrichStep = {
  name: 'classify',
  appliesTo: ['new', 'clip'],
  run(ctx) {
    enqueueClassify(ctx.articleId)
  },
}
