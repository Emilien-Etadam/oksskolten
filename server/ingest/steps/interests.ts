import { scoreNewArticle } from '../../interests.js'
import type { EnrichStep } from './types.js'

export const interests: EnrichStep = {
  name: 'interests',
  appliesTo: ['new'],
  run(ctx) {
    scoreNewArticle(ctx.articleId, ctx.title)
  },
}
