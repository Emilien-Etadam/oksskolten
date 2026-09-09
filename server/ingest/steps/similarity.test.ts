import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ArticleContext } from './types.js'
import type { FetchedContent } from '../fetch-content.js'

const { mockDetect } = vi.hoisted(() => ({
  mockDetect: vi.fn(() => Promise.resolve()),
}))

vi.mock('../../similarity.js', () => ({
  detectAndStoreSimilarArticles: mockDetect,
}))

import { similarity } from './similarity.js'

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

describe('similarity step', () => {
  beforeEach(() => {
    mockDetect.mockClear()
    mockDetect.mockResolvedValue(undefined)
  })

  it('detects similar articles for new items in the background and does not apply to retry', async () => {
    expect(similarity.appliesTo).toEqual(['new', 'clip'])
    expect(similarity.background).toBe(true)

    await similarity.run(ctx('new'))
    expect(mockDetect).toHaveBeenCalledWith(
      7,
      'Hello',
      3,
      '2024-06-01T00:00:00Z',
      'https://example.com/x',
    )

    expect(similarity.appliesTo?.includes('retry')).toBe(false)
  })
})
