import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ArticleContext, EnrichStep } from './steps/types.js'
import type { FetchedContent } from './fetch-content.js'

const { mockWarn } = vi.hoisted(() => ({ mockWarn: vi.fn() }))

vi.mock('../logger.js', () => ({
  logger: {
    child: () => ({
      warn: mockWarn,
      info: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
    }),
  },
}))

import { enrichArticle } from './pipeline.js'

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

function ctx(overrides: Partial<ArticleContext> = {}): ArticleContext {
  return {
    articleId: 1,
    kind: 'new',
    feedId: 10,
    title: 'Hello',
    url: 'https://example.com/a',
    publishedAt: '2024-01-01T00:00:00Z',
    content: content(),
    lang: 'en',
    ...overrides,
  }
}

describe('enrichArticle', () => {
  beforeEach(() => {
    mockWarn.mockReset()
  })

  it('runs steps in array order', async () => {
    const order: string[] = []
    const steps: EnrichStep[] = [
      { name: 'a', run: () => { order.push('a') } },
      { name: 'b', run: () => { order.push('b') } },
      { name: 'c', run: () => { order.push('c') } },
    ]

    await enrichArticle(ctx(), steps)

    expect(order).toEqual(['a', 'b', 'c'])
  })

  it('skips steps whose appliesTo does not include the task kind', async () => {
    const order: string[] = []
    const steps: EnrichStep[] = [
      { name: 'new-only', appliesTo: ['new'], run: () => { order.push('new-only') } },
      { name: 'retry-only', appliesTo: ['retry'], run: () => { order.push('retry-only') } },
      { name: 'all', run: () => { order.push('all') } },
    ]

    await enrichArticle(ctx({ kind: 'new' }), steps)
    expect(order).toEqual(['new-only', 'all'])

    order.length = 0
    await enrichArticle(ctx({ kind: 'retry' }), steps)
    expect(order).toEqual(['retry-only', 'all'])
  })

  it('logs a throwing step and continues with the next one', async () => {
    const order: string[] = []
    const boom = new Error('nope')
    const steps: EnrichStep[] = [
      { name: 'boom', run: () => { throw boom } },
      { name: 'after', run: () => { order.push('after') } },
    ]

    await enrichArticle(ctx({ articleId: 42 }), steps)

    expect(order).toEqual(['after'])
    expect(mockWarn).toHaveBeenCalledWith({ step: 'boom', articleId: 42 }, boom)
  })

  it('does not await a background step and logs its rejection', async () => {
    const order: string[] = []
    let rejectBg!: (err: Error) => void
    const bgError = new Error('bg fail')
    const steps: EnrichStep[] = [
      {
        name: 'bg',
        background: true,
        run: () => new Promise((_, reject) => { rejectBg = reject }),
      },
      { name: 'next', run: () => { order.push('next') } },
    ]

    await enrichArticle(ctx({ articleId: 9 }), steps)

    expect(order).toEqual(['next'])
    expect(mockWarn).not.toHaveBeenCalled()

    rejectBg(bgError)
    await vi.waitFor(() => {
      expect(mockWarn).toHaveBeenCalledWith({ step: 'bg', articleId: 9 }, bgError)
    })
  })
})
