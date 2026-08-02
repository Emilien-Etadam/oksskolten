import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { LocaleContext } from '../../lib/i18n'
import { ArticleCard } from './article-card'
import type { ArticleListItem } from '../../../shared/types'

vi.mock('../../lib/readTracker', () => ({
  isReadInSession: vi.fn(() => false),
}))

const baseArticle = {
  id: 42,
  title: 'Un article',
  url: 'https://example.com/post',
  excerpt: null,
  og_image: null,
  published_at: '2026-08-01T10:00:00Z',
  seen_at: null,
} as unknown as ArticleListItem

function renderCard(article: ArticleListItem, onMarkRead?: (id: number) => void, onClick?: () => void) {
  return render(
    <LocaleContext.Provider value={{ locale: 'en', setLocale: vi.fn() }}>
      <MemoryRouter>
        <ArticleCard
          article={article}
          layout="list"
          dateMode="relative"
          indicatorStyle="dot"
          showUnreadIndicator
          showThumbnails
          onMarkRead={onMarkRead}
          onClick={onClick}
        />
      </MemoryRouter>
    </LocaleContext.Provider>,
  )
}

describe('MarkReadButton in article cards', () => {
  it('shows the button on unread articles and calls onMarkRead with the article id', () => {
    const onMarkRead = vi.fn()
    const onClick = vi.fn()
    renderCard(baseArticle, onMarkRead, onClick)
    fireEvent.click(screen.getByRole('button', { name: 'Mark as read' }))
    expect(onMarkRead).toHaveBeenCalledWith(42)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('hides the button on read articles', () => {
    renderCard({ ...baseArticle, seen_at: '2026-08-01T12:00:00Z' } as ArticleListItem, vi.fn())
    expect(screen.queryByRole('button', { name: 'Mark as read' })).toBeNull()
  })

  it('hides the button when no onMarkRead handler is provided', () => {
    renderCard(baseArticle)
    expect(screen.queryByRole('button', { name: 'Mark as read' })).toBeNull()
  })
})
