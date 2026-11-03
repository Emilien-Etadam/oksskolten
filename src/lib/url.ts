export { articleUrlToPath } from '../../shared/url'

export function extractDomain(url: string): string | null {
  try {
    return new URL(url).hostname
  } catch {
    return null
  }
}

const GITHUB_STARS_URL = /^https:\/\/github\.com\/stars\/[A-Za-z0-9-]+\/?$/

/**
 * True for a GitHub starred-releases feed. The canonical
 * `https://github.com/stars/<user>` URL is its `rss_url`; `url` keeps whatever
 * was pasted (`github.com/<user>?tab=stars` too), so both are checked.
 */
export function isGithubStarsFeed(feed: { url: string; rss_url: string | null }): boolean {
  return GITHUB_STARS_URL.test(feed.rss_url ?? '') || GITHUB_STARS_URL.test(feed.url)
}
