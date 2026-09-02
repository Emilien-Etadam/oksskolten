import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { LocaleContext } from '../../lib/i18n'
import { ArticleRawPage, commentsToMarkdown } from './article-raw-page'
import type { ArticleComment } from './article-comments'

let mockData: Record<string, unknown>

vi.mock('swr', () => ({
  default: (key: string | null) => ({ data: key ? mockData[key] : undefined }),
}))

function renderPage(articleUrl: string) {
  return render(
    <LocaleContext.Provider value={{ locale: 'en', setLocale: vi.fn() }}>
      <ArticleRawPage articleUrl={articleUrl} />
    </LocaleContext.Provider>,
  )
}

describe('commentsToMarkdown', () => {
  it('serializes comments with nested replies as blockquotes', () => {
    const comments: ArticleComment[] = [
      {
        author: 'alice', score: 42, body: 'Great **post**',
        replies: [{ author: 'bob', score: 7, body: 'Agreed', replies: [] }],
      },
    ]
    expect(commentsToMarkdown(comments, 'Comments')).toBe([
      '', '---', '', '## Comments',
      '', '**alice** · ↑42', '',
      'Great **post**',
      '>', '> **bob** · ↑7', '>',
      '> Agreed',
      '',
    ].join('\n'))
  })
})

describe('ArticleRawPage', () => {
  beforeEach(() => {
    mockData = {}
  })

  it('renders the article markdown alone for non-reddit articles', () => {
    const url = 'https://example.com/post'
    mockData[`/api/articles/by-url?url=${encodeURIComponent(url)}`] = { id: 5, full_text: '# Hello' }

    renderPage(url)
    expect(screen.getByText(/# Hello/)).toBeTruthy()
    expect(screen.queryByText(/## Comments/)).toBeNull()
  })

  it('appends the comment thread for reddit articles', () => {
    const url = 'https://www.reddit.com/r/LocalLLM/comments/abc/post/'
    mockData[`/api/articles/by-url?url=${encodeURIComponent(url)}`] = { id: 5, full_text: 'Body text' }
    mockData['/api/articles/5/comments'] = {
      comments: [{ author: 'alice', score: 3, body: 'Nice', replies: [] }],
    }

    renderPage(url)
    const pre = screen.getByText(/Body text/)
    expect(pre.textContent).toContain('## Comments')
    expect(pre.textContent).toContain('**alice** · ↑3')
    expect(pre.textContent).toContain('Nice')
  })
})
