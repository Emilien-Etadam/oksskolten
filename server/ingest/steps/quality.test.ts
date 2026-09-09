import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ArticleContext } from './types.js'
import type { FetchedContent } from '../fetch-content.js'

const { mockSetArticleQuality, mockScoreArticleQuality } = vi.hoisted(() => ({
  mockSetArticleQuality: vi.fn(),
  mockScoreArticleQuality: vi.fn(() => ({ score: 0.42, flags: [] })),
}))

vi.mock('../../db.js', () => ({
  setArticleQuality: mockSetArticleQuality,
}))

vi.mock('../../quality.js', () => ({
  scoreArticleQuality: mockScoreArticleQuality,
}))

import { quality } from './quality.js'

function content(overrides: Partial<FetchedContent> = {}): FetchedContent {
  return {
    fullText: 'body',
    ogImage: null,
    excerpt: null,
    lang: 'en',
    lastError: null,
    title: null,
    ...overrides,
  }
}

function ctx(kind: ArticleContext['kind'], overrides: Partial<ArticleContext> = {}): ArticleContext {
  return {
    articleId: 7,
    kind,
    feedId: 3,
    title: 'Title',
    url: 'https://example.com/x',
    publishedAt: '2024-06-01T00:00:00Z',
    content: content(),
    lang: 'en',
    ...overrides,
  }
}

describe('quality step', () => {
  beforeEach(() => {
    mockSetArticleQuality.mockClear()
    mockScoreArticleQuality.mockClear()
    mockScoreArticleQuality.mockReturnValue({ score: 0.42, flags: [] })
  })

  it('always scores new articles and scores retry only when a body is present', () => {
    expect(quality.appliesTo).toEqual(['new', 'retry', 'clip'])

    quality.run(ctx('new', { content: content({ fullText: null }) }))
    expect(mockScoreArticleQuality).toHaveBeenCalledWith({
      title: 'Title',
      text: null,
      url: 'https://example.com/x',
    })
    expect(mockSetArticleQuality).toHaveBeenCalledWith(7, 0.42)

    mockSetArticleQuality.mockClear()
    mockScoreArticleQuality.mockClear()

    quality.run(ctx('retry', { content: content({ fullText: null }) }))
    expect(mockScoreArticleQuality).not.toHaveBeenCalled()
    expect(mockSetArticleQuality).not.toHaveBeenCalled()

    quality.run(ctx('retry', {
      title: 'Retry title',
      url: 'https://example.com/r',
      content: content({ fullText: 'repaired' }),
    }))
    expect(mockScoreArticleQuality).toHaveBeenCalledWith({
      title: 'Retry title',
      text: 'repaired',
      url: 'https://example.com/r',
    })
    expect(mockSetArticleQuality).toHaveBeenCalledWith(7, 0.42)
  })
})
