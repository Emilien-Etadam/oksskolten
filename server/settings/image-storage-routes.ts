import type { FastifyInstance } from 'fastify'
import { getSetting, upsertSetting, deleteSetting } from '../db.js'
import { requireJson } from '../auth/index.js'
import { assertSafeUrl } from '../fetcher/ssrf.js'
import { extractByDotPath } from '../fetcher/article-images.js'

export async function imageStorageRoutes(api: FastifyInstance): Promise<void> {
  // --- Image storage settings ---

  api.get('/api/settings/image-storage', async (_request, reply) => {
    const enabled = getSetting('images.enabled') ?? null
    const mode = getSetting('images.storage') ?? 'local'
    const storagePath = getSetting('images.storage_path') ?? null
    const maxSizeMb = getSetting('images.max_size_mb') ?? null
    const url = getSetting('images.upload_url') ?? ''
    const headersRaw = getSetting('images.upload_headers')
    const fieldName = getSetting('images.upload_field') ?? 'image'
    const respPath = getSetting('images.upload_resp_path') ?? ''
    const healthcheckUrl = getSetting('images.healthcheck_url') ?? ''
    reply.send({
      'images.enabled': enabled,
      mode,
      url,
      headersConfigured: !!headersRaw,
      fieldName,
      respPath,
      healthcheckUrl,
      'images.storage_path': storagePath,
      'images.max_size_mb': maxSizeMb,
    })
  })

  api.patch(
    '/api/settings/image-storage',
    { preHandler: [requireJson] },
    async (request, reply) => {
      const body = request.body as Record<string, unknown> // dynamic keys, validated per-field below

      // Simple keys
      if (body['images.enabled'] !== undefined) {
        const val = String(body['images.enabled'])
        if (val === '') deleteSetting('images.enabled')
        else upsertSetting('images.enabled', val)
      }
      if (body['images.storage_path'] !== undefined) {
        const val = String(body['images.storage_path']).trim()
        if (val === '') deleteSetting('images.storage_path')
        else upsertSetting('images.storage_path', val)
      }
      if (body['images.max_size_mb'] !== undefined) {
        const val = String(body['images.max_size_mb']).trim()
        if (val === '') {
          deleteSetting('images.max_size_mb')
        } else {
          const num = Number(val)
          if (isNaN(num) || num <= 0 || num > 100) {
            reply.status(400).send({ error: 'max_size_mb must be 1-100' })
            return
          }
          upsertSetting('images.max_size_mb', val)
        }
      }

      // Remote upload keys
      if (body.mode !== undefined) {
        const mode = String(body.mode)
        if (mode !== 'local' && mode !== 'remote') {
          reply.status(400).send({ error: 'mode must be "local" or "remote"' })
          return
        }
        upsertSetting('images.storage', mode)
      }
      if (body.url !== undefined) {
        const urlVal = String(body.url).trim()
        if (urlVal) {
          try {
            await assertSafeUrl(urlVal)
          } catch {
            reply.status(400).send({ error: 'Invalid or blocked URL' })
            return
          }
          upsertSetting('images.upload_url', urlVal)
        } else {
          deleteSetting('images.upload_url')
        }
      }
      if (body.headers !== undefined) {
        const headersVal = String(body.headers).trim()
        if (headersVal === '') {
          deleteSetting('images.upload_headers')
        } else {
          try {
            const parsed = JSON.parse(headersVal)
            if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
              throw new Error('not an object')
            }
            upsertSetting('images.upload_headers', headersVal)
          } catch {
            reply.status(400).send({ error: 'headers must be valid JSON object' })
            return
          }
        }
      }
      if (body.fieldName !== undefined) {
        const fieldVal = String(body.fieldName).trim()
        if (fieldVal) upsertSetting('images.upload_field', fieldVal)
        else deleteSetting('images.upload_field')
      }
      if (body.respPath !== undefined) {
        const pathVal = String(body.respPath).trim()
        if (pathVal) upsertSetting('images.upload_resp_path', pathVal)
        else deleteSetting('images.upload_resp_path')
      }
      if (body.healthcheckUrl !== undefined) {
        const hcVal = String(body.healthcheckUrl).trim()
        if (hcVal) {
          try {
            await assertSafeUrl(hcVal)
          } catch {
            reply.status(400).send({ error: 'Invalid or blocked healthcheck URL' })
            return
          }
          upsertSetting('images.healthcheck_url', hcVal)
        } else {
          deleteSetting('images.healthcheck_url')
        }
      }

      // Return current state
      const enabled = getSetting('images.enabled') ?? null
      const mode = getSetting('images.storage') ?? 'local'
      const storagePath = getSetting('images.storage_path') ?? null
      const maxSizeMb = getSetting('images.max_size_mb') ?? null
      const url = getSetting('images.upload_url') ?? ''
      const headersRaw = getSetting('images.upload_headers')
      const fieldName = getSetting('images.upload_field') ?? 'image'
      const respPath = getSetting('images.upload_resp_path') ?? ''
      const healthcheckUrl = getSetting('images.healthcheck_url') ?? ''
      reply.send({
        'images.enabled': enabled,
        mode,
        url,
        headersConfigured: !!headersRaw,
        fieldName,
        respPath,
        healthcheckUrl,
        'images.storage_path': storagePath,
        'images.max_size_mb': maxSizeMb,
      })
    },
  )

  // --- Image storage test upload ---

  api.post('/api/settings/image-storage/test', async (_request, reply) => {
    const mode = getSetting('images.storage')
    if (mode !== 'remote') {
      reply.status(400).send({ error: 'Image storage mode is not set to remote' })
      return
    }

    const uploadUrl = getSetting('images.upload_url')
    const headersRaw = getSetting('images.upload_headers')
    const fieldName = getSetting('images.upload_field') ?? 'image'
    const respPath = getSetting('images.upload_resp_path')

    if (!uploadUrl || !respPath) {
      reply.status(400).send({ error: 'Remote upload settings are incomplete' })
      return
    }

    try {
      await assertSafeUrl(uploadUrl)
    } catch {
      reply.status(400).send({ error: 'Upload URL is blocked by SSRF protection' })
      return
    }

    // Generate 1x1 transparent PNG
    const png1x1 = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIABQAB' +
      'Nl7BcQAAAABJRU5ErkJggg==',
      'base64',
    )

    let headers: Record<string, string> = {}
    if (headersRaw) {
      try {
        headers = JSON.parse(headersRaw)
      } catch {
        reply.status(400).send({ error: 'Stored headers are invalid JSON' })
        return
      }
    }

    try {
      const formData = new FormData()
      formData.append(fieldName, new Blob([png1x1], { type: 'image/png' }), 'test.png')

      const res = await fetch(uploadUrl, {
        method: 'POST',
        headers,
        body: formData,
        signal: AbortSignal.timeout(15_000),
      })

      if (!res.ok) {
        const text = await res.text().catch(() => '')
        reply.status(400).send({ error: `Upload failed: ${res.status} ${text.slice(0, 200)}` })
        return
      }

      const json = await res.json()
      const extractedUrl = extractByDotPath(json, respPath)
      if (!extractedUrl || typeof extractedUrl !== 'string') {
        reply.status(400).send({ error: `Could not extract URL from response at path "${respPath}"` })
        return
      }

      reply.send({ success: true, url: extractedUrl })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      reply.status(400).send({ error: `Test upload failed: ${message}` })
    }
  })

  // --- Image storage healthcheck ---

  api.post('/api/settings/image-storage/healthcheck', async (_request, reply) => {
    const healthcheckUrl = getSetting('images.healthcheck_url')
    if (!healthcheckUrl) {
      reply.status(400).send({ error: 'Healthcheck URL is not configured' })
      return
    }

    try {
      await assertSafeUrl(healthcheckUrl)
    } catch {
      reply.status(400).send({ error: 'Healthcheck URL is blocked by SSRF protection' })
      return
    }

    try {
      const res = await fetch(healthcheckUrl, {
        method: 'GET',
        signal: AbortSignal.timeout(10_000),
      })

      if (res.ok) {
        reply.send({ success: true, status: res.status })
      } else {
        reply.status(502).send({ error: `Unhealthy: ${res.status} ${res.statusText}` })
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      reply.status(502).send({ error: `Healthcheck failed: ${message}` })
    }
  })
}
