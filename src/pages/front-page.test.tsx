import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { LocaleContext } from '../lib/i18n'
import { FrontPage } from './front-page'
import type { ArticleListItem } from '../../shared/types'

let swrFrontPageData: {
  hero: ArticleListItem | null
  sections: Array<{ category: { id: number; name: string }; articles: ArticleListItem[] }>
} | undefined

vi.mock('swr', () => ({
  default: (key: string) => (key === '/api/frontpage' ? { data: swrFrontPageData } : { data: undefined }),
}))

vi.mock('../lib/fetcher', () => ({
  fetcher: vi.fn(),
}))

vi.mock('../app', () => ({
  useAppLayout: () => ({
    settings: {
      dateMode: 'relative',
      indicatorStyle: 'dot',
      showUnreadIndicator: 'on',
      showThumbnails: 'on',
    },
  }),
}))

vi.mock('../lib/readTracker', () => ({
  isReadInSession: vi.fn(() => false),
}))

function makeArticle(overrides: Partial<ArticleListItem> = {}): ArticleListItem {
  return {
    id: 1,
    feed_id: 1,
    feed_name: 'Feed',
    title: 'Original title',
    title_translated: null,
    url: 'https://example.com/1',
    published_at: '2026-08-01T00:00:00Z',
    lang: 'en',
    summary: null,
    excerpt: null,
    og_image: null,
    seen_at: null,
    read_at: null,
    bookmarked_at: null,
    liked_at: null,
    ...overrides,
  }
}

function renderPage() {
  return render(
    <LocaleContext.Provider value={{ locale: 'en', setLocale: vi.fn() }}>
      <MemoryRouter>
        <FrontPage />
      </MemoryRouter>
    </LocaleContext.Provider>,
  )
}

describe('FrontPage', () => {
  beforeEach(() => {
    swrFrontPageData = {
      hero: makeArticle({ id: 10, title: 'Hero article' }),
      sections: [
        {
          category: { id: 1, name: 'Tech' },
          articles: [
            makeArticle({ id: 11, title: 'Tech one', title_translated: 'Tech un' }),
            makeArticle({ id: 12, title: 'Tech two' }),
          ],
        },
      ],
    }
  })

  it('renders the hero, section headings, and articles', () => {
    renderPage()
    expect(screen.getByText('Hero article')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Tech' }).getAttribute('href')).toBe('/categories/1')
    expect(screen.getByText('Tech two')).toBeTruthy()
  })

  it('prefers translated titles', () => {
    renderPage()
    expect(screen.getByText('Tech un')).toBeTruthy()
    expect(screen.queryByText('Tech one')).toBeNull()
  })

  it('shows the caught-up message when everything is read', () => {
    swrFrontPageData = { hero: null, sections: [] }
    renderPage()
    expect(screen.getByText("You're all caught up!")).toBeTruthy()
  })
})
