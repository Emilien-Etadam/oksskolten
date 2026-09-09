import { useState } from 'react'
import useSWR from 'swr'
import { toast } from 'sonner'
import { FlaskConical, Play, Plus, Trash2 } from 'lucide-react'
import { fetcher, apiPost, apiPatch, apiDelete } from '../../../lib/fetcher'
import { useI18n } from '../../../lib/i18n'
import { Input } from '@/components/ui/input'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import type { FeedWithCounts } from '../../../../shared/types'

type RuleField = 'title' | 'url' | 'content' | 'any'
type RuleAction = 'mark_read' | 'hide' | 'bookmark' | 'like' | 'score'

export interface FeedRule {
  id: number
  feed_id: number | null
  feed_name: string | null
  field: RuleField
  pattern: string
  action: RuleAction
  value: number | null
  enabled: number
  match_count: number
  last_matched_at: string | null
}

interface Draft {
  feed_id: string
  field: RuleField
  pattern: string
  action: RuleAction
  value: string
}

const EMPTY_DRAFT: Draft = { feed_id: 'all', field: 'title', pattern: '', action: 'mark_read', value: '' }
const FIELDS: RuleField[] = ['title', 'url', 'content', 'any']
const ACTIONS: RuleAction[] = ['mark_read', 'hide', 'bookmark', 'like', 'score']

const FIELD_KEY: Record<RuleField, 'rules.fieldTitle'> = {
  title: 'rules.fieldTitle',
  url: 'rules.fieldUrl' as 'rules.fieldTitle',
  content: 'rules.fieldContent' as 'rules.fieldTitle',
  any: 'rules.fieldAny' as 'rules.fieldTitle',
}
const ACTION_KEY: Record<RuleAction, 'rules.actionMarkRead'> = {
  mark_read: 'rules.actionMarkRead',
  hide: 'rules.actionHide' as 'rules.actionMarkRead',
  bookmark: 'rules.actionBookmark' as 'rules.actionMarkRead',
  like: 'rules.actionLike' as 'rules.actionMarkRead',
  score: 'rules.actionScore' as 'rules.actionMarkRead',
}

function isValidRegex(pattern: string): boolean {
  try { new RegExp(pattern, 'iu'); return true } catch { return false }
}

/**
 * Settings → Feeds → Automated rules: a regex per rule, scoped to one feed
 * or all of them, with a dry run over recent articles before saving and a
 * one-click backfill afterwards.
 */
export function RulesSection() {
  const { t } = useI18n()
  const { data, mutate } = useSWR<{ rules: FeedRule[] }>('/api/rules', fetcher)
  const { data: feedsData } = useSWR<{ feeds: FeedWithCounts[] }>('/api/feeds', fetcher)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [preview, setPreview] = useState<{ scanned: number; matched: number; samples: Array<{ id: number; title: string }> } | null>(null)
  const [busy, setBusy] = useState(false)
  const [deleting, setDeleting] = useState<FeedRule | null>(null)

  const rules = data?.rules ?? []
  const feeds = (feedsData?.feeds ?? []).filter(f => f.type !== 'clip')
  const draftValid = !!draft && draft.pattern.trim().length > 0 && isValidRegex(draft.pattern)
    && (draft.action !== 'score' || (draft.value.trim() !== '' && Number.isFinite(Number(draft.value)) && Number(draft.value) !== 0))

  function payload(d: Draft) {
    return {
      feed_id: d.feed_id === 'all' ? null : Number(d.feed_id),
      field: d.field,
      pattern: d.pattern.trim(),
      action: d.action,
      value: d.action === 'score' ? Number(d.value) : null,
    }
  }

  async function handlePreview() {
    if (!draft || !draftValid) return
    setBusy(true)
    try {
      const { feed_id, field, pattern } = payload(draft)
      setPreview(await apiPost('/api/rules/preview', { feed_id, field, pattern }))
    } finally {
      setBusy(false)
    }
  }

  async function handleCreate() {
    if (!draft || !draftValid) return
    setBusy(true)
    try {
      await apiPost('/api/rules', payload(draft))
      setDraft(null)
      setPreview(null)
      void mutate()
    } finally {
      setBusy(false)
    }
  }

  async function handleToggle(rule: FeedRule) {
    await apiPatch(`/api/rules/${rule.id}`, { enabled: rule.enabled !== 1 })
    void mutate()
  }

  async function handleApply(rule: FeedRule) {
    setBusy(true)
    try {
      const result = await apiPost(`/api/rules/${rule.id}/apply`) as { matched: number }
      toast.success(t('rules.applied', { count: String(result.matched) }))
      void mutate()
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete(rule: FeedRule) {
    await apiDelete(`/api/rules/${rule.id}`)
    setDeleting(null)
    void mutate()
  }

  return (
    <section>
      <div className="flex items-start justify-between gap-4 mb-1">
        <h2 className="text-base font-semibold text-text">{t('rules.title')}</h2>
        {!draft && (
          <button
            type="button"
            onClick={() => { setDraft(EMPTY_DRAFT); setPreview(null) }}
            className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md bg-accent text-accent-text"
          >
            <Plus size={14} />
            {t('rules.add')}
          </button>
        )}
      </div>
      <p className="text-xs text-muted mb-4">{t('rules.desc')}</p>

      {draft && (
        <div className="border border-border rounded-lg p-3 mb-4 space-y-3 bg-bg-card" data-testid="rule-form">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <label className="space-y-1">
              <span className="text-xs text-muted">{t('rules.scope')}</span>
              <Select value={draft.feed_id} onValueChange={v => setDraft({ ...draft, feed_id: v })}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('rules.allFeeds')}</SelectItem>
                  {feeds.map(f => <SelectItem key={f.id} value={String(f.id)}>{f.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </label>
            <label className="space-y-1">
              <span className="text-xs text-muted">{t('rules.field')}</span>
              <Select value={draft.field} onValueChange={v => setDraft({ ...draft, field: v as RuleField })}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {FIELDS.map(f => <SelectItem key={f} value={f}>{t(FIELD_KEY[f])}</SelectItem>)}
                </SelectContent>
              </Select>
            </label>
            <label className="space-y-1">
              <span className="text-xs text-muted">{t('rules.action')}</span>
              <Select value={draft.action} onValueChange={v => setDraft({ ...draft, action: v as RuleAction })}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ACTIONS.map(a => <SelectItem key={a} value={a}>{t(ACTION_KEY[a])}</SelectItem>)}
                </SelectContent>
              </Select>
            </label>
          </div>
          <div className={`grid grid-cols-1 gap-3 ${draft.action === 'score' ? 'md:grid-cols-[1fr_8rem]' : ''}`}>
            <label className="space-y-1">
              <span className="text-xs text-muted">{t('rules.pattern')}</span>
              <Input
                value={draft.pattern}
                onChange={e => { setDraft({ ...draft, pattern: e.target.value }); setPreview(null) }}
                placeholder="^sponsored|partner content"
                className="font-mono"
                aria-label={t('rules.pattern')}
                aria-invalid={draft.pattern.length > 0 && !isValidRegex(draft.pattern)}
              />
              {draft.pattern.length > 0 && !isValidRegex(draft.pattern) && (
                <span className="text-xs text-error">{t('rules.invalidPattern')}</span>
              )}
            </label>
            {draft.action === 'score' && (
              <label className="space-y-1">
                <span className="text-xs text-muted">{t('rules.value')}</span>
                <Input
                  type="number"
                  value={draft.value}
                  onChange={e => setDraft({ ...draft, value: e.target.value })}
                  placeholder="+5"
                  aria-label={t('rules.value')}
                />
              </label>
            )}
          </div>
          {preview && (
            <div className="text-xs text-muted" data-testid="rule-preview">
              <p>{t('rules.previewResult', { matched: String(preview.matched), scanned: String(preview.scanned) })}</p>
              {preview.samples.length > 0 && (
                <ul className="mt-1 list-disc pl-4 space-y-0.5">
                  {preview.samples.map(s => <li key={s.id} className="truncate">{s.title}</li>)}
                </ul>
              )}
            </div>
          )}
          <div className="flex items-center gap-2 justify-end">
            <button type="button" onClick={() => { setDraft(null); setPreview(null) }} className="px-3 py-1.5 text-xs text-muted hover:text-text">
              {t('modal.cancel')}
            </button>
            <button
              type="button"
              onClick={() => { void handlePreview() }}
              disabled={!draftValid || busy}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border border-border text-text disabled:opacity-50"
            >
              <FlaskConical size={14} />
              {t('rules.preview')}
            </button>
            <button
              type="button"
              onClick={() => { void handleCreate() }}
              disabled={!draftValid || busy}
              className="px-3 py-1.5 text-xs rounded-md bg-accent text-accent-text disabled:opacity-50"
            >
              {t('rules.save')}
            </button>
          </div>
        </div>
      )}

      {rules.length === 0 && !draft ? (
        <p className="text-sm text-muted py-6 text-center">{t('rules.empty')}</p>
      ) : rules.length > 0 && (
        <div className="overflow-x-auto border border-border rounded-lg">
          <table className="w-full text-sm min-w-[640px]">
            <thead className="text-xs text-muted border-b border-border">
              <tr className="text-left">
                <th scope="col" className="px-3 py-2 font-medium w-9">{t('rules.enabled')}</th>
                <th scope="col" className="px-3 py-2 font-medium">{t('rules.scope')}</th>
                <th scope="col" className="px-3 py-2 font-medium">{t('rules.pattern')}</th>
                <th scope="col" className="px-3 py-2 font-medium">{t('rules.action')}</th>
                <th scope="col" className="px-3 py-2 font-medium text-right">{t('rules.matches', { count: '' }).trim()}</th>
                <th scope="col" className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {rules.map(rule => (
                <tr key={rule.id} className={`border-b border-border last:border-b-0 ${rule.enabled ? '' : 'opacity-60'}`}>
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      className="accent-accent"
                      checked={rule.enabled === 1}
                      onChange={() => { void handleToggle(rule) }}
                      aria-label={t('rules.enabled')}
                    />
                  </td>
                  <td className="px-3 py-2 text-muted truncate max-w-[12rem]">{rule.feed_name ?? t('rules.allFeeds')}</td>
                  <td className="px-3 py-2">
                    <code className="text-xs bg-bg-subtle rounded px-1.5 py-0.5">{rule.pattern}</code>
                    <span className="text-[11px] text-muted ml-1.5">{t(FIELD_KEY[rule.field])}</span>
                  </td>
                  <td className="px-3 py-2 text-muted whitespace-nowrap">
                    {t(ACTION_KEY[rule.action])}
                    {rule.action === 'score' && rule.value != null && (
                      <span className="ml-1 tabular-nums">{rule.value > 0 ? `+${rule.value}` : rule.value}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right text-muted tabular-nums">{rule.match_count}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => { void handleApply(rule) }}
                      disabled={busy}
                      className="inline-flex items-center gap-1 text-xs text-muted hover:text-text mr-2 disabled:opacity-50"
                      title={t('rules.apply')}
                    >
                      <Play size={13} />
                      {t('rules.apply')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleting(rule)}
                      className="text-muted hover:text-error"
                      aria-label={t('rules.delete')}
                      title={t('rules.delete')}
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {deleting && (
        <ConfirmDialog
          title={t('rules.delete')}
          message={deleting.pattern}
          confirmLabel={t('rules.delete')}
          danger
          onConfirm={() => { void handleDelete(deleting) }}
          onCancel={() => setDeleting(null)}
        />
      )}
    </section>
  )
}
