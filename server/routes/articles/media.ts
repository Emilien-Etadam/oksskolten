import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { getArticleById } from '../../db.js'
import { archiveArticleImages, isImageArchivingEnabled } from '../../fetcher/article-images.js'
import { archiveArticleVideos, isVideoArchivingEnabled, findArchivableVideos } from '../../fetcher/article-videos.js'
import { getSetting } from '../../db/settings.js'
import path from 'node:path'
import fs from 'node:fs'
import { dataPath } from '../../paths.js'
import { NumericIdParams, parseOrBadRequest } from '../../lib/validation.js'

const FilenameParams = z.object({ filename: z.string() })

export async function articleMediaRoutes(api: FastifyInstance): Promise<void> {
  // --- Image archiving ---

  api.post(
    '/api/articles/:id/archive-images',
    async (request, reply) => {
      const params = parseOrBadRequest(NumericIdParams, request.params, reply)
      if (!params) return
      const article = getArticleById(params.id)
      if (!article) {
        reply.status(404).send({ error: 'Article not found' })
        return
      }
      if (!article.full_text) {
        reply.status(400).send({ error: 'No full text available' })
        return
      }
      if (!isImageArchivingEnabled()) {
        reply.status(400).send({ error: 'Image archiving is not enabled' })
        return
      }
      if (article.images_archived_at) {
        reply.status(409).send({ error: 'Images already archived' })
        return
      }

      // Return 202 and process in background
      reply.status(202).send({ status: 'accepted' })

      // Background processing
      archiveArticleImages(article.id, article.full_text).catch(err => {
        request.log.error(err, 'archive-images failed')
      })
    },
  )

  // --- Video archiving ---
  //
  // The same shape as image archiving, for the same reason: the reader asks
  // for one article, the work happens in the background, the copy is served
  // from here. Never automatic — a video is three orders of magnitude larger
  // than the images beside it.

  api.post(
    '/api/articles/:id/archive-video',
    async (request, reply) => {
      const params = parseOrBadRequest(NumericIdParams, request.params, reply)
      if (!params) return
      const article = getArticleById(params.id)
      if (!article) {
        reply.status(404).send({ error: 'Article not found' })
        return
      }
      if (!article.full_text) {
        reply.status(400).send({ error: 'No full text available' })
        return
      }
      if (!isVideoArchivingEnabled()) {
        reply.status(400).send({ error: 'Video archiving is not enabled' })
        return
      }
      if (article.videos_archived_at) {
        reply.status(409).send({ error: 'Video already archived' })
        return
      }
      if (findArchivableVideos(article.full_text).length === 0) {
        reply.status(400).send({ error: 'No video to archive' })
        return
      }

      // Return 202 and process in background: a download runs for minutes.
      reply.status(202).send({ status: 'accepted' })

      archiveArticleVideos(article.id, article.full_text).catch(err => {
        request.log.error(err, 'archive-video failed')
      })
    },
  )

  // --- Serve archived images ---

  api.get(
    '/api/articles/images/:filename',
    async (request, reply) => {
      const { filename } = FilenameParams.parse(request.params)

      // Sanitize filename to prevent path traversal
      const sanitized = path.basename(filename)
      if (sanitized !== filename || filename.includes('..')) {
        reply.status(400).send({ error: 'Invalid filename' })
        return
      }

      const storagePath = getSetting('images.storage_path') || dataPath('articles', 'images')
      const filepath = path.join(storagePath, sanitized)

      if (!fs.existsSync(filepath)) {
        reply.status(404).send({ error: 'Image not found' })
        return
      }

      const ext = path.extname(sanitized).toLowerCase()
      const mimeMap: Record<string, string> = {
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
        '.svg': 'image/svg+xml',
        '.avif': 'image/avif',
      }
      const contentType = mimeMap[ext] || 'application/octet-stream'

      reply.header('Content-Type', contentType)
      reply.header('Cache-Control', 'public, max-age=31536000, immutable')
      reply.send(fs.createReadStream(filepath))
    },
  )

  // --- Serve archived videos ---
  //
  // Unlike an image, a video is not simply sent: <video> seeks by asking for
  // byte ranges, and a server that ignores them gives the reader a clip it can
  // only watch from the start.

  api.get(
    '/api/articles/videos/:filename',
    async (request, reply) => {
      const { filename } = FilenameParams.parse(request.params)

      // Sanitize filename to prevent path traversal
      const sanitized = path.basename(filename)
      if (sanitized !== filename || filename.includes('..')) {
        reply.status(400).send({ error: 'Invalid filename' })
        return
      }

      const storagePath = getSetting('videos.storage_path') || dataPath('articles', 'videos')
      const filepath = path.join(storagePath, sanitized)

      if (!fs.existsSync(filepath)) {
        reply.status(404).send({ error: 'Video not found' })
        return
      }

      const size = fs.statSync(filepath).size
      reply.header('Content-Type', 'video/mp4')
      reply.header('Accept-Ranges', 'bytes')
      reply.header('Cache-Control', 'public, max-age=31536000, immutable')

      const range = request.headers.range
      if (!range) {
        reply.send(fs.createReadStream(filepath))
        return
      }

      const parsed = parseByteRange(range, size)
      if (!parsed) {
        reply.status(416).header('Content-Range', `bytes */${size}`).send()
        return
      }

      const { start, end } = parsed
      reply.status(206)
      reply.header('Content-Range', `bytes ${start}-${end}/${size}`)
      reply.header('Content-Length', end - start + 1)
      reply.send(fs.createReadStream(filepath, { start, end }))
    },
  )

}

/**
 * A single byte range, resolved against the file's size. Returns null for
 * anything unsatisfiable or beyond one range, which the caller answers with
 * 416 — multipart ranges are legal but no player asks for them.
 */
export function parseByteRange(header: string, size: number): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!match) return null
  const [, rawStart, rawEnd] = match

  let start: number
  let end: number
  if (rawStart === '') {
    // A suffix range asks for the last N bytes.
    const suffix = Number(rawEnd)
    if (!rawEnd || !Number.isFinite(suffix) || suffix <= 0) return null
    start = Math.max(0, size - suffix)
    end = size - 1
  } else {
    start = Number(rawStart)
    end = rawEnd === '' ? size - 1 : Math.min(Number(rawEnd), size - 1)
  }

  if (!Number.isFinite(start) || !Number.isFinite(end)) return null
  if (start >= size || end < start) return null
  return { start, end }
}
