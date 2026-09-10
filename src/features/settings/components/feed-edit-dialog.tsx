import { useState } from 'react'
import { toast } from 'sonner'
import { useI18n } from '@/i18n'
import { apiPatch } from '@/lib/fetcher'
import { useFetchProgressContext } from '@/contexts/fetch-progress-context'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import type { FeedWithCounts } from '../../../../shared/types'

interface FeedEditDialogProps {
  feed: FeedWithCounts
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}

function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value)
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * Edit what a feed points at. Until now a feed's address could only be set
 * when it was created (or rewritten by re-detection), so a source that moved
 * its RSS document had to be deleted and added again, losing its articles.
 *
 * An empty feed URL is allowed: feeds served through RSS Bridge have none.
 *
 * A saved URL change is fetched right away — the point of fixing an address is
 * to see whether it works — unless the feed is disabled, which the fetch
 * endpoint refuses.
 */
export function FeedEditDialog({ feed, onOpenChange, onSaved }: FeedEditDialogProps) {
  const { t } = useI18n()
  const { startFeedFetch } = useFetchProgressContext()
  const [name, setName] = useState(feed.name)
  const [url, setUrl] = useState(feed.url)
  const [rssUrl, setRssUrl] = useState(feed.rss_url ?? '')
  const [saving, setSaving] = useState(false)

  const trimmedRss = rssUrl.trim()
  const urlValid = isHttpUrl(url.trim())
  const rssValid = trimmedRss === '' || isHttpUrl(trimmedRss)
  const urlChanged = url.trim() !== feed.url || (trimmedRss || null) !== (feed.rss_url ?? null)
  const changed = name.trim() !== feed.name || urlChanged
  const canSave = name.trim().length > 0 && urlValid && rssValid && changed

  async function fetchAfterSave(feedName: string) {
    const result = await startFeedFetch(feed.id)
    if (result.error) toast.error(t('toast.fetchError', { name: feedName }))
    else if (result.totalNew > 0) toast.success(t('toast.fetchedArticles', { count: String(result.totalNew), name: feedName }))
    else toast(t('toast.noNewArticles', { name: feedName }))
  }

  async function handleSave() {
    if (!canSave || saving) return
    setSaving(true)
    try {
      await apiPatch(`/api/feeds/${feed.id}`, {
        name: name.trim(),
        url: url.trim(),
        rss_url: trimmedRss || null,
      })
      toast.success(t('settings.feedsEditSaved'))
      onSaved()
      onOpenChange(false)
      // The dialog is gone by now; the fetch runs in the provider and
      // announces itself with a toast.
      if (urlChanged && !feed.disabled) void fetchAfterSave(name.trim())
    } catch {
      toast.error(t('settings.feedsEditFailed'))
    } finally {
      setSaving(false)
    }
  }

  const submitOnEnter = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      void handleSave()
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('settings.feedsEdit')}</DialogTitle>
          <DialogDescription>{t('settings.feedsEditDesc')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-1">
          <label htmlFor="feed-edit-name" className="text-xs text-muted">{t('settings.feedsEditName')}</label>
          <Input id="feed-edit-name" value={name} onChange={e => setName(e.target.value)} onKeyDown={submitOnEnter} autoFocus />
        </div>

        <div className="space-y-1">
          <label htmlFor="feed-edit-rss-url" className="text-xs text-muted">{t('settings.feedsEditRssUrl')}</label>
          <Input
            id="feed-edit-rss-url"
            value={rssUrl}
            onChange={e => setRssUrl(e.target.value)}
            placeholder="https://example.com/feed.xml"
            onKeyDown={submitOnEnter}
            className="font-mono text-xs"
            aria-invalid={!rssValid}
          />
          <p className={`text-xs ${rssValid ? 'text-muted' : 'text-error'}`}>
            {rssValid ? t('settings.feedsEditRssHint') : t('settings.feedsEditInvalidUrl')}
          </p>
        </div>

        <div className="space-y-1">
          <label htmlFor="feed-edit-site-url" className="text-xs text-muted">{t('settings.feedsEditSiteUrl')}</label>
          <Input
            id="feed-edit-site-url"
            value={url}
            onChange={e => setUrl(e.target.value)}
            placeholder="https://example.com"
            onKeyDown={submitOnEnter}
            className="font-mono text-xs"
            aria-invalid={!urlValid}
          />
          {!urlValid && <p className="text-xs text-error">{t('settings.feedsEditInvalidUrl')}</p>}
        </div>

        <DialogFooter>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="px-3 py-1.5 text-[13px] text-muted hover:text-text"
          >
            {t('modal.cancel')}
          </button>
          <button
            type="button"
            onClick={() => { void handleSave() }}
            disabled={!canSave || saving}
            className="px-3 py-1.5 text-[13px] rounded-md bg-accent text-accent-text disabled:opacity-50"
          >
            {t('settings.save')}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
