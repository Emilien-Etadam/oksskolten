import path from 'node:path'
import fs from 'node:fs'
import crypto from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { getSetting } from '../db/settings.js'
import { updateArticleContent, markVideosArchived } from '../db/articles.js'
import { logger } from '../logger.js'
import { dataPath } from '../paths.js'
import { parseVideoUrl } from '../../shared/video.js'

const execFileAsync = promisify(execFile)
const log = logger.child('fetcher')

/**
 * Archiving the video an article embedded.
 *
 * The sibling of `article-images.ts`, and deliberately shaped the same way:
 * the reader asks for it on one article, the work happens in the background,
 * the copy is served from this instance, and deleting the article deletes it.
 *
 * Two things differ from images, both because of size. A video is three orders
 * of magnitude larger than the pictures around it, so it is never archived
 * automatically, and the download is capped in both height and bytes. And it
 * cannot be fetched with a plain GET: a provider page serves a player, not a
 * file, so this shells out to yt-dlp — an external binary that the providers
 * break every few months, and which must therefore be kept updated. When it is
 * missing or fails, the article is left exactly as it was.
 */

/** Local mode only: uploading hundreds of megabytes to an image host is not a thing. */
function getVideosDir(): string {
  return getSetting('videos.storage_path') || dataPath('articles', 'videos')
}

function getMaxSizeMb(): number {
  return Number(getSetting('videos.max_size_mb')) || 500
}

/**
 * Height ceiling. The lever images do not have: 720p turns a ten-minute talk
 * from something near a gigabyte into something near a hundred megabytes.
 */
function getMaxHeight(): number {
  return Number(getSetting('videos.max_height')) || 720
}

function getDownloaderBin(): string {
  return getSetting('videos.downloader') || process.env.YT_DLP_PATH || 'yt-dlp'
}

export function isVideoArchivingEnabled(): boolean {
  const enabled = getSetting('videos.enabled')
  // 'on' is what the preferences UI writes; the other two match how image
  // archiving stores the same idea.
  return enabled === 'on' || enabled === '1' || enabled === 'true'
}

/** A download that outruns this is not going to finish. */
const DOWNLOAD_TIMEOUT_MS = 15 * 60_000

/** Markdown links, with or without an image inside: `[text](url)` / `[![alt](img)](url)`. */
const MARKDOWN_LINK_RE = /\[(!\[[^\]]*\]\([^)]*\)|[^\][]*)\]\(([^)\s]+)\)/g
const MARKDOWN_IMAGE_RE = /^!\[([^\]]*)\]\(([^)]+)\)$/

export interface VideoCandidate {
  /** The whole markdown card, to be swapped for a player. */
  markdown: string
  watchUrl: string
  poster: string | null
  label: string
}

/**
 * The videos an article's Markdown points at. Only URLs the shared parser
 * recognises count, which keeps what is handed to the downloader to a short
 * allowlist rather than anything link-shaped in the page.
 */
export function findArchivableVideos(fullText: string): VideoCandidate[] {
  const found: VideoCandidate[] = []
  const seen = new Set<string>()

  for (const match of fullText.matchAll(MARKDOWN_LINK_RE)) {
    const [markdown, inner, url] = match
    const video = parseVideoUrl(url)
    if (!video || seen.has(video.watchUrl)) continue
    seen.add(video.watchUrl)

    const image = MARKDOWN_IMAGE_RE.exec(inner)
    found.push({
      markdown,
      watchUrl: video.watchUrl,
      poster: image ? image[2] : null,
      label: image ? image[1] : inner,
    })
  }

  return found
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** The player that replaces the card once the file is on disk. */
export function videoPlayerMarkup(candidate: VideoCandidate, src: string): string {
  const attrs = ['controls', 'preload="none"', `src="${escapeAttribute(src)}"`]
  if (candidate.poster) attrs.push(`poster="${escapeAttribute(candidate.poster)}"`)
  if (candidate.label) attrs.push(`title="${escapeAttribute(candidate.label)}"`)
  return `<video ${attrs.join(' ')}></video>`
}

async function download(watchUrl: string, filepath: string): Promise<void> {
  const maxHeight = getMaxHeight()
  await execFileAsync(
    getDownloaderBin(),
    [
      // Prefer a single already-muxed file: merging separate video and audio
      // streams would make ffmpeg a second required dependency.
      '-f', `best[height<=?${maxHeight}][ext=mp4]/best[height<=?${maxHeight}]/best`,
      '--max-filesize', `${getMaxSizeMb()}m`,
      '--no-playlist',
      '--no-progress',
      '--quiet',
      '-o', filepath,
      watchUrl,
    ],
    { timeout: DOWNLOAD_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 },
  )
}

export interface ArchiveVideosResult {
  rewrittenText: string
  downloaded: number
  errors: number
}

/**
 * Download every video an article embeds and point the article at the copies.
 *
 * Errors are counted, never thrown: one video that refuses to download must
 * not cost the reader the others, nor the article's text.
 */
export async function archiveArticleVideos(
  articleId: number,
  fullText: string,
): Promise<ArchiveVideosResult> {
  const candidates = findArchivableVideos(fullText)
  if (candidates.length === 0) {
    markVideosArchived(articleId)
    return { rewrittenText: fullText, downloaded: 0, errors: 0 }
  }

  const videosDir = getVideosDir()
  fs.mkdirSync(videosDir, { recursive: true })

  let rewrittenText = fullText
  let downloaded = 0
  let errors = 0

  for (const candidate of candidates) {
    const hash = crypto.createHash('sha256').update(candidate.watchUrl).digest('hex').slice(0, 12)
    const filename = `${articleId}_${hash}.mp4`
    const filepath = path.join(videosDir, filename)

    try {
      if (!fs.existsSync(filepath)) await download(candidate.watchUrl, filepath)
      // yt-dlp exits 0 without writing anything when the file exceeds
      // --max-filesize, so the file's existence is the real success signal.
      if (!fs.existsSync(filepath)) {
        log.warn({ articleId, url: candidate.watchUrl }, 'video archive: nothing downloaded, likely over the size cap')
        errors++
        continue
      }
      rewrittenText = rewrittenText.replace(
        candidate.markdown,
        videoPlayerMarkup(candidate, `/api/articles/videos/${filename}`),
      )
      downloaded++
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.warn({ articleId, url: candidate.watchUrl, err: message }, 'video archive failed')
      errors++
    }
  }

  if (downloaded > 0) updateArticleContent(articleId, { full_text: rewrittenText })
  markVideosArchived(articleId)

  return { rewrittenText, downloaded, errors }
}

/** Delete an article's archived videos. Mirrors deleteArticleImages. */
export function deleteArticleVideos(articleId: number): number {
  const videosDir = getVideosDir()
  if (!fs.existsSync(videosDir)) return 0

  const prefix = `${articleId}_`
  const files = fs.readdirSync(videosDir).filter(f => f.startsWith(prefix))
  for (const file of files) {
    fs.unlinkSync(path.join(videosDir, file))
  }
  return files.length
}
