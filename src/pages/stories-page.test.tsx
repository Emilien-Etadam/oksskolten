import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { LocaleContext } from '../lib/i18n'
import { StoriesPage, type Story } from './stories-page'
import type { ArticleListItem } from '../../shared/types'

let requestedKeys: string[] = []
let stories: Story[] | undefined

vi.mock('swr', () => ({
  default: (key: string) => {
    requestedKeys.push(key)
    return { data: stories ? { stories } : undefined }
  },
}))

vi.mock('../lib/fetcher', () => ({ fetcher: vi.fn() }))
vi.mock('../lib/readTracker', () => ({ isReadInSession: vi.fn(() => false) }))
vi.mock('../app', () => ({
  useAppLayout: () => ({
    settings: { dateMode: 'relative', indicatorStyle: 'dot', showUnreadIndicator: 'on', showThumbnails: 'on' },
  }),
}))

function article(overrides: Partial<ArticleListItem> = {}): ArticleListItem {
  return {
    id: 1, feed_id: 1, feed_name: 'Feed A', title: 'Leader', title_translated: null,
    url: 'https://example.com/1', published_at: '2026-08-01T00:00:00Z', lang: 'en',
    summary: null, excerpt: null, og_image: null, seen_at: null, read_at: null, bookmarked_at: null, liked_at: null,
    ...overrides,
  }
}

function renderPage() {
  return render(
    <LocaleContext.Provider value={{ locale: 'en', setLocale: vi.fn() }}>
      <MemoryRouter>
        <StoriesPage />
      </MemoryRouter>
    </LocaleContext.Provider>,
  )
}

describe('StoriesPage', () => {
  beforeEach(() => {
    requestedKeys = []
    stories = [{
      id: 1,
      leader: article({ id: 1, title: 'Big launch' }),
      others: [article({ id: 2, title: 'Launch, covered', feed_name: 'Feed B', url: 'https://example.com/2' })],
      sources: [{ feed_id: 1, feed_name: 'Feed A' }, { feed_id: 2, feed_name: 'Feed B' }],
      unread_count: 2,
      latest_published_at: '2026-08-01T00:00:00Z',
    }]
  })

  it('renders the leader, the sources and the other coverage', () => {
    renderPage()
    expect(screen.getByText('Big launch')).toBeTruthy()
    expect(screen.getByText('Covered by 2 sources:')).toBeTruthy()
    expect(screen.getByText('Feed B')).toBeTruthy()
    expect(screen.getByText('Launch, covered')).toBeTruthy()
  })

  it('shows an empty state', () => {
    stories = []
    renderPage()
    expect(screen.getByText(/No story has been covered/)).toBeTruthy()
  })

  it('switches the window', () => {
    renderPage()
    expect(requestedKeys[0]).toBe('/api/stories?days=3')
    fireEvent.click(screen.getByRole('tab', { name: 'Week' }))
    expect(requestedKeys.at(-1)).toBe('/api/stories?days=7')
  })
})
