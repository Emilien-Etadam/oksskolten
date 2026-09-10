import { useMemo } from 'react'
import { dayKeyOf } from '../components/day-separator'
import type { ArticleListItem } from '../../../../shared/types'

export function useDayGroups(
  articles: ArticleListItem[],
  showDaySeparators: boolean,
  isGridLayout: boolean,
) {
  // Grid layouts keep the flat list: sections would break the column flow, and
  // a sticky header has nothing to unstick against there.
  const dayGroups = useMemo(() => {
    if (!showDaySeparators || isGridLayout) return null
    const groups: { key: string; date: string | null; items: { article: ArticleListItem; index: number }[] }[] = []
    articles.forEach((article, index) => {
      const key = dayKeyOf(article.published_at)
      const last = groups[groups.length - 1]
      if (last && last.key === key) last.items.push({ article, index })
      else groups.push({ key, date: article.published_at, items: [{ article, index }] })
    })
    return groups
  }, [articles, showDaySeparators, isGridLayout])

  return dayGroups
}
