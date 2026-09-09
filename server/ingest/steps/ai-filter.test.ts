import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ArticleContext } from './types.js'
import type { FetchedContent } from '../fetch-content.js'

const { mockEnqueueAiFilter } = vi.hoisted(() => ({
  mockEnqueueAiFilter: vi.fn(),
}))

vi.mock('../../ai/index.js', () => ({
  enqueueAiFilter: mockEnqueueAiFilter,
}))

import { aiFilter } from './ai-filter.js'

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

describe('ai-filter step', () => {
  beforeEach(() => {
    mockEnqueueAiFilter.mockClear()
  })

  it('enqueues the AI filter for new articles and does not apply to retry', () => {
    expect(aiFilter.appliesTo).toEqual(['new'])

    aiFilter.run(ctx('new'))
    expect(mockEnqueueAiFilter).toHaveBeenCalledWith(7, 3)

    expect(aiFilter.appliesTo?.includes('retry')).toBe(false)
    expect(aiFilter.appliesTo?.includes('clip')).toBe(false)
  })
})
