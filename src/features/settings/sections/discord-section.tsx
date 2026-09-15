import { useState, useCallback } from 'react'
import useSWR from 'swr'
import { fetcher, apiPost } from '../../../lib/fetcher'
import { Input } from '@/components/ui/input'
import { FormField } from '@/components/ui/form-field'
import { createFeedFromUrl } from '../lib/create-feed-from-url'

type TFunc = (key: any, params?: Record<string, string>) => string

export function DiscordSection({ t }: { t: TFunc }) {
  const { data: keyStatus, mutate: mutateKeyStatus } = useSWR<{ configured: boolean }>(
    '/api/settings/api-keys/discord',
    fetcher,
    { revalidateOnFocus: false },
  )
  const isConfigured = keyStatus?.configured

  const [tokenInput, setTokenInput] = useState('')
  const [channelUrl, setChannelUrl] = useState('')
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
      await apiPost('/api/settings/api-keys/discord', { apiKey: tokenInput })
      void mutateKeyStatus()
      setTokenInput('')
      showMessage(t('discord.tokenSaved'), 'success')
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
      await apiPost('/api/settings/api-keys/discord', { apiKey: '' })
      void mutateKeyStatus()
      showMessage(t('discord.tokenDeleted'), 'success')
    } catch (err: unknown) {
      showMessage(err instanceof Error ? err.message : 'Delete failed', 'error')
    } finally {
      setSavingToken(false)
    }
  }, [savingToken, mutateKeyStatus, t])

  const handleCreateFeed = useCallback(async () => {
    if (creatingFeed || !channelUrl.trim()) return
    setCreatingFeed(true)
    try {
      const { feed, error } = await createFeedFromUrl(channelUrl.trim())
      if (error) {
        showMessage(
          error.includes('already exists') ? t('modal.errorAlreadyExists') : error,
          'error',
        )
      } else {
        setChannelUrl('')
        showMessage(t('discord.feedCreated', { name: feed?.name ?? '' }), 'success')
      }
    } catch (err: unknown) {
      showMessage(err instanceof Error ? err.message : 'Request failed', 'error')
    } finally {
      setCreatingFeed(false)
    }
  }, [creatingFeed, channelUrl, t])

  return (
    <section>
      <h2 className="text-base font-semibold text-text mb-1">{t('discord.sectionTitle')}</h2>
      <p className="text-xs text-muted mb-4">{t('discord.sectionDesc')}</p>

      <div className="p-3 rounded-lg bg-bg-card border border-border space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full shrink-0 ${isConfigured ? 'bg-success' : 'bg-error'}`} />
            <span className="text-sm font-medium text-text select-none">{t('discord.token')}</span>
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
          <FormField label={t('discord.token')} hint={t('discord.tokenDesc')} compact>
            <div className="flex items-center gap-2">
              <Input
                type="password"
                value={tokenInput}
                onChange={e => setTokenInput(e.target.value)}
                placeholder="MTIz..."
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

        <FormField label={t('discord.channelUrl')} hint={t('discord.channelUrlDesc')} compact>
          <div className="flex items-center gap-2">
            <Input
              type="text"
              value={channelUrl}
              onChange={e => setChannelUrl(e.target.value)}
              placeholder={t('discord.channelUrlPlaceholder')}
              className="flex-1 py-1.5"
            />
            <button
              type="button"
              onClick={handleCreateFeed}
              disabled={creatingFeed || !channelUrl.trim()}
              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-accent text-accent-text hover:opacity-90 transition-opacity disabled:opacity-50 select-none shrink-0"
            >
              {creatingFeed ? '...' : t('discord.createFeed')}
            </button>
          </div>
        </FormField>

        {message && (
          <p className={`text-xs ${message.type === 'error' ? 'text-error' : 'text-accent'}`}>
            {message.text}
          </p>
        )}
      </div>
    </section>
  )
}
