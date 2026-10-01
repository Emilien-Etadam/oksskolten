/**
 * Version stamped on archived image and video URLs when an article body is
 * rendered.
 *
 * Archived media are served with a year-long immutable cache
 * (`server/routes/articles/media.ts`). Until that route returned its reply,
 * every archived file went out as a 200 with an empty body, and browsers keep
 * that empty answer under the bare URL: they would never ask for the picture
 * again. A new URL is the only way past such a cache, so bump this whenever
 * media already served must be fetched afresh. The route ignores the query.
 */
export const ARCHIVED_MEDIA_VERSION = '2'

const ARCHIVED_MEDIA_URL = /\/api\/articles\/(?:images|videos)\/[^)\s"'<>#]+/g

/**
 * Stamp the version on every archived image or video URL of an article body,
 * Markdown or HTML alike. A URL that already carries a query is left alone.
 */
export function versionArchivedMediaUrls(text: string): string {
  if (!text.includes('/api/articles/')) return text
  return text.replace(ARCHIVED_MEDIA_URL, url => (url.includes('?') ? url : `${url}?v=${ARCHIVED_MEDIA_VERSION}`))
}
