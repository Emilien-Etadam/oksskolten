import { authHeaders } from './fetcher'
import type { TranslateFn } from './i18n'

type MessageKey = Parameters<TranslateFn>[0]

/** Fetch pipeline stages, in the order the server runs them. */
export type Stage = 'discovery' | 'bridge' | 'fetch' | 'parse'

export const STAGES: Stage[] = ['discovery', 'bridge', 'fetch', 'parse']

export interface Classification {
  failedStage: Stage
  i18nKey: MessageKey
  i18nParams?: Record<string, string>
  /** Suggested remedies, most likely to help first. */
  actions: Array<'reDetect' | 'fetch'>
}

/** Map a raw `feeds.last_error` string to the stage it failed at and what to do about it. */
export function classifyError(lastError: string): Classification {
  if (lastError === 'No RSS URL') {
    return { failedStage: 'discovery', i18nKey: 'feedError.noRssUrl', actions: ['reDetect'] }
  }

  if (lastError.includes('CssSelectorBridge')) {
    return { failedStage: 'bridge', i18nKey: 'feedError.cssBridgeFailed', actions: ['reDetect', 'fetch'] }
  }

  if (lastError === 'FlareSolverr failed') {
    return { failedStage: 'fetch', i18nKey: 'feedError.flareSolverrFailed', actions: ['fetch', 'reDetect'] }
  }

  const httpMatch = lastError.match(/HTTP (\d{3})/)
  if (httpMatch) {
    return { failedStage: 'fetch', i18nKey: 'feedError.httpError', i18nParams: { code: httpMatch[1] }, actions: ['fetch'] }
  }

  if (lastError.includes('Could not parse')) {
    return { failedStage: 'parse', i18nKey: 'feedError.parseFailed', actions: ['reDetect'] }
  }

  return { failedStage: 'fetch', i18nKey: 'feedError.unknown', actions: ['fetch'] }
}

/**
 * Call POST /api/feeds/:id/re-detect as SSE stream.
 * Invokes `onStage` when the server reports each detection stage.
 */
export function reDetectSSE(
  feedId: number,
  onStage: (stage: string) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const headers = authHeaders()
    fetch(`/api/feeds/${feedId}/re-detect`, {
      method: 'POST',
      headers: { ...headers },
      signal: AbortSignal.timeout(60_000),
    })
      .then(async (res) => {
        if (!res.ok || !res.body) {
          reject(new Error(`HTTP ${res.status}`))
          return
        }
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buf = ''
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          buf += decoder.decode(value, { stream: true })
          // Parse SSE lines
          const lines = buf.split('\n')
          buf = lines.pop()! // keep incomplete line
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue
            try {
              const data = JSON.parse(line.slice(6))
              if (data.type === 'stage') onStage(data.stage)
            } catch { /* skip malformed SSE JSON lines — non-critical progress updates */ }
          }
        }
        resolve()
      })
      .catch(reject)
  })
}
