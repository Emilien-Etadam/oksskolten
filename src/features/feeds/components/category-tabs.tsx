import { useEffect, useRef } from 'react'
import useSWR from 'swr'
import { NavLink } from 'react-router-dom'
import { fetcher } from '@/lib/fetcher'
import { useI18n } from '@/i18n'
import type { FeedWithCounts } from '../../../../shared/types'
import type { ClassificationOverview } from '../../../../shared/classification'

interface CategoriesResponse {
  categories: Array<{ id: number; name: string }>
}

interface FeedsResponse {
  feeds: FeedWithCounts[]
}

const tabClass = ({ isActive }: { isActive: boolean }) =>
  `flex shrink-0 items-center gap-1.5 border-b-2 px-0.5 py-2 text-[13.5px] font-semibold whitespace-nowrap transition-colors ${
    isActive ? 'border-accent text-text' : 'border-transparent text-muted hover:text-text'
  }`

function TabCount({ count }: { count: number }) {
  if (count <= 0) return null
  return (
    <span className="rounded-full bg-bg-subtle px-1.5 text-[10.5px] font-medium leading-4 text-muted">
      {count > 999 ? '999+' : count}
    </span>
  )
}

/**
 * Newspaper-style horizontal section bar shown above article lists.
 * Lists the inbox plus every category with unread counts; the active
 * section is underlined with the accent color. Hidden when no categories exist.
 * When article themes replace categories, the bar lists the themes instead.
 */
export function CategoryTabs() {
  const { t } = useI18n()
  const { data } = useSWR<CategoriesResponse>('/api/categories', fetcher)
  const { data: feedsData } = useSWR<FeedsResponse>('/api/feeds', fetcher)
  const { data: classification } = useSWR<ClassificationOverview>('/api/classification', fetcher)

  const tabs: Array<{ key: string; to: string; label: string; count: number }> = []
  if (classification?.hideCategories) {
    for (const theme of classification.themes) {
      tabs.push({ key: `theme-${theme.id}`, to: `/themes/${theme.id}`, label: theme.label, count: theme.unread_count })
    }
  } else {
    const unreadByCategory = new Map<number, number>()
    for (const feed of feedsData?.feeds ?? []) {
      if (feed.category_id != null) {
        unreadByCategory.set(feed.category_id, (unreadByCategory.get(feed.category_id) ?? 0) + feed.unread_count)
      }
    }
    for (const category of data?.categories ?? []) {
      tabs.push({ key: `category-${category.id}`, to: `/categories/${category.id}`, label: category.name, count: unreadByCategory.get(category.id) ?? 0 })
    }
  }
  const hasCategories = tabs.length > 0

  // The bar is sticky under the header; publishing its height lets the day
  // headers stick right below it instead of hiding underneath. Re-runs when the
  // bar appears, since it renders nothing until categories have loaded.
  const navRef = useRef<HTMLElement>(null)
  useEffect(() => {
    const nav = navRef.current
    if (!nav) return
    const publish = () => {
      document.documentElement.style.setProperty('--category-tabs-height', `${nav.offsetHeight}px`)
    }
    publish()
    const observer = new ResizeObserver(publish)
    observer.observe(nav)
    return () => {
      observer.disconnect()
      document.documentElement.style.removeProperty('--category-tabs-height')
    }
  }, [hasCategories])

  if (!hasCategories) return null

  let totalUnread = 0
  for (const feed of feedsData?.feeds ?? []) totalUnread += feed.unread_count

  return (
    <nav
      ref={navRef}
      className="sticky z-20 border-b border-border select-none"
      style={{ top: 'var(--header-height)', backgroundColor: 'rgb(var(--color-bg-header-rgb) / 0.95)' }}
    >
      <div className="flex items-center gap-5 overflow-x-auto scrollbar-none px-4">
        <NavLink to="/inbox" end className={tabClass}>
          {t('feeds.inbox')}
          <TabCount count={totalUnread} />
        </NavLink>
        {tabs.map(tab => (
          <NavLink key={tab.key} to={tab.to} className={tabClass}>
            {tab.label}
            <TabCount count={tab.count} />
          </NavLink>
        ))}
      </div>
    </nav>
  )
}
