import { useEffect, useRef } from 'react'
import useSWR from 'swr'
import { NavLink } from 'react-router-dom'
import { fetcher } from '../../lib/fetcher'
import { useI18n } from '../../lib/i18n'
import type { FeedWithCounts } from '../../../shared/types'

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
 */
export function CategoryTabs() {
  const { t } = useI18n()
  const { data } = useSWR<CategoriesResponse>('/api/categories', fetcher)
  const { data: feedsData } = useSWR<FeedsResponse>('/api/feeds', fetcher)

  const hasCategories = !!data?.categories.length

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

  const unreadByCategory = new Map<number, number>()
  let totalUnread = 0
  for (const feed of feedsData?.feeds ?? []) {
    totalUnread += feed.unread_count
    if (feed.category_id != null) {
      unreadByCategory.set(feed.category_id, (unreadByCategory.get(feed.category_id) ?? 0) + feed.unread_count)
    }
  }

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
        {data.categories.map((category) => (
          <NavLink key={category.id} to={`/categories/${category.id}`} className={tabClass}>
            {category.name}
            <TabCount count={unreadByCategory.get(category.id) ?? 0} />
          </NavLink>
        ))}
      </div>
    </nav>
  )
}
