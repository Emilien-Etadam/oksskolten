import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { RefreshButton } from './refresh-button'

// --- Mocks ---

vi.mock('../../lib/fetcher', () => ({ fetcher: vi.fn() }))

const mockFetchAllFeeds = vi.fn()
vi.mock('../../lib/feed-refresh', () => ({
  fetchAllFeeds: (...args: unknown[]) => mockFetchAllFeeds(...args),
}))

const mockStartFeedFetch = vi.fn()
vi.mock('../../contexts/fetch-progress-context', () => ({
  useFetchProgressContext: () => ({ startFeedFetch: mockStartFeedFetch }),
}))

const { mockToast } = vi.hoisted(() => ({
  mockToast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}))
vi.mock('sonner', () => ({ toast: mockToast }))

vi.mock('swr', () => ({
  default: () => ({
    data: {
      feeds: [
        { id: 1, category_id: 7, disabled: 0, type: 'rss' },
        { id: 2, category_id: 7, disabled: 1, type: 'rss' },
        { id: 3, category_id: 9, disabled: 0, type: 'rss' },
      ],
    },
    mutate: vi.fn(),
  }),
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
})
