import { useEffect, useState } from 'react'
import useSWR, { useSWRConfig } from 'swr'
import { toast } from 'sonner'
import { Loader2, Plus, Play, RefreshCw, Trash2 } from 'lucide-react'
import { fetcher, apiPatch, apiPost } from '../../../lib/fetcher'
import { useI18n } from '@/i18n'
import { RadioGroup } from '@/components/ui/radio-group'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import type { ClassOption, ClassificationOverview, ClassificationSettings } from '../../../../shared/classification'
import { MAX_THEMES } from '../../../../shared/classification'

interface TestResult {
  ok: boolean
  error?: string
  result?: { format: string | null; theme: string | null; formatTop: string; themeTop: string; formatP1: number; themeP1: number; ms: number }
}

const inputClass = 'px-2 py-1 text-sm rounded-lg border border-border bg-bg-card text-text focus:outline-none focus:ring-1 focus:ring-accent'
const buttonClass = 'inline-flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg border border-border text-text hover:bg-hover transition-colors disabled:opacity-50'

/**
 * Settings → Integration → Article classification: formats and themes read
 * out of the vLLM server by a one-token closed decision (notjev).
 */
export function ClassificationSection() {
  const { t } = useI18n()
  const { mutate: globalMutate } = useSWRConfig()
  const { data: settings, mutate } = useSWR<ClassificationSettings>('/api/classification/settings', fetcher)
  const { data: overview, mutate: mutateOverview } = useSWR<ClassificationOverview>(
    '/api/classification', fetcher, { refreshInterval: 10_000 },
  )
  const { data: vllmModels } = useSWR<{ models: Array<{ name: string }> }>('/api/settings/vllm/models', fetcher)

  const [model, setModel] = useState('')
  const [formatTheta, setFormatTheta] = useState('')
  const [themeTheta, setThemeTheta] = useState('')
  const [themes, setThemes] = useState<ClassOption[]>([])
  const [themesDirty, setThemesDirty] = useState(false)
  const [testTitle, setTestTitle] = useState('')
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<TestResult | null>(null)
  const [confirmReclassify, setConfirmReclassify] = useState(false)

  useEffect(() => {
    if (!settings) return
    setModel(settings.model)
    setFormatTheta(String(settings.formatTheta))
    setThemeTheta(String(settings.themeTheta))
    if (!themesDirty) setThemes(settings.themes)
  }, [settings]) // eslint-disable-line react-hooks/exhaustive-deps

  async function save(patch: Partial<ClassificationSettings>) {
    try {
      const next = await apiPatch('/api/classification/settings', patch) as ClassificationSettings
      await mutate(next, { revalidate: false })
      void mutateOverview()
      return next
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
      void mutate()
      return null
    }
  }

  function commitTheta(key: 'formatTheta' | 'themeTheta', raw: string) {
    const n = Number(raw)
    if (!settings) return
    if (!Number.isFinite(n) || n < 0 || n > 1) {
      if (key === 'formatTheta') setFormatTheta(String(settings.formatTheta))
      else setThemeTheta(String(settings.themeTheta))
      return
    }
    if (n !== settings[key]) void save({ [key]: n })
  }

  function updateTheme(index: number, patch: Partial<ClassOption>) {
    setThemes(prev => prev.map((th, i) => (i === index ? { ...th, ...patch } : th)))
    setThemesDirty(true)
  }

  async function saveThemes() {
    // A new row has no id yet: the server derives one from the label
    const cleaned = themes
      .filter(th => th.label.trim())
      .map(th => ({ id: th.id || undefined, label: th.label, description: th.description }))
    const next = await save({ themes: cleaned as ClassOption[] })
    if (next) {
      setThemes(next.themes)
      setThemesDirty(false)
      toast.success(t('classification.themesSaved'))
    }
  }

  async function runTest() {
    setTesting(true)
    setTestResult(null)
    try {
      setTestResult(await apiPost('/api/classification/test', { title: testTitle.trim() }) as TestResult)
    } catch (err) {
      setTestResult({ ok: false, error: err instanceof Error ? err.message : String(err) })
    } finally {
      setTesting(false)
    }
  }

  async function backfill(all: boolean) {
    setConfirmReclassify(false)
    try {
      const res = await apiPost('/api/classification/backfill', { all }) as { queued: number }
      toast.success(t('classification.queued', { count: String(res.queued) }))
      void mutateOverview()
      void globalMutate((key: unknown) => typeof key === 'string' && key.startsWith('/api/articles'))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  if (!settings) return null

  const fmt = (choice: string | null, top: string, p1: number) =>
    choice ? `${choice} (${p1.toFixed(2)})` : `${t('classification.undecided')} (${top} ${p1.toFixed(2)})`

  return (
    <section>
      <h2 className="text-base font-semibold text-text mb-1">{t('classification.title')}</h2>
      <p className="text-xs text-muted mb-4">{t('classification.desc')}</p>

      <RadioGroup
        name="classificationEnabled"
        options={[
          { value: 'on' as const, label: 'ON' },
          { value: 'off' as const, label: 'OFF' },
        ]}
        value={settings.enabled ? 'on' : 'off'}
        onChange={v => { void save({ enabled: v === 'on' }) }}
      />

      {settings.enabled && (
        <>
          <div className="mt-5">
            <p className="text-sm text-text mb-1">{t('classification.hideCategories')}</p>
            <p className="text-xs text-muted mb-2">{t('classification.hideCategoriesDesc')}</p>
            <RadioGroup
              name="classificationHideCategories"
              options={[
                { value: 'on' as const, label: 'ON' },
                { value: 'off' as const, label: 'OFF' },
              ]}
              value={settings.hideCategories ? 'on' : 'off'}
              onChange={v => { void save({ hideCategories: v === 'on' }) }}
            />
          </div>

          <div className="mt-5">
            <p className="text-sm text-text mb-1">{t('classification.model')}</p>
            <p className="text-xs text-muted mb-2">{t('classification.modelDesc')}</p>
            <input
              list="classification-models"
              value={model}
              placeholder={t('classification.modelPlaceholder')}
              onChange={e => setModel(e.target.value)}
              onBlur={() => { if (model !== settings.model) void save({ model }) }}
              onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
              className={`${inputClass} w-64`}
            />
            <datalist id="classification-models">
              {vllmModels?.models.map(m => <option key={m.name} value={m.name} />)}
            </datalist>
          </div>

          <div className="mt-5">
            <p className="text-sm text-text mb-1">{t('classification.thresholds')}</p>
            <p className="text-xs text-muted mb-2">{t('classification.thresholdsDesc')}</p>
            <div className="flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-2 text-sm text-muted">
                {t('classification.formats')}
                <input
                  type="number" min={0} max={1} step={0.05}
                  value={formatTheta}
                  onChange={e => setFormatTheta(e.target.value)}
                  onBlur={() => commitTheta('formatTheta', formatTheta)}
                  className={`${inputClass} w-20`}
                />
              </label>
              <label className="flex items-center gap-2 text-sm text-muted">
                {t('classification.themes')}
                <input
                  type="number" min={0} max={1} step={0.05}
                  value={themeTheta}
                  onChange={e => setThemeTheta(e.target.value)}
                  onBlur={() => commitTheta('themeTheta', themeTheta)}
                  className={`${inputClass} w-20`}
                />
              </label>
            </div>
          </div>

          <div className="mt-5">
            <p className="text-sm text-text mb-1">{t('classification.themes')}</p>
            <p className="text-xs text-muted mb-2">{t('classification.themesDesc', { max: String(MAX_THEMES) })}</p>
            <div className="space-y-2">
              {themes.map((th, i) => (
                <div key={i} className="flex flex-wrap sm:flex-nowrap items-center gap-2">
                  <input
                    value={th.label}
                    placeholder={t('classification.themeLabel')}
                    onChange={e => updateTheme(i, { label: e.target.value })}
                    className={`${inputClass} w-40`}
                    aria-label={t('classification.themeLabel')}
                  />
                  <input
                    value={th.description}
                    placeholder={t('classification.themeDescription')}
                    onChange={e => updateTheme(i, { description: e.target.value })}
                    className={`${inputClass} flex-1 min-w-0`}
                    aria-label={t('classification.themeDescription')}
                  />
                  <button
                    type="button"
                    onClick={() => { setThemes(prev => prev.filter((_, j) => j !== i)); setThemesDirty(true) }}
                    className="text-muted hover:text-error p-1"
                    aria-label={t('classification.removeTheme')}
                    title={t('classification.removeTheme')}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={themes.length >= MAX_THEMES}
                onClick={() => { setThemes(prev => [...prev, { id: '', label: '', description: '' }]); setThemesDirty(true) }}
                className={buttonClass}
              >
                <Plus size={14} />
                {t('classification.addTheme')}
              </button>
              <button type="button" disabled={!themesDirty} onClick={() => { void saveThemes() }} className={buttonClass}>
                {t('classification.saveThemes')}
              </button>
            </div>
          </div>

          <div className="mt-5">
            <p className="text-sm text-text mb-1">{t('classification.test')}</p>
            <p className="text-xs text-muted mb-2">{t('classification.testDesc')}</p>
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={testTitle}
                placeholder={t('classification.testPlaceholder')}
                onChange={e => setTestTitle(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && testTitle.trim()) void runTest() }}
                className={`${inputClass} flex-1 min-w-0`}
              />
              <button type="button" disabled={testing || !testTitle.trim()} onClick={() => { void runTest() }} className={buttonClass}>
                {testing ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                {t('classification.runTest')}
              </button>
            </div>
            {testResult && (
              <p className={`text-xs mt-2 ${testResult.ok ? 'text-text' : 'text-error'}`}>
                {testResult.ok && testResult.result
                  ? `${t('classification.formats')}: ${fmt(testResult.result.format, testResult.result.formatTop, testResult.result.formatP1)} · `
                    + `${t('classification.themes')}: ${fmt(testResult.result.theme, testResult.result.themeTop, testResult.result.themeP1)} · ${testResult.result.ms} ms`
                  : testResult.error}
              </p>
            )}
          </div>

          <div className="mt-5">
            <p className="text-sm text-text mb-1">{t('classification.existing')}</p>
            {overview && (
              <p className="text-xs text-muted mb-2">
                {t('classification.status', { unclassified: String(overview.unclassified), pending: String(overview.pending) })}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={!overview?.unclassified} onClick={() => { void backfill(false) }} className={buttonClass}>
                <Play size={14} />
                {t('classification.classifyExisting')}
              </button>
              <button type="button" onClick={() => setConfirmReclassify(true)} className={buttonClass}>
                <RefreshCw size={14} />
                {t('classification.reclassifyAll')}
              </button>
            </div>
          </div>
        </>
      )}

      {confirmReclassify && (
        <ConfirmDialog
          title={t('classification.reclassifyAll')}
          message={t('classification.reclassifyConfirm')}
          onConfirm={() => { void backfill(true) }}
          onCancel={() => setConfirmReclassify(false)}
        />
      )}
    </section>
  )
}
