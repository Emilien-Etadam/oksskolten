import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockFetchFullText = vi.fn()

vi.mock('../fetcher/content.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../fetcher/content.js')>()
  return { ...real, fetchFullText: (url: string, opts?: unknown) => mockFetchFullText(url, opts) }
})

vi.mock('../ai/index.js', () => ({
  detectLanguage: () => 'en',
}))

import { fetchArticleContent } from './fetch-content.js'

const MESSAGE_URL = 'https://discord.com/channels/123456789012345678/234567890123456789/345678901234567890'
const MESSAGE_BODY = 'Release 1.4 is out.\n\nGrab it from the downloads page, it fixes the import crash.'

beforeEach(() => {
  mockFetchFullText.mockReset()
})

describe('fetchArticleContent', () => {
  it('uses the message itself for a Discord permalink, without fetching the login wall', async () => {
    const result = await fetchArticleContent(MESSAGE_URL, { listingExcerpt: MESSAGE_BODY })

    expect(mockFetchFullText).not.toHaveBeenCalled()
    expect(result.fullText).toContain('Grab it from the downloads page')
    expect(result.lastError).toBeNull()
  })

  it('still fetches a Discord channel URL that is not a message permalink', async () => {
    mockFetchFullText.mockResolvedValue({ fullText: null, ogImage: null, excerpt: null, title: null })

    await fetchArticleContent('https://discord.com/channels/123456789012345678/234567890123456789', {
      listingExcerpt: MESSAGE_BODY,
    })

    expect(mockFetchFullText).toHaveBeenCalled()
  })
})
