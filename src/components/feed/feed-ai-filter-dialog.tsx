import { useState, useEffect } from 'react'
import { useI18n } from '../../lib/i18n'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from '../ui/dialog'

const MAX_CHARS = 1000

interface FeedAiFilterDialogProps {
  feedName: string
  /** Current criterion; null or empty means the filter is off */
  value: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSave: (criterion: string | null) => void | Promise<void>
}

/**
 * Per-feed AI relevance filter: the reader describes, in their own words, what
 * belongs in the feed. Articles the local model rejects are hidden from the
 * lists (their rows are kept).
 */
export function FeedAiFilterDialog({
  feedName,
  value,
  open,
  onOpenChange,
  onSave,
}: FeedAiFilterDialogProps) {
  const { t } = useI18n()
  const [draft, setDraft] = useState(value ?? '')
  const [saving, setSaving] = useState(false)

  // Reopening on another feed must not carry the previous draft over
  useEffect(() => {
    if (open) setDraft(value ?? '')
  }, [open, value])

  const handleSave = async () => {
    setSaving(true)
    try {
      await onSave(draft.trim() || null)
      onOpenChange(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('feeds.aiFilter')}</DialogTitle>
          <DialogDescription>
            {t('feeds.aiFilterDescription', { feed: feedName })}
          </DialogDescription>
        </DialogHeader>

        <textarea
          value={draft}
          onChange={e => setDraft(e.target.value.slice(0, MAX_CHARS))}
          rows={5}
          placeholder={t('feeds.aiFilterPlaceholder')}
          className="w-full rounded-md border border-border bg-bg-card px-3 py-2 text-[14px] text-text placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-accent resize-y"
        />
        <p className="text-[12px] text-muted">{t('feeds.aiFilterHint')}</p>

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
            disabled={saving}
            className="px-3 py-1.5 text-[13px] rounded-md bg-accent text-white disabled:opacity-50"
          >
            {t('settings.save')}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
