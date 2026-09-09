import type { FetchedContent } from '../fetch-content.js'
import type { TaskKind } from '../tasks.js'

export interface ArticleContext {
  articleId: number
  kind: TaskKind                 // 'new' | 'retry' | 'clip'
  feedId: number
  title: string
  url: string
  publishedAt: string | null
  content: FetchedContent        // what the fetch produced for this run
  lang: string | null            // effective language after fallbacks
}

export interface EnrichStep {
  name: string
  /** Task kinds the step runs for. Omitted = every kind. */
  appliesTo?: TaskKind[]
  /**
   * true = fire-and-forget: the pipeline does not await it and logs a
   * rejection. Use only where today's code already does `void fn()`.
   */
  background?: boolean
  run(ctx: ArticleContext): void | Promise<void>
}
