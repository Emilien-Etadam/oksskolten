export { applyRulesToArticle } from './rules.js'
export { scoreArticleQuality } from './quality.js'
export {
  scoreNewArticle,
  maybeRebuildInterestProfile,
  invalidateInterestProfile,
  recalculateInterestScores,
  _resetInterestsForTests,
} from './interests.js'
export { detectAndStoreSimilarArticles, computeTitleSimilarity } from './similarity.js'
export { insertSimilarity, getSimilarArticles, findReadSimilarArticle } from './similarity-db.js'
export type { SimilarArticle } from './similarity-db.js'
export { recalculateFeedTrust, getFeedTrust } from './trust.js'
export { getTopStories } from './stories-db.js'
export type { Story, StorySource } from './stories-db.js'
export { registerIntelligenceRoutes } from './routes.js'
export { createFeedRule } from './rules-db.js'
