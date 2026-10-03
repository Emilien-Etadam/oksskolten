import { useState } from 'react'
import { Archive } from 'lucide-react'
import { ActionChip } from '@/components/ui/action-chip'
import { useI18n } from '@/i18n'
import { apiPost } from '../../../lib/fetcher'
import { useGitBackups } from '../../../lib/git-backups'
import { parseGithubRepoUrl } from '../../../../shared/github-repo'

/**
 * Offer to archive the GitHub repository an article points at — a release, a
 * trending entry, a README. Shown only once Forgejo is configured, and as a
 * plain marker when the repository is already archived.
 */
export function GitBackupChip({ url }: { url: string }) {
  const { t } = useI18n()
  const repo = parseGithubRepoUrl(url)
  const { configured, backups, mutate } = useGitBackups({ enabled: repo !== null })
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!repo || !configured) return null

  const backup = backups.find(b =>
    b.github_owner.toLowerCase() === repo.owner.toLowerCase()
    && b.github_repo.toLowerCase() === repo.repo.toLowerCase(),
  )

  if (adding || backup?.status === 'importing') {
    return (
      <ActionChip>
        <Archive className="w-3.5 h-3.5 animate-pulse" />
        <span className="text-muted">{t('article.archivingRepo')}</span>
      </ActionChip>
    )
  }

  if (backup) {
    return (
      <ActionChip active tooltip={t('article.repoArchived')}>
        <Archive className="w-3.5 h-3.5" />
      </ActionChip>
    )
  }

  const handleAdd = async () => {
    setAdding(true)
    setError(null)
    try {
      await apiPost('/api/git-backups', { url })
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Request failed')
    } finally {
      setAdding(false)
      void mutate()
    }
  }

  return (
    <ActionChip onClick={() => void handleAdd()} tooltip={error ?? t('article.archiveRepo')}>
      <Archive className={`w-3.5 h-3.5${error ? ' text-error' : ''}`} />
    </ActionChip>
  )
}
