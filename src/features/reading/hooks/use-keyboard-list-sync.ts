import { useMemo, useEffect } from 'react'
import { useKeyboardNavigationContext } from '@/contexts/keyboard-navigation-context'
import type { ArticleListItem } from '../../../../shared/types'

export function useKeyboardListSync(articles: ArticleListItem[], listUrl: string) {
  const { focusedItemId, setFocusedItemId, setArticleIds, setArticleUrls, setArticleDates, setLastListUrl } = useKeyboardNavigationContext()

  const articleIds = useMemo(() => articles.map(a => String(a.id)), [articles])
  const articleUrls = useMemo(() => {
    const map: Record<string, string> = {}
    for (const a of articles) map[String(a.id)] = a.url
    return map
  }, [articles])
  const articleDates = useMemo(() => {
    const map: Record<string, string | null> = {}
    for (const a of articles) map[String(a.id)] = a.published_at
    return map
  }, [articles])

  useEffect(() => {
    setArticleIds(articleIds)
    setArticleUrls(articleUrls)
    setArticleDates(articleDates)
  }, [articleIds, articleUrls, articleDates, setArticleIds, setArticleUrls, setArticleDates])

  useEffect(() => {
    setLastListUrl(listUrl)
  }, [listUrl, setLastListUrl])

  const articleMap = useMemo(() => {
    const map = new Map<string, ArticleListItem>()
    for (const a of articles) map.set(String(a.id), a)
    return map
  }, [articles])

  return { focusedItemId, setFocusedItemId, articleIds, articleMap }
}
