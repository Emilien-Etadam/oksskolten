import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import { LocaleContext } from '../../lib/i18n'
import { BottomNav } from './bottom-nav'

let mockSidebarOpen = false
const mockSetSidebarOpen = vi.fn()

vi.mock('../../app', () => ({
  useAppLayout: () => ({ sidebarOpen: mockSidebarOpen, setSidebarOpen: mockSetSidebarOpen }),
}))

vi.mock('../ui/search-dialog', () => ({
  SearchDialog: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="search-dialog">
      <button onClick={onClose}>close</button>
    </div>
  ),
}))

function LocationProbe() {
  const location = useLocation()
  return <div data-testid="pathname">{location.pathname}</div>
}

function renderNav(initialPath = '/inbox') {
  return render(
    <LocaleContext.Provider value={{ locale: 'en', setLocale: vi.fn() }}>
      <MemoryRouter initialEntries={[initialPath]}>
        <BottomNav />
        <Routes>
          <Route path="*" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>
    </LocaleContext.Provider>,
  )
}

describe('BottomNav', () => {
  beforeEach(() => {
    mockSidebarOpen = false
    mockSetSidebarOpen.mockClear()
  })

  it('renders the five tabs', () => {
    renderNav()
    for (const label of ['Inbox', 'Search', 'Read Later', 'Chat', 'Menu']) {
      expect(screen.getByRole('button', { name: label })).toBeTruthy()
    }
  })

  it('renders nothing when the sidebar is open', () => {
    mockSidebarOpen = true
    renderNav()
    expect(screen.queryByRole('button', { name: 'Inbox' })).toBeNull()
  })

  it('renders nothing on the chat page', () => {
    renderNav('/chat')
    expect(screen.queryByRole('button', { name: 'Inbox' })).toBeNull()
  })

  it('navigates when a destination tab is clicked', () => {
    renderNav('/inbox')
    fireEvent.click(screen.getByRole('button', { name: 'Read Later' }))
    expect(screen.getByTestId('pathname').textContent).toBe('/bookmarks')
  })

  it('highlights the active destination', () => {
    renderNav('/bookmarks')
    expect(screen.getByRole('button', { name: 'Read Later' }).className).toContain('text-accent')
    expect(screen.getByRole('button', { name: 'Inbox' }).className).not.toContain('text-accent')
  })

  it('opens the search dialog from the search tab', () => {
    renderNav()
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    expect(screen.getByTestId('search-dialog')).toBeTruthy()
  })

  it('opens the sidebar from the menu tab', () => {
    renderNav()
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }))
    expect(mockSetSidebarOpen).toHaveBeenCalledWith(true)
  })
})
