import { useMemo, useRef } from 'react'
import useSWRInfinite from 'swr/infinite'
import { fetcher } from '@/lib/fetcher'
import type { ArticleListItem } from '../../../../shared/types'

interface ArticlesResponse {
  articles: ArticleListItem[]
  total: number
  has_more: boolean
  total_without_floor?: number
  total_all?: number
}

const PAGE_SIZE = 20

export interface ArticlePagesParams {
  smartFolderId: number | undefined
  isRecommended: boolean
  feedId: number | undefined
  categoryId: number | undefined
  unreadOnly: boolean
  bookmarkedOnly: boolean
  likedOnly: boolean
  readOnly: boolean
  noFloor: boolean
  isCollectionView: boolean
}

export function useArticlePages({
  smartFolderId,
  isRecommended,
  feedId,
  categoryId,
  unreadOnly,
  bookmarkedOnly,
  likedOnly,
  readOnly,
  noFloor,
  isCollectionView,
}: ArticlePagesParams) {
  const getKey = (pageIndex: number, previousPageData: ArticlesResponse | null) => {
    if (previousPageData && !previousPageData.has_more) return null
    const params = new URLSearchParams()
    if (smartFolderId) {
      params.set('limit', String(PAGE_SIZE))
      params.set('offset', String(pageIndex * PAGE_SIZE))
      return `/api/smart-folders/${smartFolderId}/articles?${params.toString()}`
    }
    if (isRecommended) params.set('sort', 'recommended')
    if (feedId) params.set('feed_id', String(feedId))
    if (categoryId) params.set('category_id', String(categoryId))
    if (unreadOnly) params.set('unread', '1')
    if (bookmarkedOnly) params.set('bookmarked', '1')
    if (likedOnly) params.set('liked', '1')
    if (readOnly) params.set('read', '1')
    if (noFloor) params.set('no_floor', '1')
    params.set('limit', String(PAGE_SIZE))
    params.set('offset', String(pageIndex * PAGE_SIZE))
    return `/api/articles?${params.toString()}`
  }

  const { data, error, size, setSize, isLoading, isValidating, mutate } = useSWRInfinite<ArticlesResponse>(
    getKey,
    fetcher,
    {
      revalidateFirstPage: isCollectionView,
    },
  )

  const allArticles = useMemo(() => data ? data.flatMap(page => page.articles) : [], [data])

  // Group similar articles (e.g. the same story posted on several subreddits):
  // the first loaded member of a similarity group is shown with a ×N badge and
  // the later members are hidden; marking or opening the leader marks the
  // whole group as read.
  const { articles, groupCounts, absorbedIds } = useMemo(() => {
    const position = new Map(allArticles.map((a, i) => [a.id, i]))
    const hidden = new Set<number>()
    const counts = new Map<number, number>()
    const absorbed = new Map<number, number[]>()
    for (const [index, article] of allArticles.entries()) {
      if (hidden.has(article.id)) continue
      const similarIds = (article.similar_ids ?? '').split(',').filter(Boolean).map(Number)
      const later = similarIds.filter(id => (position.get(id) ?? -1) > index && !hidden.has(id))
      if (later.length > 0) {
        for (const id of later) hidden.add(id)
        counts.set(article.id, later.length + 1)
        absorbed.set(article.id, later)
      }
    }
    return {
      articles: hidden.size > 0 ? allArticles.filter(a => !hidden.has(a.id)) : allArticles,
      groupCounts: counts,
      absorbedIds: absorbed,
    }
  }, [allArticles])

  const absorbedIdsRef = useRef(absorbedIds)
  absorbedIdsRef.current = absorbedIds

  return { articles, groupCounts, absorbedIds, absorbedIdsRef, data, error, size, setSize, isLoading, isValidating, mutate }
}
