import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ArticleContext } from './types.js'
import type { FetchedContent } from '../fetch-content.js'

const { mockEnqueueClassify } = vi.hoisted(() => ({
  mockEnqueueClassify: vi.fn(),
}))

vi.mock('../../ai/index.js', () => ({
  enqueueClassify: mockEnqueueClassify,
}))

import { classify } from './classify.js'

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

describe('classify step', () => {
  beforeEach(() => {
    mockEnqueueClassify.mockClear()
  })

  it('applies to new and clipped articles, not to retries', () => {
    expect(classify.appliesTo).toEqual(['new', 'clip'])
  })

  it('enqueues the classification of the article', () => {
    classify.run(ctx('new'))
    expect(mockEnqueueClassify).toHaveBeenCalledWith(7)
  })
})
