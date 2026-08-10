import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetSetting = vi.fn()
const mockGetArticleById = vi.fn()
const mockUpdateArticleContent = vi.fn()
const mockUpdateScore = vi.fn()
const mockTranslateArticle = vi.fn()
const mockTranslateTitle = vi.fn()
const mockSummarizeArticle = vi.fn()
const mockEvaluateRelevance = vi.fn()
const mockGetFeedById = vi.fn()
const mockDbAll = vi.fn()

vi.mock('../db.js', () => ({
  getSetting: (key: string) => mockGetSetting(key),
}))

vi.mock('../db/connection.js', () => ({
  getDb: () => ({
    prepare: () => ({ all: (...args: unknown[]) => mockDbAll(...args) }),
  }),
}))

vi.mock('../db/articles.js', () => ({
  getArticleById: (id: number) => mockGetArticleById(id),
  updateArticleContent: (id: number, fields: unknown) => mockUpdateArticleContent(id, fields),
  updateScore: (id: number) => mockUpdateScore(id),
}))

vi.mock('../db/feeds.js', () => ({
  getFeedById: (id: number) => mockGetFeedById(id),
}))

vi.mock('./ai.js', () => ({
  translateArticle: (fullText: string, options?: unknown) => mockTranslateArticle(fullText, options),
  translateTitle: (title: string, options?: unknown) => mockTranslateTitle(title, options),
  summarizeArticle: (fullText: string, options?: unknown) => mockSummarizeArticle(fullText, options),
  evaluateArticleRelevance: (text: string, criterion: string, options?: unknown) =>
    mockEvaluateRelevance(text, criterion, options),
}))

import {
  enqueueAiFilter,
  enqueueAutoTranslate,
  enqueueAutoSummarize,
  isAutoTranslateEnabled,
  isAutoSummarizeEnabled,
  resumePendingAiTasks,
  translateArticleTitle,
  _resetAiQueueForTests,
} from './ai-queue.js'

function settings(map: Record<string, string>) {
  mockGetSetting.mockImplementation((key: string) => map[key] ?? null)
}

/** Queue processing is fire-and-forget; yield a few macrotasks so it settles. */
async function flushQueue() {
  for (let i = 0; i < 6; i++) {
    await new Promise(resolve => setTimeout(resolve, 0))
  }
}

/** All updateArticleContent payloads for a given article id, merged. */
function updatesFor(id: number): Record<string, unknown> {
  return Object.assign({}, ...mockUpdateArticleContent.mock.calls
    .filter(call => call[0] === id)
    .map(call => call[1] as Record<string, unknown>))
}

describe('ai-queue', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    _resetAiQueueForTests()
    settings({
      'reading.auto_translate': 'on',
      'reading.auto_summarize': 'on',
      'translate.target_lang': 'fr',
    })
    mockGetArticleById.mockReturnValue({
      id: 1,
      title: 'Original title',
      title_translated: null,
      full_text: 'Full english text',
      full_text_translated: null,
      translated_lang: null,
      summary: null,
      lang: 'en',
    })
    mockTranslateArticle.mockResolvedValue({ fullTextTranslated: 'Texte traduit' })
    mockTranslateTitle.mockResolvedValue({ titleTranslated: 'Titre traduit' })
    mockSummarizeArticle.mockResolvedValue({ summary: 'Un résumé' })
    mockDbAll.mockReturnValue([])
  })

  it('flags reflect the settings', () => {
    expect(isAutoTranslateEnabled()).toBe(true)
    expect(isAutoSummarizeEnabled()).toBe(true)
    settings({})
    expect(isAutoTranslateEnabled()).toBe(false)
    expect(isAutoSummarizeEnabled()).toBe(false)
  })

  it('marks translate pending on enqueue and clears it on success', async () => {
    enqueueAutoTranslate(1, 'Full english text')
    await flushQueue()

    const first = mockUpdateArticleContent.mock.calls[0]
    expect(first[0]).toBe(1)
    expect((first[1] as { translate_pending_at: string }).translate_pending_at).toBeTruthy()

    const merged = updatesFor(1)
    expect(merged.full_text_translated).toBe('Texte traduit')
    expect(merged.translated_lang).toBe('fr')
    expect(merged.title_translated).toBe('Titre traduit')
    expect(merged.translate_pending_at).toBeNull()
    expect(mockTranslateArticle).toHaveBeenCalledWith('Full english text', { provider: 'vllm' })
    expect(mockTranslateTitle).toHaveBeenCalledWith('Original title', { provider: 'vllm' })
  })

  it('keeps the body translation when the title translation fails', async () => {
    mockTranslateTitle.mockRejectedValue(new Error('title boom'))
    enqueueAutoTranslate(1, 'Full english text')
    await flushQueue()

    const merged = updatesFor(1)
    expect(merged.full_text_translated).toBe('Texte traduit')
    expect(merged.title_translated).toBeNull()
    expect(merged.translate_pending_at).toBeNull()
  })

  it('refreshes the pending marker when translation fails', async () => {
    mockTranslateArticle.mockRejectedValue(new Error('vLLM unreachable'))
    enqueueAutoTranslate(1, 'Full english text')
    await flushQueue()

    const merged = updatesFor(1)
    expect(merged.full_text_translated).toBeUndefined()
    expect(merged.translate_pending_at).toBeTruthy()
  })

  it('summarizes via the vllm provider and clears the marker', async () => {
    enqueueAutoSummarize(1, 'Full english text')
    await flushQueue()

    expect(mockSummarizeArticle).toHaveBeenCalledWith('Full english text', { provider: 'vllm' })
    const merged = updatesFor(1)
    expect(merged.summary).toBe('Un résumé')
    expect(merged.summarize_pending_at).toBeNull()
  })

  it('skips summarize when the article already has a summary', async () => {
    mockGetArticleById.mockReturnValue({
      id: 1, title: 't', title_translated: null, full_text: 'text',
      full_text_translated: null, translated_lang: null, summary: 'Existing', lang: 'en',
    })
    enqueueAutoSummarize(1, 'text')
    await flushQueue()
    expect(mockSummarizeArticle).not.toHaveBeenCalled()
    expect(updatesFor(1).summarize_pending_at).toBeNull()
  })

  it('does nothing when the settings are off', async () => {
    settings({})
    enqueueAutoTranslate(1, 'text')
    enqueueAutoSummarize(1, 'text')
    await flushQueue()
    expect(mockTranslateArticle).not.toHaveBeenCalled()
    expect(mockSummarizeArticle).not.toHaveBeenCalled()
  })

  it('resumes stale pending markers from the database', async () => {
    const stale = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    mockDbAll.mockReturnValue([
      { id: 1, translate_pending_at: stale, summarize_pending_at: null },
      { id: 2, translate_pending_at: null, summarize_pending_at: stale },
    ])
    mockGetArticleById.mockImplementation((id: number) => ({
      id, title: 't', title_translated: null, full_text: 'text',
      full_text_translated: null, translated_lang: null, summary: null, lang: 'en',
    }))

    resumePendingAiTasks()
    await flushQueue()

    expect(mockTranslateArticle).toHaveBeenCalledTimes(1)
    expect(mockSummarizeArticle).toHaveBeenCalledTimes(1)
  })

  it('resumes nothing but the filter when translate and summarize are off', async () => {
    // The filter has no global toggle — it runs per feed — so the resume pass
    // still scans, but must not re-enqueue translate/summarize work.
    settings({})
    mockDbAll.mockReturnValue([
      { id: 1, translate_pending_at: '2020-01-01T00:00:00Z', summarize_pending_at: '2020-01-01T00:00:00Z', filter_pending_at: null },
    ])
    resumePendingAiTasks()
    await flushQueue()

    expect(mockTranslateArticle).not.toHaveBeenCalled()
    expect(mockSummarizeArticle).not.toHaveBeenCalled()
  })

  it('translateArticleTitle stores the translated title with the configured provider', async () => {
    translateArticleTitle(1)
    await flushQueue()

    expect(mockTranslateTitle).toHaveBeenCalledWith('Original title', undefined)
    expect(updatesFor(1).title_translated).toBe('Titre traduit')
  })

  it('deduplicates items already pending', async () => {
    let resolveTranslate: (v: { fullTextTranslated: string }) => void
    mockTranslateArticle.mockImplementation(() => new Promise(resolve => { resolveTranslate = resolve }))
    enqueueAutoTranslate(1, 'text')
    enqueueAutoTranslate(1, 'text')
    resolveTranslate!({ fullTextTranslated: 'Texte traduit' })
    await flushQueue()
    expect(mockTranslateArticle).toHaveBeenCalledTimes(1)
  })

  describe('ai filter', () => {
    beforeEach(() => {
      mockGetArticleById.mockReturnValue({
        id: 1,
        feed_id: 7,
        title: 'A post title',
        summary: null,
        full_text: 'Body of the post',
        excerpt: null,
        filtered_at: null,
      })
      mockGetFeedById.mockReturnValue({ id: 7, ai_filter: 'self-hosting only' })
    })

    it('does nothing when the feed has no criterion', async () => {
      mockGetFeedById.mockReturnValue({ id: 7, ai_filter: null })
      enqueueAiFilter(1, 7)
      await flushQueue()
      expect(mockEvaluateRelevance).not.toHaveBeenCalled()
    })

    it('leaves a matching article visible', async () => {
      mockEvaluateRelevance.mockResolvedValue({ keep: true })
      enqueueAiFilter(1, 7)
      await flushQueue()

      expect(mockEvaluateRelevance).toHaveBeenCalledWith(
        expect.stringContaining('A post title'),
        'self-hosting only',
        { provider: 'vllm' },
      )
      expect(updatesFor(1).filtered_at).toBeUndefined()
      expect(updatesFor(1).filter_pending_at).toBeNull()
    })

    it('hides a rejected article without deleting it', async () => {
      mockEvaluateRelevance.mockResolvedValue({ keep: false })
      enqueueAiFilter(1, 7)
      await flushQueue()

      expect(updatesFor(1).filtered_at).toEqual(expect.any(String))
    })

    it('keeps the pending marker when the model call fails, for a later retry', async () => {
      mockEvaluateRelevance.mockRejectedValue(new Error('vllm down'))
      enqueueAiFilter(1, 7)
      await flushQueue()

      expect(updatesFor(1).filter_pending_at).toEqual(expect.any(String))
      expect(updatesFor(1).filtered_at).toBeUndefined()
    })
  })
})
