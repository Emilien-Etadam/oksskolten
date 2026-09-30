import path from 'node:path'
import fs from 'node:fs'
import crypto from 'node:crypto'
import { safeFetch } from './ssrf.js'
import { sniffImageType, sniffImageFile } from './image-type.js'
import { USER_AGENT } from './http.js'
import { fetchFullText } from './content.js'
import { getSetting } from '../db/settings.js'
import { updateArticleContent, markImagesArchived, clearImagesArchived, getUnarchivedArticlesByFeed, getArticlesWithLocalImages } from '../db/articles.js'
import type { ArticleWithLocalImages } from '../db/articles/media.js'
import { getFeedById, getAutoArchiveFeeds } from '../db/feeds.js'
import type { Feed } from '../db/types.js'
import { logger } from '../logger.js'
import { dataPath, formerDataDirs } from '../paths.js'

const log = logger.child('fetcher')

// Default images directory, can be overridden by settings
function getImagesDir(): string {
  const custom = getSetting('images.storage_path')
  return custom || dataPath('articles', 'images')
}

function getMaxSizeBytes(): number {
  const val = getSetting('images.max_size_mb')
  return (val ? Number(val) : 10) * 1024 * 1024
}

export function isImageArchivingEnabled(): boolean {
  const enabled = getSetting('images.enabled')
  return enabled === '1' || enabled === 'true'
}

export interface RemoteUploadConfig {
  uploadUrl: string
  headers: Record<string, string>
  fieldName: string
  respPath: string
}

export function getRemoteConfig(): RemoteUploadConfig | null {
  const mode = getSetting('images.storage')
  if (mode !== 'remote') return null

  const uploadUrl = getSetting('images.upload_url')
  const respPath = getSetting('images.upload_resp_path')
  if (!uploadUrl || !respPath) return null

  const fieldName = getSetting('images.upload_field') ?? 'image'
  let headers: Record<string, string> = {}
  const headersRaw = getSetting('images.upload_headers')
  if (headersRaw) {
    try {
      headers = JSON.parse(headersRaw)
    } catch {
      return null
    }
  }

  return { uploadUrl, headers, fieldName, respPath }
}

/**
 * The part of an archived file's name that identifies where it came from:
 * the first 12 hex digits of its source URL's SHA-256.
 */
export function archivedImageHash(imageUrl: string): string {
  return crypto.createHash('sha256').update(imageUrl).digest('hex').slice(0, 12)
}

export function extractByDotPath(obj: unknown, dotPath: string): unknown {
  const keys = dotPath.split('.')
  let current: unknown = obj
  for (const key of keys) {
    if (current === null || current === undefined || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[key]
  }
  return current
}

async function uploadImageToRemote(
  buffer: Buffer,
  filename: string,
  config: RemoteUploadConfig,
): Promise<string | null> {
  try {
    const ext = path.extname(filename).toLowerCase()
    const mimeMap: Record<string, string> = {
      '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
      '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.avif': 'image/avif',
    }
    const mime = mimeMap[ext] ?? 'image/jpeg'
    const formData = new FormData()
    formData.append(config.fieldName, new Blob([new Uint8Array(buffer)], { type: mime }), filename)

    const res = await safeFetch(config.uploadUrl, {
      method: 'POST',
      headers: config.headers,
      body: formData,
      signal: AbortSignal.timeout(30_000),
    })

    if (!res.ok) {
      log.warn(`Remote image upload failed: ${res.status}`)
      return null
    }

    const json = await res.json()
    const url = extractByDotPath(json, config.respPath)
    if (!url || typeof url !== 'string') {
      log.warn(`Could not extract URL from remote response at path "${config.respPath}"`)
      return null
    }
    return url
  } catch (err) {
    log.warn('Remote image upload error:', err)
    return null
  }
}

/**
 * Archive images from an article's markdown full_text.
 * Downloads each image, saves locally or uploads remotely, and rewrites the markdown URLs.
 */
export async function archiveArticleImages(
  articleId: number,
  fullText: string,
): Promise<{ rewrittenText: string; downloaded: number; errors: number }> {
  const maxSize = getMaxSizeBytes()
  const remoteConfig = getRemoteConfig()
  const isRemoteMode = getSetting('images.storage') === 'remote'

  // Remote mode but config is incomplete → skip
  if (isRemoteMode && !remoteConfig) {
    clearImagesArchived(articleId)
    return { rewrittenText: fullText, downloaded: 0, errors: 0 }
  }

  if (!isRemoteMode) {
    const imagesDir = getImagesDir()
    fs.mkdirSync(imagesDir, { recursive: true })
  }

  // Match markdown images: ![alt](url)
  const imageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g
  let match: RegExpExecArray | null
  const replacements: Array<{ original: string; replacement: string }> = []
  let downloaded = 0
  let errors = 0

  while ((match = imageRegex.exec(fullText)) !== null) {
    const [fullMatch, alt, imageUrl] = match

    // Skip already-local URLs
    if (imageUrl.startsWith('/api/articles/images/')) continue
    // Skip data URIs
    if (imageUrl.startsWith('data:')) continue

    try {
      const res = await safeFetch(imageUrl, {
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(30_000),
      })

      if (!res.ok) {
        errors++
        continue
      }

      const contentLength = res.headers.get('content-length')
      if (contentLength && Number(contentLength) > maxSize) {
        errors++
        continue
      }

      const buffer = Buffer.from(await res.arrayBuffer())
      if (buffer.length > maxSize) {
        errors++
        continue
      }

      // A 200 is not proof of a picture: keep the remote URL rather than
      // store an HTML error page or a truncated file as the article's image
      const type = sniffImageType(buffer)
      if (!type) {
        errors++
        continue
      }

      const hash = archivedImageHash(imageUrl)
      // Name the file after what arrived, not after the URL: CDNs such as
      // Blogger re-encode images and keep the original extension
      const ext = type.ext
      const filename = `${articleId}_${hash}${ext}`

      if (remoteConfig) {
        const remoteUrl = await uploadImageToRemote(buffer, filename, remoteConfig)
        if (remoteUrl) {
          replacements.push({ original: fullMatch, replacement: `![${alt}](${remoteUrl})` })
          downloaded++
        }
        // If upload fails, keep original URL
      } else {
        // Local mode
        const imagesDir = getImagesDir()
        const filepath = path.join(imagesDir, filename)
        fs.writeFileSync(filepath, buffer)
        downloaded++
        const localUrl = `/api/articles/images/${filename}`
        replacements.push({ original: fullMatch, replacement: `![${alt}](${localUrl})` })
      }
    } catch {
      errors++
    }
  }

  let rewrittenText = fullText
  for (const { original, replacement } of replacements) {
    rewrittenText = rewrittenText.replace(original, replacement)
  }

  // Update article content and mark as archived
  if (replacements.length > 0) {
    updateArticleContent(articleId, { full_text: rewrittenText })
  }
  markImagesArchived(articleId)

  return { rewrittenText, downloaded, errors }
}

/**
 * How many articles one sweep archives per feed. New articles arrive a
 * handful per cycle, so the cap only matters for the backlog right after a
 * feed is switched to auto-archive: the on-enable kick passes a much larger
 * budget, and whatever remains drains at this rate on later fetch cycles.
 */
const SWEEP_LIMIT_PER_CYCLE = 50
export const SWEEP_LIMIT_BACKLOG = 10_000

/** Feeds with a sweep in flight — a second concurrent sweep would download the same images again. */
const sweepingFeeds = new Set<number>()

/**
 * Archive images for every not-yet-archived article of one feed, sequentially.
 * Ordinary failures are per-image (archiveArticleImages counts them and still
 * marks the article archived), so one bad article cannot wedge the sweep.
 */
export async function archiveFeedImages(
  feedId: number,
  limit: number,
): Promise<{ articles: number; downloaded: number; errors: number }> {
  const totals = { articles: 0, downloaded: 0, errors: 0 }
  if (sweepingFeeds.has(feedId)) return totals

  sweepingFeeds.add(feedId)
  try {
    const articles = getUnarchivedArticlesByFeed(feedId, limit)
    for (const article of articles) {
      const { downloaded, errors } = await archiveArticleImages(article.id, article.full_text)
      totals.articles++
      totals.downloaded += downloaded
      totals.errors += errors
    }
    if (totals.articles > 0) {
      log.info(
        `Auto-archived images for feed ${feedId}: ${totals.articles} articles, ` +
        `${totals.downloaded} images, ${totals.errors} errors`,
      )
    }
  } finally {
    sweepingFeeds.delete(feedId)
  }
  return totals
}

/**
 * Fire-and-forget entry point for the fetch pipeline and the feeds API:
 * archive images for the feeds flagged archive_images. With a feedId, only
 * that feed is swept (re-checking its flag from the DB); without one, every
 * flagged enabled feed is. A no-op while the global image archiving feature
 * is off — the sweep reuses its storage configuration.
 */
export async function sweepAutoArchiveFeeds(feedId?: number, limit = SWEEP_LIMIT_PER_CYCLE): Promise<void> {
  if (!isImageArchivingEnabled()) return

  const feeds = feedId !== undefined
    ? [getFeedById(feedId)].filter((f): f is Feed => f !== undefined && f.archive_images === 1 && !f.disabled)
    : getAutoArchiveFeeds()

  for (const feed of feeds) {
    try {
      await archiveFeedImages(feed.id, limit)
    } catch (err) {
      log.warn(`Image auto-archive sweep failed for feed ${feed.id}:`, err)
    }
  }
}

// ---------------------------------------------------------------------------
// Archives whose files are gone
// ---------------------------------------------------------------------------

const LOCAL_IMAGE_PREFIX = '/api/articles/images/'
/** `<articleId>_<hash>.<ext>`, as archiveArticleImages names its files. */
const ARCHIVED_FILENAME = /^\d+_([0-9a-f]{12})(?:\.[a-z0-9]+)?$/i
const REPAIR_BATCH = 50

/** Every local image file a text points at. */
function localImageFiles(text: string | null): string[] {
  if (!text) return []
  return [...text.matchAll(/\/api\/articles\/images\/([^)\s"'<>]+)/g)].map(m => m[1])
}

/** URLs of a text's markdown images, read exactly as archiveArticleImages reads them. */
function markdownImageUrls(md: string): string[] {
  return [...md.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)].map(m => m[1])
}

/** A link to the picture itself rather than to a page about it. */
function isImageLink(url: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
  // Blogger's full-size links may carry no extension (…/img/a/AVvXs…=s1600)
  if (/(^|\.)(googleusercontent\.com|bp\.blogspot\.com)$/i.test(parsed.hostname)) return true
  return /\.(jpe?g|png|gif|webp|avif)$/i.test(parsed.pathname)
}

/** Where a local image links to, when the text wraps it in a link: `[![alt](local)](href)`. */
function linkTargetOf(text: string, file: string): string | null {
  const local = (LOCAL_IMAGE_PREFIX + file).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const m = new RegExp(`\\[!\\[[^\\]]*\\]\\(${local}\\)\\]\\(([^)\\s]+)\\)`).exec(text)
  return m ? m[1] : null
}

/**
 * The remote URL each missing file was downloaded from. A file is named after
 * the hash of its source URL, so a candidate URL either is its source or is
 * not: the article's og:image first, then the images of its page, extracted
 * again. An image the page no longer holds falls back to the full-size
 * picture it linked to, when it linked to one — Blogger always does.
 */
async function recoverImageSources(
  article: ArticleWithLocalImages,
  missing: string[],
): Promise<Map<string, string>> {
  const byHash = new Map<string, string>()
  for (const file of missing) {
    const m = ARCHIVED_FILENAME.exec(file)
    if (m) byHash.set(m[1].toLowerCase(), file)
  }

  const sources = new Map<string, string>()
  const offer = (url: string | null | undefined) => {
    if (!url || !/^https?:\/\//i.test(url)) return
    const file = byHash.get(archivedImageHash(url))
    if (file && !sources.has(file)) sources.set(file, url)
  }

  offer(article.og_image)
  if (sources.size < byHash.size) {
    try {
      const feed = getFeedById(article.feed_id)
      const page = await fetchFullText(article.url, { requiresJsChallenge: feed?.requires_js_challenge === 1 })
      offer(page.ogImage)
      for (const url of markdownImageUrls(page.fullText)) offer(url)
    } catch (err) {
      log.debug(`Could not re-extract ${article.url} to trace its lost images: ${err instanceof Error ? err.message : err}`)
    }
  }

  for (const file of missing) {
    if (sources.has(file)) continue
    const href = linkTargetOf(article.full_text ?? '', file)
    if (href && isImageLink(href)) sources.set(file, href)
  }
  return sources
}

/**
 * Copy a missing file back from a directory an earlier run stored it in, as
 * long as what sits there is a picture. Returns the directory it came from.
 */
function copyFromFormerDir(file: string, formerDirs: string[], imagesDir: string): string | null {
  const name = path.basename(file)
  for (const dir of formerDirs) {
    const source = path.join(dir, name)
    if (!sniffImageFile(source)) continue
    try {
      fs.mkdirSync(imagesDir, { recursive: true })
      fs.copyFileSync(source, path.join(imagesDir, name))
      return dir
    } catch (err) {
      log.warn(`Could not copy ${source} into ${imagesDir}: ${err instanceof Error ? err.message : err}`)
    }
  }
  return null
}

/**
 * Bring back archived images whose files are gone.
 *
 * Once archived, an article's text refers to `/api/articles/images/<file>`.
 * When that file is not where this process looks — the storage directory
 * was wiped, moved, or resolved differently by an earlier run — the reader
 * shows a broken image with no way back to the original. For each such file
 * this first looks in the directories earlier runs may have used and copies
 * it back. Failing that, it restores the URL the file came from (see
 * recoverImageSources) in the text and its translation, and clears the
 * archived mark so the auto-archive sweep can download the picture again.
 * It runs at every startup: an article whose files are all present costs
 * one existence check per image.
 */
export async function repairLostArchivedImages(
  formerImageDirs: string[] = formerDataDirs().map(dir => path.join(dir, 'articles', 'images')),
): Promise<{ articles: number; recovered: number; restored: number; unresolved: number }> {
  const totals = { articles: 0, recovered: 0, restored: 0, unresolved: 0 }
  const imagesDir = getImagesDir()
  // The default location is a former one too when a custom storage path is set
  const formerDirs = [...new Set([...formerImageDirs, dataPath('articles', 'images')].map(dir => path.resolve(dir)))]
    .filter(dir => dir !== path.resolve(imagesDir))
  const recoveredFrom = new Set<string>()
  const feedsToSweep = new Set<number>()
  let afterId = 0

  for (;;) {
    const batch = getArticlesWithLocalImages(afterId, REPAIR_BATCH)
    if (batch.length === 0) break

    for (const article of batch) {
      afterId = article.id
      const referenced = new Set([...localImageFiles(article.full_text), ...localImageFiles(article.full_text_translated)])
      const missing: string[] = []
      for (const file of referenced) {
        if (fs.existsSync(path.join(imagesDir, path.basename(file)))) continue
        const from = copyFromFormerDir(file, formerDirs, imagesDir)
        if (from) {
          recoveredFrom.add(from)
          totals.recovered++
        } else {
          missing.push(file)
        }
      }
      if (missing.length === 0) continue

      const sources = await recoverImageSources(article, missing)
      totals.unresolved += missing.length - sources.size
      if (sources.size === 0) continue

      const restore = (text: string | null): string | null => {
        if (!text) return text
        for (const [file, url] of sources) text = text.split(LOCAL_IMAGE_PREFIX + file).join(url)
        return text
      }
      updateArticleContent(article.id, {
        full_text: restore(article.full_text),
        full_text_translated: restore(article.full_text_translated),
      })
      clearImagesArchived(article.id)
      feedsToSweep.add(article.feed_id)
      totals.articles++
      totals.restored += sources.size
    }
  }

  if (totals.recovered > 0) {
    log.warn(`Copied ${totals.recovered} archived images into ${imagesDir} from ${[...recoveredFrom].join(', ')}`)
  }
  if (totals.restored > 0 || totals.unresolved > 0) {
    log.warn(
      `Archived images missing from ${imagesDir}: ${totals.restored} pointed back at their source ` +
      `in ${totals.articles} articles, ${totals.unresolved} could not be traced`,
    )
  }
  // Archive the restored pictures again rather than waiting for the sweep
  // that follows each fetch, which takes 50 articles per feed at a time
  for (const feedId of feedsToSweep) await sweepAutoArchiveFeeds(feedId, SWEEP_LIMIT_BACKLOG)
  return totals
}

/**
 * Delete archived images for an article.
 */
export function deleteArticleImages(articleId: number): number {
  const imagesDir = getImagesDir()
  if (!fs.existsSync(imagesDir)) return 0

  const prefix = `${articleId}_`
  const files = fs.readdirSync(imagesDir).filter(f => f.startsWith(prefix))
  for (const file of files) {
    fs.unlinkSync(path.join(imagesDir, file))
  }
  return files.length
}
