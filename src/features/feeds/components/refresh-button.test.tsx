import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { RefreshButton } from './refresh-button'

// --- Mocks ---

vi.mock('@/lib/fetcher', () => ({ fetcher: vi.fn() }))

const mockFetchAllFeeds = vi.fn()
vi.mock('@/lib/feed-refresh', () => ({
  fetchAllFeeds: (...args: unknown[]) => mockFetchAllFeeds(...args),
}))

const mockStartFeedFetch = vi.fn()
const mockRevalidate = vi.fn()
vi.mock('@/contexts/fetch-progress-context', () => ({
  useFetchProgressContext: () => ({ startFeedFetch: mockStartFeedFetch, revalidate: mockRevalidate }),
}))

const { mockToast } = vi.hoisted(() => ({
  mockToast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}))
vi.mock('sonner', () => ({ toast: mockToast }))

const feedsBefore = {
  feeds: [
    { id: 1, category_id: 7, disabled: 0, type: 'rss', article_count: 10 },
    { id: 2, category_id: 7, disabled: 1, type: 'rss', article_count: 4 },
    { id: 3, category_id: 9, disabled: 0, type: 'rss', article_count: 6 },
  ],
}

/** Counts read back after the run; defaults to the ones the tab already had. */
const mockGlobalMutate = vi.fn()

vi.mock('swr', () => ({
  default: () => ({ data: feedsBefore, mutate: vi.fn() }),
  useSWRConfig: () => ({ mutate: mockGlobalMutate }),
}))

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <RefreshButton />
    </MemoryRouter>,
  )
}

describe('RefreshButton', () => {
  const user = userEvent.setup({ pointerEventsCheck: 0 })

  beforeEach(() => {
    vi.clearAllMocks()
    mockStartFeedFetch.mockResolvedValue({ totalNew: 0 })
    mockFetchAllFeeds.mockResolvedValue({ totalNew: 0 })
    mockGlobalMutate.mockResolvedValue(feedsBefore)
  })

  it('fetches only the feed on a feed route', async () => {
    renderAt('/feeds/42')
    await user.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => expect(mockStartFeedFetch).toHaveBeenCalledWith(42))
    expect(mockFetchAllFeeds).not.toHaveBeenCalled()
  })

  it('fetches a category feeds, skipping the disabled ones', async () => {
    renderAt('/categories/7')
    await user.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => expect(mockStartFeedFetch).toHaveBeenCalledWith(1))
    expect(mockStartFeedFetch).toHaveBeenCalledTimes(1)
    expect(mockFetchAllFeeds).not.toHaveBeenCalled()
  })

  it('runs the server-side pass everywhere else', async () => {
    renderAt('/inbox')
    await user.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => expect(mockFetchAllFeeds).toHaveBeenCalled())
    expect(mockStartFeedFetch).not.toHaveBeenCalled()
  })

  it('refreshes the list once the server-side pass is done', async () => {
    mockFetchAllFeeds.mockResolvedValue({ totalNew: 3 })
    renderAt('/inbox')
    await user.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => expect(mockRevalidate).toHaveBeenCalled())
  })

  it('reports what the run turned up', async () => {
    mockFetchAllFeeds.mockResolvedValue({ totalNew: 12 })
    renderAt('/inbox')
    await user.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => expect(mockToast.success).toHaveBeenCalledWith('12 new articles'))
  })

  it('says so when nothing came in', async () => {
    renderAt('/inbox')
    await user.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => expect(mockToast).toHaveBeenCalledWith('No new articles'))
  })

  it('reports a failed run', async () => {
    mockFetchAllFeeds.mockRejectedValue(new Error('boom'))
    renderAt('/inbox')
    await user.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith('Fetch failed'))
  })

  // The scheduled fetch may have brought articles in since this tab last
  // looked; they are new to the reader even though this run found nothing.
  it('reports the articles the feed gained since the tab last looked', async () => {
    mockGlobalMutate.mockResolvedValue({
      feeds: feedsBefore.feeds.map(f => f.id === 1 ? { ...f, article_count: 15 } : f),
    })
    renderAt('/feeds/1')
    await user.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => expect(mockToast.success).toHaveBeenCalledWith('5 new articles'))
  })

  it('counts only the feeds the run covers', async () => {
    mockGlobalMutate.mockResolvedValue({
      feeds: feedsBefore.feeds.map(f => f.id === 3 ? { ...f, article_count: 20 } : f),
    })
    renderAt('/feeds/1')
    await user.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => expect(mockToast).toHaveBeenCalledWith('No new articles'))
    expect(mockToast.success).not.toHaveBeenCalled()
  })

  it('keeps the run count when it is the larger of the two', async () => {
    mockFetchAllFeeds.mockResolvedValue({ totalNew: 12 })
    renderAt('/inbox')
    await user.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => expect(mockToast.success).toHaveBeenCalledWith('12 new articles'))
  })
})
