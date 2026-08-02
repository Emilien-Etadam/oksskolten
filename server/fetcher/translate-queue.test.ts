import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetSetting = vi.fn()
const mockGetArticleById = vi.fn()
const mockUpdateArticleContent = vi.fn()
const mockUpdateScore = vi.fn()
const mockTranslateArticle = vi.fn()

vi.mock('../db.js', () => ({
  getSetting: (key: string) => mockGetSetting(key),
}))

vi.mock('../db/articles.js', () => ({
  getArticleById: (id: number) => mockGetArticleById(id),
  updateArticleContent: (id: number, fields: unknown) => mockUpdateArticleContent(id, fields),
  updateScore: (id: number) => mockUpdateScore(id),
}))

vi.mock('./ai.js', () => ({
  translateArticle: (fullText: string, options?: unknown) => mockTranslateArticle(fullText, options),
}))

import { enqueueAutoTranslate, isAutoTranslateEnabled, _resetTranslateQueueForTests } from './translate-queue.js'

function settings(map: Record<string, string>) {
  mockGetSetting.mockImplementation((key: string) => map[key] ?? null)
}

/** Queue processing is fire-and-forget; yield a few macrotasks so it settles. */
async function flushQueue() {
  for (let i = 0; i < 5; i++) {
    await new Promise(resolve => setTimeout(resolve, 0))
  }
}

describe('translate-queue', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    _resetTranslateQueueForTests()
    settings({
      'reading.auto_translate': 'on',
      'translate.target_lang': 'fr',
    })
    mockGetArticleById.mockReturnValue({
      id: 1,
      full_text: 'Full english text',
      full_text_translated: null,
      translated_lang: null,
      lang: 'en',
    })
    mockTranslateArticle.mockResolvedValue({ fullTextTranslated: 'Texte traduit' })
  })

  it('isAutoTranslateEnabled reflects the setting', () => {
    expect(isAutoTranslateEnabled()).toBe(true)
    settings({ 'reading.auto_translate': 'off' })
    expect(isAutoTranslateEnabled()).toBe(false)
  })

  it('translates via the vllm provider and stores the result', async () => {
    enqueueAutoTranslate(1, 'Full english text')
    await flushQueue()

    expect(mockTranslateArticle).toHaveBeenCalledWith('Full english text', { provider: 'vllm' })
    expect(mockUpdateArticleContent).toHaveBeenCalledWith(1, {
      full_text_translated: 'Texte traduit',
      translated_lang: 'fr',
    })
    expect(mockUpdateScore).toHaveBeenCalledWith(1)
  })

  it('does nothing when auto-translate is off', async () => {
    settings({ 'reading.auto_translate': 'off' })
    enqueueAutoTranslate(1, 'Full english text')
    await flushQueue()
    expect(mockTranslateArticle).not.toHaveBeenCalled()
  })

  it('skips articles already translated to the target language', async () => {
    mockGetArticleById.mockReturnValue({
      id: 1,
      full_text: 'Full english text',
      full_text_translated: 'Déjà traduit',
      translated_lang: 'fr',
      lang: 'en',
    })
    enqueueAutoTranslate(1, 'Full english text')
    await flushQueue()
    expect(mockTranslateArticle).not.toHaveBeenCalled()
    expect(mockUpdateArticleContent).not.toHaveBeenCalled()
  })

  it('skips articles already in the target language', async () => {
    mockGetArticleById.mockReturnValue({
      id: 1,
      full_text: 'Texte français',
      full_text_translated: null,
      translated_lang: null,
      lang: 'fr',
    })
    enqueueAutoTranslate(1, 'Texte français')
    await flushQueue()
    expect(mockTranslateArticle).not.toHaveBeenCalled()
  })

  it('deduplicates articles already pending', async () => {
    let resolveTranslate: (v: { fullTextTranslated: string }) => void
    mockTranslateArticle.mockImplementation(() => new Promise(resolve => { resolveTranslate = resolve }))
    enqueueAutoTranslate(1, 'Full english text')
    enqueueAutoTranslate(1, 'Full english text')
    resolveTranslate!({ fullTextTranslated: 'Texte traduit' })
    await flushQueue()
    expect(mockTranslateArticle).toHaveBeenCalledTimes(1)
  })

  it('does not store an empty translation result', async () => {
    mockTranslateArticle.mockResolvedValue({ fullTextTranslated: '' })
    enqueueAutoTranslate(1, 'Full english text')
    await flushQueue()
    expect(mockTranslateArticle).toHaveBeenCalled()
    expect(mockUpdateArticleContent).not.toHaveBeenCalled()
    expect(mockUpdateScore).not.toHaveBeenCalled()
  })

  it('survives translation failures without throwing', async () => {
    mockTranslateArticle.mockRejectedValue(new Error('vLLM unreachable'))
    enqueueAutoTranslate(1, 'Full english text')
    await flushQueue()
    expect(mockUpdateArticleContent).not.toHaveBeenCalled()
    expect(mockUpdateScore).not.toHaveBeenCalled()
  })

  it('falls back to general.language for the target', async () => {
    settings({
      'reading.auto_translate': 'on',
      'general.language': 'ja',
    })
    enqueueAutoTranslate(1, 'Full english text')
    await flushQueue()
    expect(mockUpdateArticleContent).toHaveBeenCalledWith(1, {
      full_text_translated: 'Texte traduit',
      translated_lang: 'ja',
    })
  })
})
