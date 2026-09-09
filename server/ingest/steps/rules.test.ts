import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ArticleContext } from './types.js'
import type { FetchedContent } from '../fetch-content.js'

const { mockApplyRulesToArticle } = vi.hoisted(() => ({
  mockApplyRulesToArticle: vi.fn(),
}))

vi.mock('../../intelligence/index.js', () => ({
  applyRulesToArticle: mockApplyRulesToArticle,
}))

import { rules } from './rules.js'

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

describe('rules step', () => {
  beforeEach(() => {
    mockApplyRulesToArticle.mockClear()
  })

  it('applies feed rules for new articles and does not apply to retry', () => {
    expect(rules.appliesTo).toEqual(['new', 'clip'])

    rules.run(ctx('new'))
    expect(mockApplyRulesToArticle).toHaveBeenCalledWith(7, 3, {
      title: 'Hello',
      url: 'https://example.com/x',
      content: 'body',
    })

    expect(rules.appliesTo?.includes('retry')).toBe(false)
  })
})
