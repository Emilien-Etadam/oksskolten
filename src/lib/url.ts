export { articleUrlToPath } from '../../shared/url'

export function extractDomain(url: string): string | null {
  try {
    return new URL(url).hostname
  } catch {
    return null
  }
}

/**
 * True for a GitHub starred-releases feed. The server stores these under the
 * canonical `https://github.com/stars/<user>` URL whichever form was pasted.
 */
export function isGithubStarsFeedUrl(url: string): boolean {
  return /^https:\/\/github\.com\/stars\/[A-Za-z0-9-]+\/?$/.test(url)
}
