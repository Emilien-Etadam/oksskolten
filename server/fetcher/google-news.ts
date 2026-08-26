import { safeFetch } from './ssrf.js'
import { fetchViaFlareSolverr } from './flaresolverr.js'
import { USER_AGENT, DEFAULT_TIMEOUT, decodeResponse } from './http.js'
import { logger } from '../logger.js'

const log = logger.child('google-news')

/** Google hosts the reader lands on before the publisher, never the article itself. */
const GOOGLE_HOSTS = /(^|\.)(news\.google\.com|google\.com|gstatic\.com|googleusercontent\.com)$/i

/**
 * True for the wrapper links Google News puts in its RSS feeds
 * (`news.google.com/rss/articles/<token>`), which carry no article text.
 */
export function isGoogleNewsUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.hostname.replace(/^www\./, '') === 'news.google.com'
      && /^\/(rss\/)?articles\//.test(parsed.pathname)
  } catch {
    return false
  }
}

function isPublisherUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
    return !GOOGLE_HOSTS.test(parsed.hostname)
  } catch {
    return false
  }
}

/**
 * Read the publisher URL out of the token itself.
 *
 * Older Google News tokens are base64 of a small protobuf whose payload
 * contains the target URL as plain ASCII. Tokens minted since mid-2024 hold an
 * opaque identifier instead, and this returns null for them — the caller then
 * has to ask Google.
 */
export function decodeGoogleNewsToken(url: string): string | null {
  let token: string
  try {
    const parsed = new URL(url)
    token = parsed.pathname.split('/').filter(Boolean).pop() ?? ''
  } catch {
    return null
  }
  if (!token) return null

  let decoded: string
  try {
    const padded = token.replace(/-/g, '+').replace(/_/g, '/')
    decoded = Buffer.from(padded, 'base64').toString('binary')
  } catch {
    return null
  }

  // The URL sits between protobuf framing bytes: take the printable run
  const match = /https?:\/\/[\x20-\x7E]+/.exec(decoded)
  if (!match) return null
  // Trailing framing bytes are non-printable, but a stray one can slip in
  const candidate = match[0].replace(/[^\w\-./:?=&%~+#@,;$!*'()[\]]+$/, '')
  return isPublisherUrl(candidate) ? candidate : null
}

/** First URL in a blob of text that points somewhere other than Google. */
function firstPublisherUrl(text: string): string | null {
  const matches = text.matchAll(/https?:\/\/[^\s"'\\<>]+/g)
  for (const m of matches) {
    const candidate = m[0].replace(/[.,;:)\]]+$/, '')
    if (isPublisherUrl(candidate)) return candidate
  }
  return null
}

/** Pull the publisher link out of the redirect shell Google serves. */
export function extractPublisherUrl(html: string): string | null {
  const patterns = [
    /data-n-au="([^"]+)"/i,
    /<meta[^>]+http-equiv=["']refresh["'][^>]+content=["'][^"']*url=([^"';]+)/i,
    /<a[^>]+href="(https?:\/\/[^"]+)"/gi,
  ]
  for (const pattern of patterns) {
    pattern.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = pattern.exec(html)) !== null) {
      const candidate = m[1].replace(/&amp;/g, '&').trim()
      if (isPublisherUrl(candidate)) return candidate
      if (!pattern.global) break
    }
  }
  return null
}

/**
 * Ask Google where a token points, the way its own page does.
 *
 * Tokens minted since mid-2024 carry no URL: the page resolves them at runtime
 * through the DotsSplashUi RPC, signed with values Google embeds in the shell.
 * Replaying that call is the only way to resolve them without a browser.
 *
 * The response is not documented and its shape has changed before, so rather
 * than indexing into it, the first non-Google URL it contains is taken.
 */
async function resolveViaBatchExecute(html: string, token: string): Promise<string | null> {
  const signature = /data-n-a-sg="([^"]+)"/.exec(html)?.[1]
  const timestamp = /data-n-a-ts="([^"]+)"/.exec(html)?.[1]
  const id = /data-n-a-id="([^"]+)"/.exec(html)?.[1] ?? token
  if (!signature || !timestamp) return null

  const inner = JSON.stringify([
    'garturlreq',
    [['X', 'X', ['X', 'X'], null, null, 1, 1, 'US:en', null, 1, null, null, null, null, null, 0, 1],
      'X', 'X', 1, [1, 1, 1], 1, 1, null, 0, 0, null, 0],
    id,
    Number(timestamp),
    signature,
  ])
  const payload = JSON.stringify([[['Fbv4je', inner]]])

  try {
    const res = await safeFetch('https://news.google.com/_/DotsSplashUi/data/batchexecute', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        'User-Agent': USER_AGENT,
      },
      body: `f.req=${encodeURIComponent(payload)}`,
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT),
    })
    if (!res.ok) return null
    const text = await res.text()
    // The payload is JSON nested inside JSON; unescape before scanning
    const unescaped = text
      .replace(/\\u003d/g, '=')
      .replace(/\\u0026/g, '&')
      .replace(/\\\//g, '/')
      .replace(/\\"/g, '"')
    return firstPublisherUrl(unescaped)
  } catch (err) {
    log.debug(`batchexecute failed: ${err instanceof Error ? err.message : err}`)
    return null
  }
}

/**
 * Resolve a Google News wrapper to the publisher's article URL, so the usual
 * extraction pipeline has something to read. Returns null for anything that is
 * not a Google News link, and when every strategy comes up empty — the caller
 * then falls back to fetching the wrapper, which is what it did before.
 *
 * Four strategies, cheapest first: decode the token; follow the redirect and
 * read the shell; replay the RPC the shell would have made; and finally let
 * FlareSolverr run the page's JavaScript.
 */
export async function resolveGoogleNewsUrl(url: string): Promise<string | null> {
  if (!isGoogleNewsUrl(url)) return null

  const decoded = decodeGoogleNewsToken(url)
  if (decoded) return decoded

  try {
    const res = await safeFetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      redirect: 'follow',
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT),
    })
    if (res.ok) {
      if (isPublisherUrl(res.url)) return res.url
      const html = await decodeResponse(res)
      const fromHtml = extractPublisherUrl(html)
      if (fromHtml) return fromHtml
      const token = new URL(url).pathname.split('/').filter(Boolean).pop() ?? ''
      const fromRpc = await resolveViaBatchExecute(html, token)
      if (fromRpc) return fromRpc
    }
  } catch (err) {
    log.debug(`Redirect follow failed for ${url}: ${err instanceof Error ? err.message : err}`)
  }

  const flare = await fetchViaFlareSolverr(url)
  if (flare) {
    if (isPublisherUrl(flare.url)) return flare.url
    const fromHtml = extractPublisherUrl(flare.body)
    if (fromHtml) return fromHtml
  }

  log.warn(`Could not resolve Google News link: ${url}`)
  return null
}
