import { useState, useCallback, useEffect } from 'react'
import useSWR from 'swr'
import { fetcher, apiPost, apiPatch, apiDelete } from '../../../lib/fetcher'
import { Input } from '@/components/ui/input'
import { FormField } from '@/components/ui/form-field'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useI18n } from '@/i18n'
import { formatRelativeDate } from '../../../lib/dateFormat'
import {
  useGitBackups,
  sqliteUtcToIso,
  shortRefName,
  type GitBackup,
  type GitBackupStatus,
} from '../../../lib/git-backups'

type TFunc = (key: any, params?: Record<string, string>) => string

interface GitBackupConfig {
  forgejo_url: string
  forgejo_owner: string
  token_configured: boolean
}

const STATUS_DOT: Record<GitBackupStatus, string> = {
  importing: 'bg-muted animate-pulse',
  ok: 'bg-success',
  blocked: 'bg-warning',
  frozen: 'bg-muted',
  error: 'bg-error',
}

const BUTTON = 'px-3 py-1 text-xs rounded-lg border border-border text-muted hover:text-text hover:bg-hover transition-colors disabled:opacity-50 select-none shrink-0'
const PRIMARY_BUTTON = 'px-3 py-1.5 text-xs font-medium rounded-lg bg-accent text-accent-text hover:opacity-90 transition-opacity disabled:opacity-50 select-none shrink-0'

type PendingConfirm = { kind: 'accept' | 'remove'; backup: GitBackup }

export function GitBackupSection({ t }: { t: TFunc }) {
  const { locale } = useI18n()
  const { data: config, mutate: mutateConfig } = useSWR<GitBackupConfig>(
    '/api/settings/git-backup',
    fetcher,
    { revalidateOnFocus: false },
  )
  const [pollUntil, setPollUntil] = useState(0)
  const { backups, forgejoUrl, configured, mutate } = useGitBackups({ pollWhile: pollUntil > Date.now() })

  const [urlInput, setUrlInput] = useState('')
  const [ownerInput, setOwnerInput] = useState('')
  const [tokenInput, setTokenInput] = useState('')
  const [repoInput, setRepoInput] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<PendingConfirm | null>(null)
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null)

  useEffect(() => {
    if (!config) return
    setUrlInput(config.forgejo_url ?? '')
    setOwnerInput(config.forgejo_owner ?? '')
  }, [config])

  // Stop polling once the background "sync all" has had time to finish.
  useEffect(() => {
    if (pollUntil <= Date.now()) return
    const timer = setTimeout(() => setPollUntil(0), pollUntil - Date.now())
    return () => clearTimeout(timer)
  }, [pollUntil])

  function showMessage(text: string, type: 'success' | 'error') {
    setMessage({ text, type })
    setTimeout(() => setMessage(null), 5000)
  }

  const run = useCallback(async (key: string, action: () => Promise<unknown>, success?: string) => {
    setBusy(key)
    try {
      await action()
      if (success) showMessage(success, 'success')
    } catch (err: unknown) {
      showMessage(err instanceof Error ? err.message : 'Request failed', 'error')
    } finally {
      setBusy(null)
      void mutate()
    }
  }, [mutate])

  const handleSaveConfig = () => run('config', async () => {
    await apiPatch('/api/settings/git-backup', { forgejo_url: urlInput.trim(), forgejo_owner: ownerInput.trim() })
    await mutateConfig()
  }, t('gitBackup.configSaved'))

  const handleSaveToken = () => run('token', async () => {
    await apiPost('/api/settings/api-keys/forgejo', { apiKey: tokenInput })
    setTokenInput('')
    await mutateConfig()
  }, t('gitBackup.tokenSaved'))

  const handleDeleteToken = () => run('token', async () => {
    await apiPost('/api/settings/api-keys/forgejo', { apiKey: '' })
    await mutateConfig()
  }, t('gitBackup.tokenDeleted'))

  const handleAdd = () => run('add', async () => {
    await apiPost('/api/git-backups', { url: repoInput.trim() })
    setRepoInput('')
  }, t('gitBackup.added'))

  const handleSyncAll = () => run('sync-all', async () => {
    const { queued } = await apiPost('/api/git-backups/sync-all') as { queued: number }
    // Each check takes a few GitHub calls; give the batch time to land.
    setPollUntil(Date.now() + Math.max(10_000, queued * 5_000))
  }, t('gitBackup.syncAllStarted'))

  const action = (backup: GitBackup, name: 'sync' | 'freeze' | 'accept') =>
    run(`${name}-${backup.id}`, () => apiPost(`/api/git-backups/${backup.id}/${name}`))

  const handleConfirm = () => {
    if (!confirm) return
    const { kind, backup } = confirm
    setConfirm(null)
    if (kind === 'accept') void action(backup, 'accept')
    else void run(`remove-${backup.id}`, () => apiDelete(`/api/git-backups/${backup.id}`))
  }

  const configDirty = !!config && (urlInput.trim() !== (config.forgejo_url ?? '') || ownerInput.trim() !== (config.forgejo_owner ?? ''))

  return (
    <section>
      <h2 className="text-base font-semibold text-text mb-1">{t('gitBackup.sectionTitle')}</h2>
      <p className="text-xs text-muted mb-4">{t('gitBackup.sectionDesc')}</p>

      <div className="p-3 rounded-lg bg-bg-card border border-border space-y-4">
        <FormField label={t('gitBackup.forgejoUrl')} hint={t('gitBackup.forgejoUrlDesc')} compact>
          <Input
            type="url"
            value={urlInput}
            onChange={e => setUrlInput(e.target.value)}
            placeholder="http://forgejo.lan:3000"
            className="py-1.5"
          />
        </FormField>
        <FormField label={t('gitBackup.owner')} hint={t('gitBackup.ownerDesc')} compact>
          <div className="flex items-center gap-2">
            <Input
              type="text"
              value={ownerInput}
              onChange={e => setOwnerInput(e.target.value)}
              placeholder="backups"
              className="flex-1 py-1.5"
            />
            {configDirty && (
              <button type="button" onClick={handleSaveConfig} disabled={busy === 'config'} className={PRIMARY_BUTTON}>
                {busy === 'config' ? '...' : t('settings.save')}
              </button>
            )}
          </div>
        </FormField>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full shrink-0 ${config?.token_configured ? 'bg-success' : 'bg-error'}`} />
            <span className="text-sm font-medium text-text select-none">{t('gitBackup.token')}</span>
            <span className="text-xs text-muted select-none">
              {config?.token_configured ? t('chat.apiKeyConfigured') : t('chat.apiKeyNotSet')}
            </span>
          </div>
          {config?.token_configured && (
            <button type="button" onClick={handleDeleteToken} disabled={busy === 'token'} className={BUTTON}>
              {t('chat.apiKeyDelete')}
            </button>
          )}
        </div>
        {config && !config.token_configured && (
          <FormField label={t('gitBackup.token')} hint={t('gitBackup.tokenDesc')} compact>
            <div className="flex items-center gap-2">
              <Input
                type="password"
                value={tokenInput}
                onChange={e => setTokenInput(e.target.value)}
                className="flex-1 py-1.5"
              />
              {tokenInput && (
                <button type="button" onClick={handleSaveToken} disabled={busy === 'token'} className={PRIMARY_BUTTON}>
                  {busy === 'token' ? '...' : t('settings.save')}
                </button>
              )}
            </div>
          </FormField>
        )}
      </div>

      {configured && (
        <div className="mt-3 p-3 rounded-lg bg-bg-card border border-border space-y-3">
          <FormField label={t('gitBackup.repoUrl')} hint={t('gitBackup.repoUrlDesc')} compact>
            <div className="flex items-center gap-2">
              <Input
                type="text"
                value={repoInput}
                onChange={e => setRepoInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && repoInput.trim()) void handleAdd() }}
                placeholder="https://github.com/owner/repo"
                className="flex-1 py-1.5"
              />
              <button type="button" onClick={handleAdd} disabled={busy === 'add' || !repoInput.trim()} className={PRIMARY_BUTTON}>
                {busy === 'add' ? '...' : t('gitBackup.add')}
              </button>
            </div>
          </FormField>

          {backups.length > 0 && (
            <div className="flex items-center justify-between pt-1">
              <span className="text-xs text-muted select-none">{t('gitBackup.count', { count: String(backups.length) })}</span>
              <button type="button" onClick={handleSyncAll} disabled={busy === 'sync-all'} className={BUTTON}>
                {busy === 'sync-all' ? '...' : t('gitBackup.syncAll')}
              </button>
            </div>
          )}

          <ul className="divide-y divide-border">
            {backups.map(backup => (
              <BackupRow
                key={backup.id}
                backup={backup}
                forgejoUrl={forgejoUrl}
                busy={busy}
                locale={locale}
                t={t}
                onSync={() => void action(backup, 'sync')}
                onFreeze={() => void action(backup, 'freeze')}
                onAccept={() => setConfirm({ kind: 'accept', backup })}
                onRemove={() => setConfirm({ kind: 'remove', backup })}
              />
            ))}
          </ul>
        </div>
      )}

      {message && (
        <p className={`mt-2 text-xs ${message.type === 'error' ? 'text-error' : 'text-accent'}`}>{message.text}</p>
      )}

      {confirm && (
        <ConfirmDialog
          title={confirm.kind === 'accept' ? t('gitBackup.acceptTitle') : t('gitBackup.removeTitle')}
          message={confirm.kind === 'accept' ? t('gitBackup.acceptMessage') : t('gitBackup.removeMessage')}
          confirmLabel={confirm.kind === 'accept' ? t('gitBackup.accept') : t('gitBackup.remove')}
          danger
          onConfirm={handleConfirm}
          onCancel={() => setConfirm(null)}
        />
      )}
    </section>
  )
}

function BackupRow({
  backup,
  forgejoUrl,
  busy,
  locale,
  t,
  onSync,
  onFreeze,
  onAccept,
  onRemove,
}: {
  backup: GitBackup
  forgejoUrl: string | null
  busy: string | null
  locale: string
  t: TFunc
  onSync: () => void
  onFreeze: () => void
  onAccept: () => void
  onRemove: () => void
}) {
  const name = `${backup.github_owner}/${backup.github_repo}`
  const syncedAt = sqliteUtcToIso(backup.last_synced_at)
  const isBusy = busy !== null && busy.endsWith(`-${backup.id}`)

  return (
    <li className="py-2.5 space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`w-2 h-2 rounded-full shrink-0 ${STATUS_DOT[backup.status]}`} />
          <a
            href={`https://github.com/${name}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-medium text-text hover:text-accent truncate"
          >
            {name}
          </a>
          {forgejoUrl && backup.status !== 'importing' && (
            <a
              href={`${forgejoUrl}/${backup.forgejo_owner}/${backup.forgejo_repo}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-muted hover:text-accent shrink-0"
            >
              Forgejo ↗
            </a>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {backup.status !== 'frozen' && backup.status !== 'importing' && (
            <button type="button" onClick={onSync} disabled={isBusy} className={BUTTON}>
              {busy === `sync-${backup.id}` ? '...' : t('gitBackup.sync')}
            </button>
          )}
          <button type="button" onClick={onRemove} disabled={isBusy} className={BUTTON}>
            {t('gitBackup.remove')}
          </button>
        </div>
      </div>

      <p className="text-xs text-muted">
        {t(`gitBackup.status.${backup.status}`)}
        {syncedAt && ` · ${t('gitBackup.lastSynced', { when: formatRelativeDate(syncedAt, locale) })}`}
      </p>

      {backup.last_error && <p className="text-xs text-error break-words">{backup.last_error}</p>}

      {backup.status === 'blocked' && backup.blocked_refs.length > 0 && (
        <div className="p-2 rounded border border-border space-y-2">
          <p className="text-xs text-text">{t('gitBackup.blockedIntro')}</p>
          <ul className="text-xs text-muted space-y-0.5">
            {backup.blocked_refs.map(loss => (
              <li key={loss.ref}>
                <code className="text-text">{shortRefName(loss.ref)}</code>
                {' — '}
                {loss.kind === 'deleted' ? t('gitBackup.lossDeleted') : t('gitBackup.lossRewritten')}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-1.5">
            <button type="button" onClick={onFreeze} disabled={isBusy} className={BUTTON}>
              {t('gitBackup.freeze')}
            </button>
            <button type="button" onClick={onAccept} disabled={isBusy} className={BUTTON}>
              {t('gitBackup.accept')}
            </button>
          </div>
        </div>
      )}

      {backup.status === 'frozen' && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted">{t('gitBackup.frozenDesc')}</span>
          <button type="button" onClick={onAccept} disabled={isBusy} className={BUTTON}>
            {t('gitBackup.accept')}
          </button>
        </div>
      )}
    </li>
  )
}
