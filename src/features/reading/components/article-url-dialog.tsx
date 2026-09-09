import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiPost, ApiError } from '@/lib/fetcher'
import { useI18n } from '@/i18n'
import { articleUrlToPath } from '@/lib/url'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import * as VisuallyHidden from '@radix-ui/react-visually-hidden'
import { Button } from '@/components/ui/button'

interface ArticleUrlDialogProps {
  onClose: () => void
  onCreated: () => void
}

export function ArticleUrlDialog({ onClose, onCreated }: ArticleUrlDialogProps) {
  const { t } = useI18n()
  const navigate = useNavigate()
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<{ message: string; isInfo?: boolean } | null>(null)
  const [conflict, setConflict] = useState<{
    article: { id: number; url: string; feed_id: number; feed_name: string }
  } | null>(null)

  async function handleSubmit(e: React.FormEvent, force = false) {
    e.preventDefault()
    if (!url.trim()) return
    setError(null)
    setConflict(null)
    setLoading(true)
    try {
      await apiPost('/api/articles/from-url', { url: url.trim(), force })
      onCreated()
      onClose()
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && err.data.can_force) {
        setConflict({ article: err.data.article as { id: number; url: string; feed_id: number; feed_name: string } })
      } else if (err instanceof ApiError && err.status === 409) {
        setError({ message: t('modal.clipAlreadyExists'), isInfo: true })
      } else {
        setError({ message: err instanceof Error ? err.message : t('modal.genericError') })
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="max-w-sm" aria-describedby={undefined}>
      <VisuallyHidden.Root><DialogTitle>{t('feeds.clipArticle')}</DialogTitle></VisuallyHidden.Root>
      <h2 className="text-base font-semibold mb-4">{t('feeds.clipArticle')}</h2>
      {conflict ? (
        <div className="space-y-3">
          <p className="text-sm text-text">
            {t('modal.clipExistsInFeed')}
            <a
              href={`/feeds/${conflict.article.feed_id}`}
              className="text-accent hover:underline"
              onClick={(e) => { e.preventDefault(); onClose(); void navigate(`/feeds/${conflict.article.feed_id}`) }}
            >
              {conflict.article.feed_name}
            </a>
            {t('modal.clipExistsInFeedSuffix')}
          </p>
          <p className="text-sm">
            <a
              href={articleUrlToPath(conflict.article.url)}
              className="text-accent hover:underline"
              onClick={(e) => { e.preventDefault(); onClose(); void navigate(articleUrlToPath(conflict.article.url)) }}
            >
              {t('modal.clipViewArticle')}
            </a>
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => { setConflict(null) }}>
              {t('modal.cancel')}
            </Button>
            <Button
              disabled={loading}
              onClick={() => handleSubmit({ preventDefault: () => {} } as React.FormEvent, true)}
            >
              {loading ? t('modal.adding') : t('modal.clipMoveToClips')}
            </Button>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-3">
          <Input
            type="url"
            placeholder={t('feeds.articleUrlPlaceholder')}
            value={url}
            onChange={e => setUrl(e.target.value)}
            autoFocus
            required
          />
          {error && <p className={`text-xs ${error.isInfo ? 'text-muted' : 'text-error'}`}>{error.message}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              {t('modal.cancel')}
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? t('modal.adding') : t('modal.add')}
            </Button>
          </div>
        </form>
      )}
      </DialogContent>
    </Dialog>
  )
}
