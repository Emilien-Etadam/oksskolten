import { detectAndStoreSimilarArticles } from '../../intelligence/index.js'
import type { EnrichStep } from './types.js'

export const similarity: EnrichStep = {
  name: 'similarity',
  appliesTo: ['new', 'clip'],
  background: true,
  run(ctx) {
    // Fire-and-forget: detect similar articles asynchronously
    return detectAndStoreSimilarArticles(ctx.articleId, ctx.title, ctx.feedId, ctx.publishedAt, ctx.url)
  },
}
