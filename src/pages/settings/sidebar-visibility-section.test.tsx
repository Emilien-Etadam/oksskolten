import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { LocaleContext } from '../../lib/i18n'
import { SidebarVisibilitySection } from './sidebar-visibility-section'
import { isSidebarHidden } from '../../hooks/use-hide-sidebar'

const mockSetSidebarOpen = vi.fn()

vi.mock('../../app', () => ({
  useAppLayout: () => ({ setSidebarOpen: mockSetSidebarOpen }),
}))

function renderSection() {
  return render(
    <LocaleContext.Provider value={{ locale: 'en', setLocale: vi.fn() }}>
      <SidebarVisibilitySection />
    </LocaleContext.Provider>,
  )
}

describe('SidebarVisibilitySection', () => {
  beforeEach(() => {
    localStorage.removeItem('hide-sidebar')
    mockSetSidebarOpen.mockClear()
  })

  it('defaults to visible', () => {
    renderSection()
    expect((screen.getByRole('radio', { name: 'Visible' }) as HTMLInputElement).checked).toBe(true)
    expect(isSidebarHidden()).toBe(false)
  })

  it('persists hiding the sidebar and closes it immediately', () => {
    renderSection()
    fireEvent.click(screen.getByRole('radio', { name: 'Hidden' }))
    expect(isSidebarHidden()).toBe(true)
    expect(mockSetSidebarOpen).toHaveBeenCalledWith(false)
  })

  it('restores the stored value on mount', () => {
    localStorage.setItem('hide-sidebar', 'on')
    renderSection()
    expect((screen.getByRole('radio', { name: 'Hidden' }) as HTMLInputElement).checked).toBe(true)
  })
})
