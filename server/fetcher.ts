// Façade over the ingestion pipeline. Kept so import paths and test mocks
// (`vi.mock('../fetcher.js')`) stay stable; add logic under server/ingest/, not here.
export { fetchAllFeeds, fetchSingleFeed, fetchArticleContent, enrichArticle, clipContext } from './ingest/index.js'
export type { FetchedContent, ArticleTask, ArticleContext, EnrichStep } from './ingest/index.js'
export { normalizeDate } from './fetcher/util.js'
export { type FetchProgressEvent, fetchProgress, getFeedState } from './fetcher/progress.js'
export { discoverRssUrl } from './fetcher/rss.js'
export { detectLanguage, summarizeArticle, streamSummarizeArticle, translateArticle, streamTranslateArticle } from './fetcher/ai.js'
export type { AiTextResult, AiBillingMode } from './fetcher/ai.js'
