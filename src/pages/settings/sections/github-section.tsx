import { useState, useCallback } from 'react'
import useSWR from 'swr'
import { fetcher, apiPost, authHeaders } from '../../../lib/fetcher'
import { logoutClient } from '../../../lib/auth'
import { Input } from '@/components/ui/input'
import { FormField } from '@/components/ui/form-field'
import { RadioGroup } from '@/components/ui/radio-group'
import type { Feed } from '../../../../shared/types'

type TFunc = (key: any, params?: Record<string, string>) => string

interface Settings {
  githubReleaseTypes: 'stable' | 'prerelease' | 'tags'
  setGithubReleaseTypes: (value: 'stable' | 'prerelease' | 'tags') => void
}

/**
 * POST /api/feeds always answers as an SSE stream (it also drives the
 * multi-step RSS discovery UI in the Add Feed dialog), even though a stars
 * URL resolves immediately with no discovery steps. Read just far enough to
 * find the terminal `done` or `error` event.
 */
async function createFeedFromUrl(url: string): Promise<{ feed?: Feed; error?: string }> {
  const res = await fetch('/api/feeds', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ url }),
  })

  if (res.status === 401) {
    logoutClient()
    return { error: 'Unauthorized' }
  }

  const contentType = res.headers.get('Content-Type') || ''
  if (!contentType.includes('text/event-stream')) {
    const data = await res.json().catch(() => ({}))
    return { error: data.error || res.statusText }
  }
  if (!res.body) return { error: 'Response body is null' }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop()!

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      let payload: Record<string, unknown>
      try {
        payload = JSON.parse(line.slice(6))
      } catch {
        continue
      }
      if (payload.type === 'error') return { error: String(payload.error) }
      if (payload.type === 'done') return { feed: payload.feed as Feed }
    }
  }
  return { error: 'No response from server' }
}

export function GithubSection({ t, settings }: { t: TFunc; settings: Settings }) {
  const { data: keyStatus, mutate: mutateKeyStatus } = useSWR<{ configured: boolean }>(
    '/api/settings/api-keys/github',
    fetcher,
    { revalidateOnFocus: false },
  )
  const isConfigured = keyStatus?.configured

  const [tokenInput, setTokenInput] = useState('')
  const [starsUrl, setStarsUrl] = useState('')
  const [savingToken, setSavingToken] = useState(false)
  const [creatingFeed, setCreatingFeed] = useState(false)
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null)

  function showMessage(text: string, type: 'success' | 'error') {
    setMessage({ text, type })
    setTimeout(() => setMessage(null), 4000)
  }

  const handleSaveToken = useCallback(async () => {
    if (savingToken || !tokenInput) return
    setSavingToken(true)
    try {
      await apiPost('/api/settings/api-keys/github', { apiKey: tokenInput })
      void mutateKeyStatus()
      setTokenInput('')
      showMessage(t('github.tokenSaved'), 'success')
    } catch (err: unknown) {
      showMessage(err instanceof Error ? err.message : 'Save failed', 'error')
    } finally {
      setSavingToken(false)
    }
  }, [savingToken, tokenInput, mutateKeyStatus, t])

  const handleDeleteToken = useCallback(async () => {
    if (savingToken) return
    setSavingToken(true)
    try {
      await apiPost('/api/settings/api-keys/github', { apiKey: '' })
      void mutateKeyStatus()
      showMessage(t('github.tokenDeleted'), 'success')
    } catch (err: unknown) {
      showMessage(err instanceof Error ? err.message : 'Delete failed', 'error')
    } finally {
      setSavingToken(false)
    }
  }, [savingToken, mutateKeyStatus, t])

  const handleCreateFeed = useCallback(async () => {
    if (creatingFeed || !starsUrl.trim()) return
    setCreatingFeed(true)
    try {
      const { feed, error } = await createFeedFromUrl(starsUrl.trim())
      if (error) {
        showMessage(
          error.includes('already exists') ? t('modal.errorAlreadyExists') : error,
          'error',
        )
      } else {
        setStarsUrl('')
        showMessage(t('github.feedCreated', { name: feed?.name ?? '' }), 'success')
      }
    } catch (err: unknown) {
      showMessage(err instanceof Error ? err.message : 'Request failed', 'error')
    } finally {
      setCreatingFeed(false)
    }
  }, [creatingFeed, starsUrl, t])

  return (
    <section>
      <h2 className="text-base font-semibold text-text mb-1">{t('github.sectionTitle')}</h2>
      <p className="text-xs text-muted mb-4">{t('github.sectionDesc')}</p>

      <div className="p-3 rounded-lg bg-bg-card border border-border space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full shrink-0 ${isConfigured ? 'bg-success' : 'bg-error'}`} />
            <span className="text-sm font-medium text-text select-none">{t('github.token')}</span>
            <span className="text-xs text-muted select-none">
              {isConfigured ? t('chat.apiKeyConfigured') : t('chat.apiKeyNotSet')}
            </span>
          </div>
          {isConfigured && (
            <button
              type="button"
              onClick={handleDeleteToken}
              disabled={savingToken}
              className="px-3 py-1 text-xs rounded-lg border border-border text-muted hover:text-text hover:bg-hover transition-colors disabled:opacity-50 select-none"
            >
              {t('chat.apiKeyDelete')}
            </button>
          )}
        </div>

        {!isConfigured && (
          <FormField label={t('github.token')} hint={t('github.tokenDesc')} compact>
            <div className="flex items-center gap-2">
              <Input
                type="password"
                value={tokenInput}
                onChange={e => setTokenInput(e.target.value)}
                placeholder="ghp_..."
                className="flex-1 py-1.5"
              />
              {tokenInput && (
                <button
                  type="button"
                  onClick={handleSaveToken}
                  disabled={savingToken}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg bg-accent text-accent-text hover:opacity-90 transition-opacity disabled:opacity-50 select-none shrink-0"
                >
                  {savingToken ? '...' : t('settings.save')}
                </button>
              )}
            </div>
          </FormField>
        )}

        <FormField label={t('github.starsUrl')} hint={t('github.starsUrlDesc')} compact>
          <div className="flex items-center gap-2">
            <Input
              type="text"
              value={starsUrl}
              onChange={e => setStarsUrl(e.target.value)}
              placeholder={t('github.starsUrlPlaceholder')}
              className="flex-1 py-1.5"
            />
            <button
              type="button"
              onClick={handleCreateFeed}
              disabled={creatingFeed || !starsUrl.trim()}
              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-accent text-accent-text hover:opacity-90 transition-opacity disabled:opacity-50 select-none shrink-0"
            >
              {creatingFeed ? '...' : t('github.createFeed')}
            </button>
          </div>
        </FormField>

        <div>
          <p className="text-xs text-muted mb-1.5 select-none">{t('github.releaseTypes')}</p>
          <RadioGroup
            name="githubReleaseTypes"
            options={[
              { value: 'stable' as const, label: t('github.releaseTypesStable') },
              { value: 'prerelease' as const, label: t('github.releaseTypesPrerelease') },
              { value: 'tags' as const, label: t('github.releaseTypesTags') },
            ]}
            value={settings.githubReleaseTypes}
            onChange={settings.setGithubReleaseTypes}
          />
        </div>

        {message && (
          <p className={`text-xs ${message.type === 'error' ? 'text-error' : 'text-accent'}`}>
            {message.text}
          </p>
        )}
      </div>
    </section>
  )
}
