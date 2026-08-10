import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { LocaleContext } from '../../lib/i18n'
import { ArticleComments, hasCommentsProvider } from './article-comments'

let swrCommentsData: unknown
let swrIsLoading = false
const swrCalls: string[] = []

vi.mock('swr', () => ({
  default: (key: string | null) => {
    if (key) swrCalls.push(key)
    return { data: swrCommentsData, isLoading: swrIsLoading }
  },
}))

vi.mock('../../lib/fetcher', () => ({
  fetcher: vi.fn(),
}))

function renderComments(articleUrl: string) {
  return render(
    <LocaleContext.Provider value={{ locale: 'en', setLocale: vi.fn() }}>
      <ArticleComments articleId={7} articleUrl={articleUrl} />
    </LocaleContext.Provider>,
  )
}

describe('hasCommentsProvider', () => {
  it('detects reddit URLs on any subdomain', () => {
    expect(hasCommentsProvider('https://www.reddit.com/r/LocalLLM/comments/abc/post/')).toBe(true)
    expect(hasCommentsProvider('https://old.reddit.com/r/x/comments/1/t/')).toBe(true)
    expect(hasCommentsProvider('https://example.com/article')).toBe(false)
    expect(hasCommentsProvider('not a url')).toBe(false)
  })
})

describe('ArticleComments', () => {
  beforeEach(() => {
    swrCommentsData = undefined
    swrIsLoading = false
    swrCalls.length = 0
  })

  it('renders nothing for non-reddit articles and does not fetch', () => {
    const { container } = renderComments('https://example.com/article')
    expect(container.innerHTML).toBe('')
    expect(swrCalls).toHaveLength(0)
  })

  it('renders comments with markdown bodies and nested replies', () => {
    swrCommentsData = {
      provider: 'reddit',
      comments: [
        {
          author: 'alice', score: 42, body: 'Great **post**',
          replies: [{ author: 'bob', score: 7, body: 'Agreed', replies: [] }],
        },
      ],
    }
    renderComments('https://www.reddit.com/r/LocalLLM/comments/abc/post/')

    expect(screen.getByText('Comments')).toBeTruthy()
    expect(screen.getByText('alice')).toBeTruthy()
    expect(screen.getByText('42')).toBeTruthy()
    expect(screen.getByText('post').tagName).toBe('STRONG')
    expect(screen.getByText('bob')).toBeTruthy()
    expect(swrCalls[0]).toBe('/api/articles/7/comments')
  })

  it('renders nothing when the fetch returned no comments', () => {
    swrCommentsData = { provider: 'reddit', comments: [] }
    const { container } = renderComments('https://www.reddit.com/r/x/comments/1/t/')
    expect(container.innerHTML).toBe('')
  })

  it('shows a skeleton while loading', () => {
    swrIsLoading = true
    renderComments('https://www.reddit.com/r/x/comments/1/t/')
    expect(screen.getByText('Comments')).toBeTruthy()
  })
})
