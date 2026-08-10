import { useCallback, useRef } from 'react'
import { useKeyboardNavigationContext } from '../contexts/keyboard-navigation-context'
import { useClipFeedId } from './use-clip-feed-id'
import { useAppLayout } from '../app'
import { fetcher } from '../lib/fetcher'
import type { ArticleListItem } from '../../shared/types'

/** Server-side maximum for /api/articles limit */
const FETCH_LIMIT = 100
/**
 * How far the fetch window backs off into the already-known list. In
 * unread-filtered views, reading articles shrinks the server-side list and
 * shifts offsets; the overlap absorbs that drift and duplicates are ignored.
 */
const OVERLAP = 80

interface ArticlesResponse {
  articles: ArticleListItem[]
  has_more: boolean
}

export interface ExtendedList {
  ids: string[]
  urls: Record<string, string>
}

/** Map a list route path to the /api/articles query it displays. */
function buildListQuery(listPath: string, clipFeedId: number | null, categoryUnreadOnly: boolean): URLSearchParams | null {
  const params = new URLSearchParams()
  if (listPath === '/inbox') {
    params.set('unread', '1')
  } else if (listPath === '/bookmarks') {
    params.set('bookmarked', '1')
  } else if (listPath === '/likes') {
    params.set('liked', '1')
  } else if (listPath === '/history') {
    params.set('read', '1')
  } else if (listPath === '/clips') {
    if (!clipFeedId) return null
    params.set('feed_id', String(clipFeedId))
  } else if (listPath.startsWith('/feeds/')) {
    params.set('feed_id', listPath.slice('/feeds/'.length))
  } else if (listPath.startsWith('/categories/')) {
    params.set('category_id', listPath.slice('/categories/'.length))
    if (categoryUnreadOnly) params.set('unread', '1')
  } else {
    return null
  }
  return params
}

/**
 * Extend the keyboard-navigation article list from the reader, so arrow/swipe/
 * j-k navigation can continue past the pages the list had loaded. Fetches the
 * next window of the last visited list and appends unknown articles.
 *
 * Returns the extended arrays when new articles were appended (the context
 * state updates asynchronously, so callers needing the fresh list immediately
 * should use the return value), or null when there was nothing to add.
 */
export function useExtendArticleList(): () => Promise<ExtendedList | null> {
  const { articleIds, articleUrls, setArticleIds, setArticleUrls, lastListUrl } = useKeyboardNavigationContext()
  const clipFeedId = useClipFeedId()
  const { settings } = useAppLayout()
  const categoryUnreadOnly = settings.categoryUnreadOnly === 'on'

  // Keep latest values in refs so the callback stays stable
  const stateRef = useRef({ articleIds, articleUrls, lastListUrl, clipFeedId, categoryUnreadOnly })
  stateRef.current = { articleIds, articleUrls, lastListUrl, clipFeedId, categoryUnreadOnly }
  const inFlightRef = useRef<Promise<ExtendedList | null> | null>(null)

  return useCallback(() => {
    if (inFlightRef.current) return inFlightRef.current

    const run = (async (): Promise<ExtendedList | null> => {
      const { articleIds, articleUrls, lastListUrl, clipFeedId, categoryUnreadOnly } = stateRef.current
      const params = buildListQuery(lastListUrl || '/inbox', clipFeedId, categoryUnreadOnly)
      if (!params) return null

      params.set('limit', String(FETCH_LIMIT))
      params.set('offset', String(Math.max(0, articleIds.length - OVERLAP)))

      let response: ArticlesResponse
      try {
        response = await fetcher(`/api/articles?${params.toString()}`) as ArticlesResponse
      } catch {
        return null
      }

      const known = new Set(articleIds)
      const fresh = response.articles.filter(a => !known.has(String(a.id)))
      if (fresh.length === 0) return null

      const ids = [...articleIds, ...fresh.map(a => String(a.id))]
      const urls = { ...articleUrls }
      for (const a of fresh) urls[String(a.id)] = a.url
      setArticleIds(ids)
      setArticleUrls(urls)
      return { ids, urls }
    })()

    inFlightRef.current = run
    void run.finally(() => { inFlightRef.current = null })
    return run
  }, [setArticleIds, setArticleUrls])
}
