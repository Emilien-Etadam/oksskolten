import { normalizeUrl, urlProtocolVariants, type FeedArticleIdentity } from '../db.js'
import type { RssItem } from '../fetcher/rss/types.js'

export interface DedupResult {
  /** Items the feed has that we have never stored. */
  newItems: RssItem[]
  /** Stored articles that should adopt the guid of the item they matched. */
  guidBackfills: { id: number; guid: string }[]
}

/** Index key for an article that has no guid to identify it: URL + title. */
function urlTitleKey(url: string, title: string): string {
  return `${url}\n${title}`
}

/**
 * Decide which feed items are new articles.
 *
 * Identity is the feed's own guid whenever it provides one. Some feeds —
 * SOLIDWORKS Tech Alerts, for instance — point every entry at the same
 * landing page and distinguish them by `<guid>` alone, so URL-only identity
 * collapses the whole feed into its first article.
 *
 * URL still decides in three cases:
 *
 * - the item carries no guid at all, which is the historical behaviour;
 * - the same URL is already stored under *another* feed, so the same article
 *   reached through two feeds is stored once (guids are feed-specific, two
 *   feeds never agree on one);
 * - the same URL *and* title is already stored under this feed. That is the
 *   same entry re-emitted, either by a feed that regenerates its guids on
 *   every build, or from a row saved before guids were tracked. Matching on
 *   both fields is what keeps the SOLIDWORKS case working: its entries share
 *   a URL but never a title. The cost is a feed that publishes genuinely
 *   distinct entries under one URL *and* one title, which we keep once.
 *
 * @param items       parsed feed items, in feed order
 * @param identities  stored articles of this feed that could match them
 * @param existingUrls normalized URLs already stored in *any* feed
 */
export function selectNewItems(
  items: RssItem[],
  identities: FeedArticleIdentity[],
  existingUrls: Set<string>,
): DedupResult {
  const guidsInFeed = new Set<string>()
  const urlsInFeed = new Set<string>()
  const byUrlTitle = new Map<string, FeedArticleIdentity[]>()

  for (const row of identities) {
    if (row.guid) guidsInFeed.add(row.guid)
    const rowUrl = normalizeUrl(row.url)
    for (const variant of urlProtocolVariants(rowUrl)) {
      urlsInFeed.add(variant)
      const key = urlTitleKey(variant, row.title)
      const bucket = byUrlTitle.get(key)
      if (bucket) bucket.push(row)
      else byUrlTitle.set(key, [row])
    }
  }

  const newItems: RssItem[] = []
  const guidBackfills: { id: number; guid: string }[] = []
  const claimed = new Set<number>()
  const seenInBatch = new Set<string>()

  for (const item of items) {
    const url = normalizeUrl(item.url)
    const guid = item.guid

    // A single fetch can list the same entry twice; without the URL unique
    // constraint nothing else would stop us inserting it twice.
    const batchKey = guid ? `guid:${guid}` : `url:${urlTitleKey(url, item.title)}`
    if (seenInBatch.has(batchKey)) continue
    seenInBatch.add(batchKey)

    if (guid && guidsInFeed.has(guid)) continue

    // Same URL and title in this feed: the entry we already have. Prefer a
    // row with no guid so the backfill lands on one that still needs it.
    const candidates = urlProtocolVariants(url).flatMap(v => byUrlTitle.get(urlTitleKey(v, item.title)) ?? [])
    const twin = candidates.find(row => !claimed.has(row.id) && !row.guid)
      ?? candidates.find(row => !claimed.has(row.id))
    if (twin) {
      claimed.add(twin.id)
      if (guid && !twin.guid) guidBackfills.push({ id: twin.id, guid })
      continue
    }

    if (!guid) {
      if (!existingUrls.has(url)) newItems.push(item)
      continue
    }

    // Unknown guid: only a copy stored under another feed makes this a
    // duplicate. The same URL under *this* feed is the reused-link case.
    if (existingUrls.has(url) && !urlsInFeed.has(url)) continue
    newItems.push(item)
  }

  return { newItems, guidBackfills }
}
