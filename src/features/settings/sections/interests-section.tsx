import { useState } from 'react'
import useSWR from 'swr'
import { toast } from 'sonner'
import { Loader2, RefreshCw, VolumeX } from 'lucide-react'
import { fetcher, apiPost, apiPatch } from '../../../lib/fetcher'
import { useI18n } from '@/i18n'
import type { ClassificationOverview } from '../../../../shared/classification'

export interface InterestTerm {
  term: string
  weight: number
  island: number
  muted: number
}

export interface InterestIsland {
  id: number
  terms: InterestTerm[]
}

export interface InterestClass {
  kind: 'theme' | 'format'
  class_id: string
  /** -1..1: engagement with this class against an average article */
  affinity: number
  seen: number
  muted: number
}

interface InterestsResponse {
  islands: InterestIsland[]
  classes?: InterestClass[]
}

/**
 * Settings → General → Your interests: the learned profile as islands of
 * co-occurring terms, sized by weight. Click a term to mute it.
 */
export function InterestsSection() {
  const { t } = useI18n()
  const { data, mutate } = useSWR<InterestsResponse>('/api/interests', fetcher)
  const { data: classification } = useSWR<ClassificationOverview>('/api/classification', fetcher)
  const [rebuilding, setRebuilding] = useState(false)

  const islands = data?.islands ?? []
  const classes = data?.classes ?? []
  const labelOf = (c: InterestClass) =>
    (c.kind === 'theme' ? classification?.themes : classification?.formats)?.find(o => o.id === c.class_id)?.label ?? c.class_id

  async function handleRebuild() {
    setRebuilding(true)
    try {
      const result = await apiPost('/api/interests/rebuild') as InterestsResponse
      await mutate(result, { revalidate: false })
      toast.success(t('interests.rebuilt'))
    } finally {
      setRebuilding(false)
    }
  }

  async function handleToggle(term: InterestTerm) {
    const muted = term.muted !== 1
    await mutate(
      current => current ? {
        ...current,
        islands: current.islands.map(i => ({ ...i, terms: i.terms.map(x => x.term === term.term ? { ...x, muted: muted ? 1 : 0 } : x) })),
      } : current,
      { revalidate: false },
    )
    await apiPatch(`/api/interests/${encodeURIComponent(term.term)}`, { muted })
    void mutate()
  }

  async function handleToggleClass(cls: InterestClass) {
    const muted = cls.muted !== 1
    const same = (x: InterestClass) => x.kind === cls.kind && x.class_id === cls.class_id
    await mutate(
      current => current ? { ...current, classes: current.classes?.map(x => same(x) ? { ...x, muted: muted ? 1 : 0 } : x) } : current,
      { revalidate: false },
    )
    await apiPatch(`/api/interests/classes/${cls.kind}/${encodeURIComponent(cls.class_id)}`, { muted })
    void mutate()
  }

  return (
    <section>
      <div className="flex items-start justify-between gap-4 mb-1">
        <h2 className="text-base font-semibold text-text">{t('interests.title')}</h2>
        <button
          type="button"
          onClick={() => { void handleRebuild() }}
          disabled={rebuilding}
          className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border border-border text-text disabled:opacity-50"
        >
          {rebuilding ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          {t('interests.rebuild')}
        </button>
      </div>
      <p className="text-xs text-muted mb-4">{t('interests.desc')}</p>

      {classes.length > 0 && (
        <div className="border border-border rounded-lg p-3 mb-3 space-y-2" data-testid="interest-classes">
          {(['theme', 'format'] as const).map(kind => {
            const list = classes.filter(c => c.kind === kind)
            if (list.length === 0) return null
            return (
              <div key={kind}>
                <p className="text-[11px] uppercase tracking-wider text-muted mb-1.5">
                  {t(kind === 'theme' ? 'classification.themes' : 'classification.formats')}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {list.map(cls => {
                    const muted = cls.muted === 1
                    const pct = Math.round(cls.affinity * 100)
                    return (
                      <button
                        key={`${cls.kind}:${cls.class_id}`}
                        type="button"
                        onClick={() => { void handleToggleClass(cls) }}
                        title={muted ? t('interests.muted') : t('interests.classAffinity', { seen: String(cls.seen) })}
                        aria-pressed={muted}
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs border transition-colors ${
                          muted
                            ? 'border-border text-muted line-through'
                            : cls.affinity > 0
                              ? 'border-accent/40 bg-accent/10 text-text hover:bg-accent/20'
                              : 'border-border text-muted hover:bg-hover'
                        }`}
                      >
                        {muted && <VolumeX size={11} />}
                        {labelOf(cls)}
                        {!muted && <span className="tabular-nums">{pct > 0 ? `+${pct}` : pct}</span>}
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {data && islands.length === 0 && (
        <p className="text-sm text-muted py-6 text-center">{t('interests.empty')}</p>
      )}

      <div className="space-y-3">
        {islands.map((island, index) => (
          <div key={island.id} className="border border-border rounded-lg p-3" data-testid="interest-island">
            <p className="text-[11px] uppercase tracking-wider text-muted mb-2">{t('interests.island', { n: String(index + 1) })}</p>
            <div className="flex flex-wrap gap-1.5">
              {island.terms.map(term => {
                const muted = term.muted === 1
                const size = 11 + Math.round(term.weight * 5)
                return (
                  <button
                    key={term.term}
                    type="button"
                    onClick={() => { void handleToggle(term) }}
                    title={muted ? t('interests.muted') : `${Math.round(term.weight * 100)}%`}
                    aria-pressed={muted}
                    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 border transition-colors ${
                      muted
                        ? 'border-border text-muted line-through'
                        : 'border-accent/40 bg-accent/10 text-text hover:bg-accent/20'
                    }`}
                    style={{ fontSize: `${size}px` }}
                  >
                    {muted && <VolumeX size={11} />}
                    {term.term}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
