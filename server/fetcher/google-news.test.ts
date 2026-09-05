import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockSafeFetch = vi.fn()
vi.mock('./ssrf.js', () => ({ safeFetch: (...args: unknown[]) => mockSafeFetch(...args) }))

const mockFlareSolverr = vi.fn()
vi.mock('./flaresolverr.js', () => ({ fetchViaFlareSolverr: (...args: unknown[]) => mockFlareSolverr(...args) }))

vi.mock('./http.js', () => ({
  USER_AGENT: 'test-agent',
  DEFAULT_TIMEOUT: 1000,
  decodeResponse: (res: { text: () => Promise<string> }) => res.text(),
}))

import { isGoogleNewsUrl, decodeGoogleNewsToken, extractPublisherUrl, resolveGoogleNewsUrl } from './google-news.js'

/** A legacy token: protobuf framing around the plain publisher URL. */
function legacyToken(url: string): string {
  const body = Buffer.concat([
    Buffer.from([0x08, 0x13, 0x22, url.length]),
    Buffer.from(url, 'binary'),
    Buffer.from([0xd2, 0x01, 0x00]),
  ])
  return body.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

const ARTICLE = 'https://www.lefigaro.fr/faits-divers/paris-un-employe-mis-en-examen-20260826'

describe('isGoogleNewsUrl', () => {
  it('matches the wrapper links Google News puts in its feeds', () => {
    expect(isGoogleNewsUrl('https://news.google.com/rss/articles/CBMiabc123?oc=5')).toBe(true)
    expect(isGoogleNewsUrl('https://news.google.com/articles/CBMiabc123')).toBe(true)
  })

  it('leaves everything else alone', () => {
    expect(isGoogleNewsUrl(ARTICLE)).toBe(false)
    expect(isGoogleNewsUrl('https://news.google.com/topics/CAAqBwgK')).toBe(false)
    expect(isGoogleNewsUrl('not a url')).toBe(false)
  })
})

describe('decodeGoogleNewsToken', () => {
  it('reads the publisher URL out of a legacy token', () => {
    expect(decodeGoogleNewsToken(`https://news.google.com/rss/articles/${legacyToken(ARTICLE)}?oc=5`)).toBe(ARTICLE)
  })

  it('returns null for an opaque token', () => {
    const opaque = Buffer.from('AU_yqLNq9lmMr7dNbYtoken-with-no-url').toString('base64url')
    expect(decodeGoogleNewsToken(`https://news.google.com/rss/articles/${opaque}`)).toBeNull()
  })

  it('returns null for a real post-2024 token', () => {
    // Straight from a Google News feed: the payload is an opaque AU_yqL... id
    const real = 'CBMi0AFBVV95cUxNc2dnQ01wUFRaQndLZzV6Ui1wNDFUeTBiQzlaeEZoZmdzek9remFQVUM4NDdDZFY0MFhBT29sSjdPbWRwTkZVdmxZSVdSMXR1RnlqbUJkSm1Ba1FkSmN6emJlLXFLNnlsNVljTTFTNHRuTnQtd3RzVS12eHktVVNFX1EwbzdtTE9IdVRLOWhMSnV5SUdHX0taT0RxNU5idm85WUtYNzdIZG9sOU5hX0NYWjhPT1ViXzQydE5rU3NVME9OUHJYWXBLamt0OVFtMm1V'
    expect(decodeGoogleNewsToken(`https://news.google.com/rss/articles/${real}?oc=5`)).toBeNull()
  })

  it('refuses a payload that points back at Google', () => {
    expect(decodeGoogleNewsToken(`https://news.google.com/rss/articles/${legacyToken('https://news.google.com/foo')}`)).toBeNull()
  })
})

describe('extractPublisherUrl', () => {
  it('reads the redirect attribute', () => {
    expect(extractPublisherUrl(`<c-wiz data-n-au="${ARTICLE}"></c-wiz>`)).toBe(ARTICLE)
  })

  it('reads a meta refresh', () => {
    expect(extractPublisherUrl(`<meta http-equiv="refresh" content="0; url=${ARTICLE}">`)).toBe(ARTICLE)
  })

  it('falls back to the first link that leaves Google', () => {
    const html = `<a href="https://support.google.com/news">Help</a><a href="${ARTICLE}">Read</a>`
    expect(extractPublisherUrl(html)).toBe(ARTICLE)
  })

  it('decodes escaped ampersands', () => {
    expect(extractPublisherUrl('<c-wiz data-n-au="https://example.com/a?b=1&amp;c=2"></c-wiz>'))
      .toBe('https://example.com/a?b=1&c=2')
  })

  it('returns null when only Google links are present', () => {
    expect(extractPublisherUrl('<a href="https://policies.google.com/terms">Terms</a>')).toBeNull()
  })
})

describe('resolveGoogleNewsUrl', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFlareSolverr.mockResolvedValue(null)
  })

  it('ignores links that are not Google News', async () => {
    expect(await resolveGoogleNewsUrl(ARTICLE)).toBeNull()
    expect(mockSafeFetch).not.toHaveBeenCalled()
  })

  it('decodes without touching the network', async () => {
    expect(await resolveGoogleNewsUrl(`https://news.google.com/rss/articles/${legacyToken(ARTICLE)}`)).toBe(ARTICLE)
    expect(mockSafeFetch).not.toHaveBeenCalled()
  })

  it('follows the redirect when the token is opaque', async () => {
    mockSafeFetch.mockResolvedValue({ ok: true, url: ARTICLE, text: () => Promise.resolve('') })
    expect(await resolveGoogleNewsUrl('https://news.google.com/rss/articles/AU_yqLopaque')).toBe(ARTICLE)
    expect(mockFlareSolverr).not.toHaveBeenCalled()
  })

  it('reads the shell when the redirect stays on Google', async () => {
    mockSafeFetch.mockResolvedValue({
      ok: true,
      url: 'https://news.google.com/rss/articles/AU_yqLopaque',
      text: () => Promise.resolve(`<c-wiz data-n-au="${ARTICLE}"></c-wiz>`),
    })
    expect(await resolveGoogleNewsUrl('https://news.google.com/rss/articles/AU_yqLopaque')).toBe(ARTICLE)
  })

  it('replays the RPC when the shell only holds a signed token', async () => {
    const shell = '<c-wiz data-n-a-id="AU_yqLtoken" data-n-a-sg="signature123" data-n-a-ts="1756231000"></c-wiz>'
    mockSafeFetch
      .mockResolvedValueOnce({
        ok: true,
        url: 'https://news.google.com/rss/articles/AU_yqLtoken',
        text: () => Promise.resolve(shell),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(`)]}'\n\n[["wrb.fr","Fbv4je","[\\"garturlres\\",\\"${ARTICLE}\\"]"]]`),
      })

    expect(await resolveGoogleNewsUrl('https://news.google.com/rss/articles/AU_yqLtoken')).toBe(ARTICLE)

    const [rpcUrl, init] = mockSafeFetch.mock.calls[1]
    expect(rpcUrl).toContain('batchexecute')
    expect((init as { body: string }).body).toContain('signature123')
    expect(mockFlareSolverr).not.toHaveBeenCalled()
  })

  it('tells Google the consent dialog was already answered', async () => {
    const shell = '<c-wiz data-n-a-id="AU_yqLtoken" data-n-a-sg="signature123" data-n-a-ts="1756231000"></c-wiz>'
    mockSafeFetch
      .mockResolvedValueOnce({
        ok: true,
        url: 'https://news.google.com/rss/articles/AU_yqLtoken',
        text: () => Promise.resolve(shell),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(`[["wrb.fr","Fbv4je","[\\"garturlres\\",\\"${ARTICLE}\\"]"]]`),
      })

    await resolveGoogleNewsUrl('https://news.google.com/rss/articles/AU_yqLtoken')

    // Without these, a European server is bounced to consent.google.com and
    // never sees the shell — on the wrapper fetch and on the RPC alike.
    for (const [, init] of mockSafeFetch.mock.calls) {
      const headers = (init as { headers: Record<string, string> }).headers
      expect(headers.Cookie).toContain('CONSENT=YES')
      expect(headers.Cookie).toContain('SOCS=')
    }
  })

  it('skips the RPC when the shell carries no signature', async () => {
    mockSafeFetch.mockResolvedValue({
      ok: true,
      url: 'https://news.google.com/rss/articles/AU_yqLtoken',
      text: () => Promise.resolve('<html><body>consent</body></html>'),
    })
    await resolveGoogleNewsUrl('https://news.google.com/rss/articles/AU_yqLtoken')
    expect(mockSafeFetch).toHaveBeenCalledTimes(1)
  })

  it('lets a browser run the redirect when plain fetching fails', async () => {
    mockSafeFetch.mockRejectedValue(new Error('ECONNRESET'))
    mockFlareSolverr.mockResolvedValue({ url: ARTICLE, body: '', contentType: 'text/html' })
    expect(await resolveGoogleNewsUrl('https://news.google.com/rss/articles/AU_yqLopaque')).toBe(ARTICLE)
  })

  it('gives up rather than returning the wrapper', async () => {
    mockSafeFetch.mockResolvedValue({
      ok: true,
      url: 'https://news.google.com/rss/articles/AU_yqLopaque',
      text: () => Promise.resolve('<html><body>consent</body></html>'),
    })
    expect(await resolveGoogleNewsUrl('https://news.google.com/rss/articles/AU_yqLopaque')).toBeNull()
  })
})
