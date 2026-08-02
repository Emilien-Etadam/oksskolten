import useSWR from 'swr'
import { NavLink } from 'react-router-dom'
import { fetcher } from '../../lib/fetcher'
import { useI18n } from '../../lib/i18n'

interface CategoriesResponse {
  categories: Array<{ id: number; name: string }>
}

const tabClass = ({ isActive }: { isActive: boolean }) =>
  `shrink-0 border-b-2 px-0.5 py-2 text-[13.5px] font-semibold whitespace-nowrap transition-colors ${
    isActive ? 'border-accent text-text' : 'border-transparent text-muted hover:text-text'
  }`

/**
 * Newspaper-style horizontal section bar shown above article lists.
 * Lists the inbox plus every category; the active section is underlined
 * with the accent color. Hidden when no categories exist.
 */
export function CategoryTabs() {
  const { t } = useI18n()
  const { data } = useSWR<CategoriesResponse>('/api/categories', fetcher)

  if (!data?.categories.length) return null

  return (
    <nav
      className="sticky z-20 border-b border-border select-none"
      style={{ top: 'var(--header-height)', backgroundColor: 'rgb(var(--color-bg-header-rgb) / 0.95)' }}
    >
      <div className="flex items-center gap-5 overflow-x-auto scrollbar-none px-4">
        <NavLink to="/inbox" end className={tabClass}>
          {t('feeds.inbox')}
        </NavLink>
        {data.categories.map((category) => (
          <NavLink key={category.id} to={`/categories/${category.id}`} className={tabClass}>
            {category.name}
          </NavLink>
        ))}
      </div>
    </nav>
  )
}
