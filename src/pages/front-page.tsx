import useSWR from 'swr'
import { Link } from 'react-router-dom'
import { fetcher } from '../lib/fetcher'
import { useI18n } from '../lib/i18n'
import { useAppLayout } from '../app'
import { ArticleCard } from '../components/article/article-card'
import { Skeleton } from '../components/ui/skeleton'
import type { ArticleListItem } from '../../shared/types'

interface FrontPageData {
  hero: ArticleListItem | null
  sections: Array<{ category: { id: number; name: string }; articles: ArticleListItem[] }>
}

/**
 * Newspaper-style front page: a hero article followed by the top unread
 * articles of each category, reusing the magazine card variants.
 */
export function FrontPage() {
  const { settings } = useAppLayout()
  const { t } = useI18n()
  const { data } = useSWR<FrontPageData>('/api/frontpage', fetcher)

  const displayConfig = {
    dateMode: settings.dateMode,
    indicatorStyle: settings.indicatorStyle,
    showUnreadIndicator: settings.showUnreadIndicator === 'on',
    showThumbnails: settings.showThumbnails === 'on',
  }

  if (!data) {
    return (
      <div className="max-w-3xl mx-auto px-4 md:px-6 py-6 space-y-4">
        <Skeleton className="w-full aspect-video rounded-lg" />
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
      </div>
    )
  }

  if (!data.hero && data.sections.length === 0) {
    return (
      <div className="text-center py-16 text-muted text-sm">
        {t('articles.allCaughtUp')}
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto px-4 md:px-6 py-6">
      {data.hero && (
        <ArticleCard article={data.hero} layout="magazine" isFeatured {...displayConfig} />
      )}
      {data.sections.map(section => (
        <section key={section.category.id} className="mt-8">
          <Link
            to={`/categories/${section.category.id}`}
            className="block border-b-2 border-accent pb-1.5 mb-1 no-underline"
          >
            <h2 className="text-[15px] font-bold text-text">{section.category.name}</h2>
          </Link>
          <div>
            {section.articles.map(article => (
              <ArticleCard key={article.id} article={article} layout="magazine" {...displayConfig} />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
