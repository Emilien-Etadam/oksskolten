import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { LocaleContext } from '../../lib/i18n'
import { CategoryTabs } from './category-tabs'

let swrCategoriesData: { categories: Array<{ id: number; name: string }> } | undefined
let swrFeedsData: { feeds: Array<{ category_id: number | null; unread_count: number }> } | undefined

vi.mock('swr', () => ({
  default: (key: string) => {
    if (key === '/api/categories') return { data: swrCategoriesData }
    if (key === '/api/feeds') return { data: swrFeedsData }
    return { data: undefined }
  },
}))

vi.mock('../../lib/fetcher', () => ({
  fetcher: vi.fn(),
}))

function renderTabs(initialPath = '/inbox') {
  return render(
    <LocaleContext.Provider value={{ locale: 'en', setLocale: vi.fn() }}>
      <MemoryRouter initialEntries={[initialPath]}>
        <CategoryTabs />
      </MemoryRouter>
    </LocaleContext.Provider>,
  )
}

describe('CategoryTabs', () => {
  beforeEach(() => {
    swrCategoriesData = {
      categories: [
        { id: 1, name: '3D' },
        { id: 2, name: 'BD' },
      ],
    }
    swrFeedsData = {
      feeds: [
        { category_id: 1, unread_count: 5 },
        { category_id: 1, unread_count: 2 },
        { category_id: 2, unread_count: 0 },
        { category_id: null, unread_count: 3 },
      ],
    }
  })

  it('renders nothing while categories are loading', () => {
    swrCategoriesData = undefined
    const { container } = renderTabs()
    expect(container.querySelector('nav')).toBeNull()
  })

  it('renders nothing when there are no categories', () => {
    swrCategoriesData = { categories: [] }
    const { container } = renderTabs()
    expect(container.querySelector('nav')).toBeNull()
  })

  it('renders an inbox tab and one tab per category', () => {
    renderTabs()
    expect(screen.getByRole('link', { name: /Inbox/ }).getAttribute('href')).toBe('/inbox')
    expect(screen.getByRole('link', { name: /3D/ }).getAttribute('href')).toBe('/categories/1')
    expect(screen.getByRole('link', { name: /BD/ }).getAttribute('href')).toBe('/categories/2')
  })

  it('shows unread counts per category and the total on the inbox tab', () => {
    renderTabs()
    expect(screen.getByRole('link', { name: /Inbox/ }).textContent).toBe('Inbox10')
    expect(screen.getByRole('link', { name: /3D/ }).textContent).toBe('3D7')
    // Zero counts are hidden
    expect(screen.getByRole('link', { name: /BD/ }).textContent).toBe('BD')
  })

  it('renders without counts while feeds are loading', () => {
    swrFeedsData = undefined
    renderTabs()
    expect(screen.getByRole('link', { name: /Inbox/ }).textContent).toBe('Inbox')
  })

  it('marks the active category tab', () => {
    renderTabs('/categories/2')
    expect(screen.getByRole('link', { name: /BD/ }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('link', { name: /3D/ }).getAttribute('aria-current')).toBeNull()
    expect(screen.getByRole('link', { name: /Inbox/ }).getAttribute('aria-current')).toBeNull()
  })

  it('marks the inbox tab active only on /inbox', () => {
    renderTabs('/inbox')
    expect(screen.getByRole('link', { name: /Inbox/ }).getAttribute('aria-current')).toBe('page')
  })
})
