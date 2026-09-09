import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ArticleContext } from './types.js'
import type { FetchedContent } from '../fetch-content.js'

const {
  mockEnqueueAutoTranslate,
  mockEnqueueAutoSummarize,
  mockIsAutoTranslateEnabled,
  mockIsAutoSummarizeEnabled,
  mockGetSetting,
} = vi.hoisted(() => ({
  mockEnqueueAutoTranslate: vi.fn(),
  mockEnqueueAutoSummarize: vi.fn(),
  mockIsAutoTranslateEnabled: vi.fn(),
  mockIsAutoSummarizeEnabled: vi.fn(),
  mockGetSetting: vi.fn(),
}))

vi.mock('../../fetcher/ai-queue.js', () => ({
  enqueueAutoTranslate: mockEnqueueAutoTranslate,
  enqueueAutoSummarize: mockEnqueueAutoSummarize,
  isAutoTranslateEnabled: mockIsAutoTranslateEnabled,
  isAutoSummarizeEnabled: mockIsAutoSummarizeEnabled,
}))

vi.mock('../../db.js', () => ({
  getSetting: mockGetSetting,
}))

import { aiQueue } from './ai-queue.js'

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
    title: 'Hello',
    url: 'https://example.com/x',
    publishedAt: '2024-06-01T00:00:00Z',
    content: content(),
    lang: 'de',
    ...overrides,
  }
}

describe('ai-queue step', () => {
  beforeEach(() => {
    mockEnqueueAutoTranslate.mockClear()
    mockEnqueueAutoSummarize.mockClear()
    mockIsAutoTranslateEnabled.mockReturnValue(true)
    mockIsAutoSummarizeEnabled.mockReturnValue(true)
    mockGetSetting.mockImplementation((key: string) => {
      if (key === 'translate.target_lang') return 'fr'
      return null
    })
  })

  it('enqueues summarize and translate for new and retry when enabled', () => {
    expect(aiQueue.appliesTo).toEqual(['new', 'retry', 'clip'])

    aiQueue.run(ctx('new'))
    expect(mockEnqueueAutoSummarize).toHaveBeenCalledWith(7, 'body')
    expect(mockEnqueueAutoTranslate).toHaveBeenCalledWith(7, 'body')

    mockEnqueueAutoSummarize.mockClear()
    mockEnqueueAutoTranslate.mockClear()

    aiQueue.run(ctx('retry'))
    expect(mockEnqueueAutoSummarize).toHaveBeenCalledWith(7, 'body')
    expect(mockEnqueueAutoTranslate).toHaveBeenCalledWith(7, 'body')
  })

  it('skips translate when lang is missing, unknown, or already the target', () => {
    aiQueue.run(ctx('new', { lang: 'unknown' }))
    expect(mockEnqueueAutoSummarize).toHaveBeenCalled()
    expect(mockEnqueueAutoTranslate).not.toHaveBeenCalled()

    mockEnqueueAutoSummarize.mockClear()
    aiQueue.run(ctx('new', { lang: 'fr' }))
    expect(mockEnqueueAutoTranslate).not.toHaveBeenCalled()

    mockEnqueueAutoSummarize.mockClear()
    aiQueue.run(ctx('new', { content: content({ fullText: null }) }))
    expect(mockEnqueueAutoSummarize).not.toHaveBeenCalled()
    expect(mockEnqueueAutoTranslate).not.toHaveBeenCalled()
  })
})
