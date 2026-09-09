import { useState, useEffect, useMemo } from 'react'
import { useI18n } from '../../lib/i18n'
import { parseSmartQuery, smartQueryHasFilters } from '../../../shared/smart-query'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from '../ui/dialog'
import { Input } from '../ui/input'

export interface SmartFolderDraft {
  name: string
  query: string
}

interface SmartFolderDialogProps {
  open: boolean
  /** Existing folder values when editing; a prefilled query when saving a search */
  initial?: Partial<SmartFolderDraft>
  mode: 'create' | 'edit'
  onOpenChange: (open: boolean) => void
  onSave: (draft: SmartFolderDraft) => void | Promise<void>
}

/**
 * Create or edit a smart folder: a name and a query in the small language
 * of `shared/smart-query.ts`. The parsed filters are echoed under the
 * field so a typo in `unread:ture` shows up before saving.
 */
export function SmartFolderDialog({ open, initial, mode, onOpenChange, onSave }: SmartFolderDialogProps) {
  const { t } = useI18n()
  const [name, setName] = useState(initial?.name ?? '')
  const [query, setQuery] = useState(initial?.query ?? '')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) {
      setName(initial?.name ?? '')
      setQuery(initial?.query ?? '')
    }
  }, [open, initial?.name, initial?.query])

  const parsed = useMemo(() => parseSmartQuery(query), [query])
  const chips = useMemo(() => {
    const out: string[] = []
    if (parsed.text) out.push(`“${parsed.text}”`)
    if (parsed.unread !== undefined) out.push(parsed.unread ? 'unread' : 'read')
    if (parsed.bookmarked) out.push('bookmarked')
    if (parsed.liked) out.push('liked')
    if (parsed.feedId) out.push(`feed #${parsed.feedId}`)
    if (parsed.categoryId) out.push(`category #${parsed.categoryId}`)
    if (parsed.sinceDays) out.push(`${parsed.sinceDays}d`)
    if (parsed.sort) out.push(`sort:${parsed.sort}`)
    return out
  }, [parsed])

  const canSave = name.trim().length > 0 && (parsed.text.length > 0 || smartQueryHasFilters(parsed))

  const handleSave = async () => {
    if (!canSave) return
    setSaving(true)
    try {
      await onSave({ name: name.trim(), query: query.trim() })
      onOpenChange(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t(mode === 'edit' ? 'smart.edit' : 'smart.add')}</DialogTitle>
          <DialogDescription>{t('smart.queryHelp')}</DialogDescription>
        </DialogHeader>

        <label className="block space-y-1">
          <span className="text-xs text-muted">{t('smart.name')}</span>
          <Input value={name} onChange={e => setName(e.target.value)} placeholder={t('smart.namePlaceholder')} autoFocus />
        </label>
        <label className="block space-y-1">
          <span className="text-xs text-muted">{t('smart.query')}</span>
          <Input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={t('smart.queryPlaceholder')}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void handleSave() } }}
            className="font-mono"
          />
        </label>
        {chips.length > 0 && (
          <div className="flex flex-wrap gap-1" data-testid="smart-query-chips">
            {chips.map(chip => (
              <span key={chip} className="rounded-full bg-bg-subtle px-2 py-0.5 text-[11px] text-muted">{chip}</span>
            ))}
          </div>
        )}

        <DialogFooter>
          <button type="button" onClick={() => onOpenChange(false)} className="px-3 py-1.5 text-[13px] text-muted hover:text-text">
            {t('modal.cancel')}
          </button>
          <button
            type="button"
            onClick={() => { void handleSave() }}
            disabled={!canSave || saving}
            className="px-3 py-1.5 text-[13px] rounded-md bg-accent text-accent-text disabled:opacity-50"
          >
            {t(mode === 'edit' ? 'settings.save' : 'smart.create')}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
