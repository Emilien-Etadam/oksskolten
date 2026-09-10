import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import {
  getArticleById,
  markArticleSeen,
  markArticlesSeen,
  recordArticleRead,
  markArticleBookmarked,
  markArticleLiked,
  deleteArticle,
} from '../../db.js'
import { requireJson } from '../../auth/index.js'
import { deleteArticleImages } from '../../fetcher/article-images.js'
import { deleteArticleVideos } from '../../fetcher/article-videos.js'
import { NumericIdParams, parseOrBadRequest } from '../../lib/validation.js'

const MAX_BATCH_SEEN = 100
const SeenBody = z.object({ seen: z.boolean({ message: 'seen must be a boolean' }) })
const BookmarkBody = z.object({ bookmarked: z.boolean({ message: 'bookmarked must be a boolean' }) })
const LikeBody = z.object({ liked: z.boolean({ message: 'liked must be a boolean' }) })
const BatchSeenBody = z.object({
  ids: z.array(z.number()).min(1, 'ids must be a non-empty array').max(MAX_BATCH_SEEN, `Maximum ${MAX_BATCH_SEEN} ids per request`),
})

export async function articleStateRoutes(api: FastifyInstance): Promise<void> {
  api.patch(
    '/api/articles/:id/seen',
    { preHandler: [requireJson] },
    async (request, reply) => {
      const params = parseOrBadRequest(NumericIdParams, request.params, reply)
      if (!params) return
      const body = parseOrBadRequest(SeenBody, request.body, reply)
      if (!body) return
      const result = markArticleSeen(params.id, body.seen)
      if (!result) {
        reply.status(404).send({ error: 'Article not found' })
        return
      }
      reply.send(result)
    },
  )

  api.patch(
    '/api/articles/:id/bookmark',
    { preHandler: [requireJson] },
    async (request, reply) => {
      const params = parseOrBadRequest(NumericIdParams, request.params, reply)
      if (!params) return
      const body = parseOrBadRequest(BookmarkBody, request.body, reply)
      if (!body) return
      const result = markArticleBookmarked(params.id, body.bookmarked)
      if (!result) {
        reply.status(404).send({ error: 'Article not found' })
        return
      }
      reply.send(result)
    },
  )

  api.patch(
    '/api/articles/:id/like',
    { preHandler: [requireJson] },
    async (request, reply) => {
      const params = parseOrBadRequest(NumericIdParams, request.params, reply)
      if (!params) return
      const body = parseOrBadRequest(LikeBody, request.body, reply)
      if (!body) return
      const result = markArticleLiked(params.id, body.liked)
      if (!result) {
        reply.status(404).send({ error: 'Article not found' })
        return
      }
      reply.send(result)
    },
  )

  api.post(
    '/api/articles/batch-seen',
    { preHandler: [requireJson] },
    async (request, reply) => {
      const body = parseOrBadRequest(BatchSeenBody, request.body, reply)
      if (!body) return
      const result = markArticlesSeen(body.ids)
      reply.send(result)
    },
  )

  api.post(
    '/api/articles/:id/read',
    async (request, reply) => {
      const params = parseOrBadRequest(NumericIdParams, request.params, reply)
      if (!params) return
      const result = recordArticleRead(params.id)
      if (!result) {
        reply.status(404).send({ error: 'Article not found' })
        return
      }
      reply.send(result)
    },
  )

  api.delete(
    '/api/articles/:id',
    async (request, reply) => {
      const params = parseOrBadRequest(NumericIdParams, request.params, reply)
      if (!params) return
      const article = getArticleById(params.id)
      if (!article) {
        reply.status(404).send({ error: 'Article not found' })
        return
      }
      if (article.feed_type !== 'clip') {
        reply.status(403).send({ error: 'Only clipped articles can be deleted' })
        return
      }
      // Clean up archived images if any
      if (article.images_archived_at) {
        try {
          deleteArticleImages(article.id)
        } catch (err) {
          request.log.error(err, 'Failed to delete archived images')
        }
      }
      // Same for an archived video, which is far larger and worth reclaiming
      if (article.videos_archived_at) {
        try {
          deleteArticleVideos(article.id)
        } catch (err) {
          request.log.error(err, 'Failed to delete archived videos')
        }
      }
      deleteArticle(article.id)
      reply.status(204).send()
    },
  )

}
