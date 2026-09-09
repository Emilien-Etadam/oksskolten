import type { Article } from '../db.js'

export interface NewArticle {
  kind: 'new'
  feed_id: number
  title: string
  url: string
  published_at: string | null
  requires_js_challenge?: boolean
  /** Excerpt from listing page (CSS Bridge content_selector), used as fullText fallback */
  excerpt?: string
}

export interface RetryArticle {
  kind: 'retry'
  article: Article
}

export type ArticleTask = NewArticle | RetryArticle
export type TaskKind = ArticleTask['kind']
