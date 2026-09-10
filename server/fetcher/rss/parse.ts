import { normalizeDate } from '../util.js'
import { cleanUrl } from '../url-cleaner.js'
import type { RssItem } from './types.js'

const RSS_BRIDGE_ERROR_RE = /^Bridge returned error/i

export function cleanItems(items: RssItem[]): RssItem[] {
  return items
    .filter(item => !RSS_BRIDGE_ERROR_RE.test(item.title))
    .map(item => ({ ...item, url: cleanUrl(item.url) }))
}

export async function parseRssXml(xml: string): Promise<RssItem[]> {
  // Try feedsmith first
  try {
    const { parseFeed } = await import('feedsmith')
    const parsed = parseFeed(xml) as Record<string, unknown>
    const feed = parsed.feed as Record<string, unknown> | undefined
    const items = (parsed.items ?? parsed.entries ?? feed?.items ?? feed?.entries) as Record<string, unknown>[] | undefined
    if (items && items.length > 0) {
      return items
        .filter((item: Record<string, unknown>) => {
          if (item.url || item.link) return true
          // feedsmith puts Atom <link> elements in a links[] array
          const links = item.links as { href?: string; rel?: string }[] | undefined
          if (links?.length) return true
          // Only use id as URL when it looks like an HTTP URL
          const id = item.id as string | undefined
          return id ? /^https?:\/\//i.test(id) : false
        })
        .map((item: Record<string, unknown>) => {
          let url = (item.url || item.link) as string | undefined
          if (!url) {
            // Extract URL from feedsmith links[] array (prefer rel=alternate)
            const links = item.links as { href?: string; rel?: string }[] | undefined
            if (links?.length) {
              const alt = links.find(l => l.rel === 'alternate')
              url = alt?.href || links[0]?.href
            }
          }
          const rawExcerpt = item.content_encoded || item['content:encoded'] || item.content || item.description || item.summary
          const excerpt = typeof rawExcerpt === 'string' ? rawExcerpt : (rawExcerpt && typeof rawExcerpt === 'object' && 'value' in rawExcerpt ? String((rawExcerpt as Record<string, unknown>).value) : undefined)
          return {
            title: (item.title as string) || 'Untitled',
            url: (url || item.id) as string,
            published_at: normalizeDate(
              (item.published || item.updated || item.date || item.pubDate || (item.dc as Record<string, unknown>)?.date) as string | undefined,
            ),
            ...(excerpt ? { excerpt } : {}),
          }
        })
    }
  } catch {
    // feedsmith failed, fall through to fast-xml-parser
  }

  // Fallback: fast-xml-parser
  const { XMLParser } = await import('fast-xml-parser')
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' })
  const doc = parser.parse(xml)

  // fast-xml-parser returns { "#text": "...", "@_type": "html" } for elements with attributes
  function textOf(val: unknown): string {
    if (typeof val === 'string') return val
    if (val && typeof val === 'object' && '#text' in val) return String((val as Record<string, unknown>)['#text'])
    return ''
  }

  // RSS 2.0
  const channel = doc?.rss?.channel
  if (channel?.item) {
    const items = Array.isArray(channel.item) ? channel.item : [channel.item]
    return items
      .map((item: Record<string, unknown>) => {
        const excerpt = textOf(item['content:encoded']) || textOf(item.description)
        return {
          title: textOf(item.title) || 'Untitled',
          url: (item.link || item.guid || '') as string,
          published_at: normalizeDate(item.pubDate as string | undefined),
          ...(excerpt ? { excerpt } : {}),
        }
      })
      .filter((item: RssItem) => item.url)
  }

  // Atom
  const atomFeed = doc?.feed
  if (atomFeed?.entry) {
    const entries = Array.isArray(atomFeed.entry) ? atomFeed.entry : [atomFeed.entry]
    return entries
      .map((entry: Record<string, unknown>) => {
        const link = Array.isArray(entry.link)
          ? (entry.link as Record<string, string>[]).find(l => l['@_rel'] === 'alternate')?.['@_href'] ||
            (entry.link as Record<string, string>[])[0]?.['@_href']
          : (entry.link as Record<string, string>)?.['@_href'] || (entry.link as string)
        const id = entry.id as string | undefined
        const effectiveUrl = link || (id && /^https?:\/\//i.test(id) ? id : '') || ''
        const excerpt = textOf(entry.content) || textOf(entry.summary)
        return {
          title: textOf(entry.title) || 'Untitled',
          url: effectiveUrl,
          published_at: normalizeDate(
            (entry.published || entry.updated) as string | undefined,
          ),
          ...(excerpt ? { excerpt } : {}),
        }
      })
      .filter((item: RssItem) => item.url)
  }

  // RSS 1.0 (RDF)
  const rdf = doc?.['rdf:RDF']
  const rdfItem = rdf?.item
  if (rdfItem) {
    const items = Array.isArray(rdfItem) ? rdfItem : [rdfItem]
    return items
      .map((item: Record<string, unknown>) => ({
        title: textOf(item.title) || 'Untitled',
        url: (item.link || item['@_rdf:about'] || '') as string,
        published_at: normalizeDate((item['dc:date'] ?? item.pubDate) as string | undefined),
      }))
      .filter((item: RssItem) => item.url)
  }

  throw new Error('Could not parse RSS/Atom feed')
}
