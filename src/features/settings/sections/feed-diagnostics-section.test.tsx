import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { FeedDiagnosticsSection } from './feed-diagnostics-section'
import type { FeedWithCounts } from '../../../../shared/types'

// --- Mocks ---

const mockApiPatch = vi.fn()

vi.mock('../../../lib/fetcher', () => ({
  fetcher: vi.fn(),
  apiPatch: (...args: unknown[]) => mockApiPatch(...args),
  authHeaders: () => ({}),
}))

const mockReDetect = vi.fn().mockResolvedValue(undefined)

vi.mock('../../../lib/feed-error', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/feed-error')>()),
  reDetectSSE: (...args: unknown[]) => mockReDetect(...args),
}))

const mockStartFeedFetch = vi.fn()

vi.mock('../../../contexts/fetch-progress-context', () => ({
  useFetchProgressContext: () => ({ startFeedFetch: mockStartFeedFetch }),
}))

const { mockToast } = vi.hoisted(() => ({
  mockToast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}))

vi.mock('sonner', () => ({ toast: mockToast }))

const mutateFeeds = vi.fn()
let feeds: FeedWithCounts[] = []

vi.mock('swr', () => ({
  default: () => ({ data: { feeds, bookmark_count: 0, like_count: 0, clip_feed_id: null }, mutate: mutateFeeds }),
}))

function createFeed(overrides: Partial<FeedWithCounts> & { id: number; name: string }): FeedWithCounts {
  return {
    url: `https://${overrides.name.toLowerCase().replace(/\s+/g, '-')}.example.com`,
    rss_url: null,
    rss_bridge_url: null,
    category_id: null,
    category_name: null,
    last_error: null,
    error_count: 0,
    disabled: 0,
    requires_js_challenge: 0,
    type: 'rss',
    etag: null,
    last_modified: null,
    last_content_hash: null,
    next_check_at: null,
    check_interval: null,
    created_at: '2026-01-01T00:00:00Z',
    article_count: 0,
    unread_count: 0,
    articles_per_week: 0,
    latest_published_at: new Date().toISOString(),
    ...overrides,
  }
}

const healthyFeed = createFeed({ id: 1, name: 'Healthy Blog' })
const httpErrorFeed = createFeed({ id: 2, name: 'Broken Blog', last_error: 'HTTP 404 Not Found', error_count: 3 })
const disabledFeed = createFeed({ id: 3, name: 'Dead Blog', last_error: 'No RSS URL', error_count: 5, disabled: 1 })

function renderSection() {
  return render(
    <MemoryRouter>
      <FeedDiagnosticsSection />
    </MemoryRouter>,
  )
}

describe('FeedDiagnosticsSection', () => {
  const user = userEvent.setup({ pointerEventsCheck: 0 })

  beforeEach(() => {
    vi.clearAllMocks()
    mockStartFeedFetch.mockResolvedValue({ totalNew: 0 })
    mockReDetect.mockResolvedValue(undefined)
    feeds = [healthyFeed, httpErrorFeed, disabledFeed]
  })

  it('lists only feeds that are failing or disabled', () => {
    renderSection()
    expect(screen.getByText('Broken Blog')).toBeTruthy()
    expect(screen.getByText('Dead Blog')).toBeTruthy()
    expect(screen.queryByText('Healthy Blog')).toBeNull()
  })

  it('confirms all is well when nothing is broken', () => {
    feeds = [healthyFeed]
    renderSection()
    expect(screen.getByText('Every feed is fetching normally')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Retry all' })).toBeNull()
  })

  it('explains the failure and interpolates the HTTP status', () => {
    renderSection()
    const card = screen.getByText('Broken Blog').closest('article')!
    expect(within(card).getByText(/The server returned HTTP error \(404\)/)).toBeTruthy()
    expect(within(card).getByText('3 consecutive failures')).toBeTruthy()
  })

  it('exposes the raw error string', () => {
    renderSection()
    const card = screen.getByText('Broken Blog').closest('article')!
    expect(within(card).getByText('Raw error')).toBeTruthy()
    expect(within(card).getByText('HTTP 404 Not Found')).toBeTruthy()
  })

  it('offers the remedy that matches the error', () => {
    renderSection()
    const httpCard = screen.getByText('Broken Blog').closest('article')!
    expect(within(httpCard).getByRole('button', { name: 'Retry Fetch' })).toBeTruthy()
    expect(within(httpCard).queryByRole('button', { name: 'Re-detect RSS' })).toBeNull()

    const noRssCard = screen.getByText('Dead Blog').closest('article')!
    expect(within(noRssCard).getByRole('button', { name: 'Re-detect RSS' })).toBeTruthy()
    expect(within(noRssCard).queryByRole('button', { name: 'Retry Fetch' })).toBeNull()
  })

  it('retries the fetch of a single feed', async () => {
    renderSection()
    const card = screen.getByText('Broken Blog').closest('article')!
    await user.click(within(card).getByRole('button', { name: 'Retry Fetch' }))
    await waitFor(() => expect(mockStartFeedFetch).toHaveBeenCalledWith(2))
  })

  it('re-detects RSS then fetches', async () => {
    renderSection()
    const card = screen.getByText('Dead Blog').closest('article')!
    await user.click(within(card).getByRole('button', { name: 'Re-detect RSS' }))
    await waitFor(() => expect(mockReDetect).toHaveBeenCalledWith(3, expect.any(Function)))
    await waitFor(() => expect(mockStartFeedFetch).toHaveBeenCalledWith(3))
  })

  it('re-enables a disabled feed', async () => {
    renderSection()
    const card = screen.getByText('Dead Blog').closest('article')!
    await user.click(within(card).getByRole('button', { name: 'Enable' }))
    await waitFor(() => expect(mockApiPatch).toHaveBeenCalledWith('/api/feeds/3', { disabled: 0 }))
  })

  it('re-enables and re-fetches every broken feed with Retry all', async () => {
    renderSection()
    await user.click(screen.getByRole('button', { name: 'Retry all' }))

    await waitFor(() => expect(mockStartFeedFetch).toHaveBeenCalledTimes(2))
    expect(mockApiPatch).toHaveBeenCalledExactlyOnceWith('/api/feeds/3', { disabled: 0 })
    expect(mockStartFeedFetch).toHaveBeenCalledWith(2)
    expect(mockStartFeedFetch).toHaveBeenCalledWith(3)
    expect(mockToast.success).toHaveBeenCalledWith('2 of 2 feeds recovered')
  })

  it('collapses a long list behind a show-all button', async () => {
    feeds = Array.from({ length: 8 }, (_, i) =>
      createFeed({ id: 100 + i, name: `Broken ${i}`, last_error: 'HTTP 500 Server Error', error_count: 1 }),
    )
    renderSection()
    expect(screen.getAllByRole('article')).toHaveLength(5)

    await user.click(screen.getByRole('button', { name: 'Show all 8' }))
    expect(screen.getAllByRole('article')).toHaveLength(8)
  })

  it('does not re-detect during Retry all', async () => {
    renderSection()
    await user.click(screen.getByRole('button', { name: 'Retry all' }))
    await waitFor(() => expect(mockStartFeedFetch).toHaveBeenCalledTimes(2))
    expect(mockReDetect).not.toHaveBeenCalled()
  })
})
