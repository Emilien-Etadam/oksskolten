import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ArticleContext } from './types.js'
import type { FetchedContent } from '../fetch-content.js'

const { mockScoreNewArticle } = vi.hoisted(() => ({
  mockScoreNewArticle: vi.fn(),
}))

vi.mock('../../interests.js', () => ({
  scoreNewArticle: mockScoreNewArticle,
}))

import { interests } from './interests.js'

function ctx(kind: ArticleContext['kind']): ArticleContext {
  return {
    articleId: 7,
    kind,
    feedId: 3,
    title: 'Hello',
    url: 'https://example.com/x',
    publishedAt: '2024-06-01T00:00:00Z',
    content: {
      fullText: 'body',
      ogImage: null,
      excerpt: null,
      lang: 'en',
      lastError: null,
      title: null,
    } satisfies FetchedContent,
    lang: 'en',
  }
}

describe('interests step', () => {
  beforeEach(() => {
    mockScoreNewArticle.mockClear()
  })

  it('scores new articles and does not apply to retry', () => {
    expect(interests.appliesTo).toEqual(['new'])

    interests.run(ctx('new'))
    expect(mockScoreNewArticle).toHaveBeenCalledWith(7, 'Hello')

    mockScoreNewArticle.mockClear()
    expect(interests.appliesTo?.includes('retry')).toBe(false)
    expect(mockScoreNewArticle).not.toHaveBeenCalled()
  })
})
