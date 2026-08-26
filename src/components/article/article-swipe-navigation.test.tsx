import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import { KeyboardNavigationProvider } from '../../contexts/keyboard-navigation-context'
import { ArticleSwipeNavigation } from './article-swipe-navigation'

vi.mock('../../lib/url', () => ({
  articleUrlToPath: (url: string) => `/articles/${encodeURIComponent(url)}`,
}))

const mockExtendList = vi.fn()
vi.mock('../../hooks/use-extend-article-list', () => ({
  useExtendArticleList: () => mockExtendList,
}))

function LocationProbe() {
  const location = useLocation()
  return <div data-testid="pathname">{location.pathname}</div>
}

function renderSwipeNav(currentArticleId: string) {
  return render(
    <KeyboardNavigationProvider>
      <MemoryRouter initialEntries={['/current']}>
        <ArticleSwipeNavigation currentArticleId={currentArticleId} />
        <Routes>
          <Route path="*" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>
    </KeyboardNavigationProvider>,
  )
}

function dispatchTouch(type: 'touchstart' | 'touchend', x: number, y: number) {
  const event = new Event(type, { bubbles: true }) as Event & {
    touches: Array<{ clientX: number; clientY: number }>
    changedTouches: Array<{ clientX: number; clientY: number }>
  }
  event.touches = [{ clientX: x, clientY: y }]
  event.changedTouches = [{ clientX: x, clientY: y }]
  act(() => {
    document.dispatchEvent(event)
  })
}

function swipe(fromX: number, toX: number, fromY = 300, toY = 300) {
  dispatchTouch('touchstart', fromX, fromY)
  dispatchTouch('touchend', toX, toY)
}

describe('ArticleSwipeNavigation', () => {
  beforeEach(() => {
    mockExtendList.mockReset()
    mockExtendList.mockResolvedValue(null)
    sessionStorage.setItem('kb_article_ids', JSON.stringify(['1', '2', '3']))
    sessionStorage.setItem('kb_article_urls', JSON.stringify({
      '1': 'https://a.com/one',
      '2': 'https://b.com/two',
      '3': 'https://c.com/three',
    }))
  })

  it('navigates to the next article on left swipe', () => {
    renderSwipeNav('2')
    swipe(300, 100)
    expect(screen.getByTestId('pathname').textContent).toBe(`/articles/${encodeURIComponent('https://c.com/three')}`)
  })

  it('navigates to the previous article on right swipe', () => {
    renderSwipeNav('2')
    swipe(100, 300)
    expect(screen.getByTestId('pathname').textContent).toBe(`/articles/${encodeURIComponent('https://a.com/one')}`)
  })

  it('stays put when swiping past the start of the list', () => {
    renderSwipeNav('1')
    swipe(100, 300)
    expect(screen.getByTestId('pathname').textContent).toBe('/current')
  })

  it('ignores mostly-vertical swipes', () => {
    renderSwipeNav('2')
    swipe(300, 200, 100, 400)
    expect(screen.getByTestId('pathname').textContent).toBe('/current')
  })

  it('ignores swipes below the distance threshold', () => {
    renderSwipeNav('2')
    swipe(300, 260)
    expect(screen.getByTestId('pathname').textContent).toBe('/current')
  })

  it('ignores swipes starting at the left screen edge', () => {
    renderSwipeNav('2')
    swipe(10, 300)
    expect(screen.getByTestId('pathname').textContent).toBe('/current')
  })

  it('navigates with arrow keys', () => {
    renderSwipeNav('2')
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    })
    expect(screen.getByTestId('pathname').textContent).toBe(`/articles/${encodeURIComponent('https://c.com/three')}`)
  })

  describe('day divider', () => {
    // 2 and 3 are published on different days, 1 and 2 on the same one
    beforeEach(() => {
      sessionStorage.setItem('kb_article_dates', JSON.stringify({
        '1': '2026-08-23T20:00:00Z',
        '2': '2026-08-23T09:00:00Z',
        '3': '2026-08-22T23:00:00Z',
      }))
    })

    function pressArrow(key: 'ArrowRight' | 'ArrowLeft') {
      act(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
      })
    }

    it('stops on a divider instead of crossing into another day', () => {
      renderSwipeNav('2')
      pressArrow('ArrowRight')
      expect(screen.getByRole('separator')).toBeTruthy()
      expect(screen.getByTestId('pathname').textContent).toBe('/current')
    })

    it('continues to the article when the same direction repeats', () => {
      renderSwipeNav('2')
      pressArrow('ArrowRight')
      pressArrow('ArrowRight')
      expect(screen.queryByRole('separator')).toBeNull()
      expect(screen.getByTestId('pathname').textContent).toBe(`/articles/${encodeURIComponent('https://c.com/three')}`)
    })

    it('backs out of the divider on the opposite direction', () => {
      renderSwipeNav('2')
      pressArrow('ArrowRight')
      pressArrow('ArrowLeft')
      expect(screen.queryByRole('separator')).toBeNull()
      expect(screen.getByTestId('pathname').textContent).toBe('/current')
    })

    it('dismisses the divider on Escape', () => {
      renderSwipeNav('2')
      pressArrow('ArrowRight')
      act(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      })
      expect(screen.queryByRole('separator')).toBeNull()
      expect(screen.getByTestId('pathname').textContent).toBe('/current')
    })

    it('crosses within the same day without a divider', () => {
      renderSwipeNav('2')
      pressArrow('ArrowLeft')
      expect(screen.queryByRole('separator')).toBeNull()
      expect(screen.getByTestId('pathname').textContent).toBe(`/articles/${encodeURIComponent('https://a.com/one')}`)
    })

    it('raises no divider when a publication date is missing', () => {
      sessionStorage.setItem('kb_article_dates', JSON.stringify({ '2': '2026-08-23T09:00:00Z', '3': null }))
      renderSwipeNav('2')
      pressArrow('ArrowRight')
      expect(screen.queryByRole('separator')).toBeNull()
      expect(screen.getByTestId('pathname').textContent).toBe(`/articles/${encodeURIComponent('https://c.com/three')}`)
    })

    it('continues on a swipe in the same direction', () => {
      renderSwipeNav('2')
      swipe(300, 100)
      expect(screen.getByRole('separator')).toBeTruthy()
      swipe(300, 100)
      expect(screen.getByTestId('pathname').textContent).toBe(`/articles/${encodeURIComponent('https://c.com/three')}`)
    })
  })

  it('does nothing when the current article is not in the list', () => {
    renderSwipeNav('99')
    swipe(300, 100)
    expect(screen.getByTestId('pathname').textContent).toBe('/current')
  })

  it('extends the list and navigates when swiping next at the end of the loaded list', async () => {
    mockExtendList.mockResolvedValue({
      ids: ['1', '2', '3', '4'],
      urls: {
        '1': 'https://a.com/one',
        '2': 'https://b.com/two',
        '3': 'https://c.com/three',
        '4': 'https://d.com/four',
      },
      dates: {
        '1': '2026-08-23T09:00:00Z',
        '2': '2026-08-23T08:00:00Z',
        '3': '2026-08-23T07:00:00Z',
        '4': '2026-08-23T06:00:00Z',
      },
    })
    renderSwipeNav('3')
    swipe(300, 100)
    expect(mockExtendList).toHaveBeenCalled()
    await vi.waitFor(() => {
      expect(screen.getByTestId('pathname').textContent).toBe(`/articles/${encodeURIComponent('https://d.com/four')}`)
    })
  })

  it('stays put at the end of the list when there is nothing left to load', async () => {
    renderSwipeNav('3')
    swipe(300, 100)
    expect(mockExtendList).toHaveBeenCalled()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(screen.getByTestId('pathname').textContent).toBe('/current')
  })

  it('prefetches more of the list when navigating near the end', () => {
    renderSwipeNav('2')
    swipe(300, 100)
    // Navigated to article 3 (last loaded) — within the near-end threshold
    expect(mockExtendList).toHaveBeenCalled()
  })
})
