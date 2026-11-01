import { useMemo, useState } from 'react'
import useSWR from 'swr'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { History, Paperclip, PenLine, Sparkles, ThumbsDown, ThumbsUp } from 'lucide-react'
import { ApiError, apiPost, apiPut, fetcher } from '@/lib/fetcher'
import { useI18n, type TranslateFn } from '@/i18n'
import { Skeleton } from '@/components/ui/skeleton'
import { articleUrlToPath, isGithubStarsFeedUrl } from '@/lib/url'
import { formatRelativeDate } from '@/lib/dateFormat'
import { NO_THEME_KEY } from '../../../../shared/journal'
import type {
  JournalEdition,
  JournalEditionSummary,
  JournalOverview,
  JournalSection,
  JournalSource,
} from '../../../../shared/journal'
import type { FeedWithCounts } from '../../../../shared/types'

const POLL_MS = 2000
const WORDS_PER_MINUTE = 200

/** SQLite datetime() text is UTC without a zone marker */
function sqlToIso(value: string): string {
  return value.includes('T') ? value : `${value.replace(' ', 'T')}Z`
}

function sectionLabel(section: JournalSection, sectionCount: number, t: TranslateFn): string {
  if (section.theme !== NO_THEME_KEY) return section.label
  return sectionCount === 1 ? t('journal.allNews') : t('journal.noTheme')
}

function readingMinutes(edition: JournalEdition): number {
  const content = edition.content
  if (!content) return 0
  const text = [...content.sections.map(s => s.summary), ...content.essentials.map(e => e.text)].join(' ')
  return Math.max(1, Math.round(text.split(/\s+/).filter(Boolean).length / WORDS_PER_MINUTE))
}

/**
 * Journal: an on-demand digest of everything that arrived since the previous
 * edition, one sourced synthesis per theme. The reader generates an edition
 * with a button; the server writes it in the background and this page polls
 * until it is done.
 */
export function JournalPage() {
  const { t, locale } = useI18n()
  const [viewingId, setViewingId] = useState<number | null>(null)
  const [starting, setStarting] = useState(false)

  const { data: overview, mutate } = useSWR<JournalOverview>('/api/journal', fetcher, {
    refreshInterval: latest => (latest?.latest?.status === 'running' ? POLL_MS : 0),
  })
  const { data: past } = useSWR<{ edition: JournalEdition; feedback: Record<number, number> }>(
    viewingId !== null ? `/api/journal/editions/${viewingId}` : null,
    fetcher,
  )
  // Keyed on the newest edition's state so the list refreshes when one finishes
  const editionsKey = overview ? `/api/journal/editions?v=${overview.latest?.id ?? 0}-${overview.latest?.status ?? ''}` : null
  const { data: editionsData } = useSWR<{ editions: JournalEditionSummary[] }>(editionsKey, fetcher)
  const { data: feedsData } = useSWR<{ feeds: FeedWithCounts[] }>('/api/feeds', fetcher)

  const latest = overview?.latest ?? null
  const running = latest?.status === 'running'
  const edition = viewingId !== null ? past?.edition ?? null : latest
  const feedback = viewingId !== null ? past?.feedback ?? {} : overview?.feedback ?? {}
  const githubUnread = (feedsData?.feeds ?? [])
    .filter(f => isGithubStarsFeedUrl(f.url))
    .reduce((sum, f) => sum + f.unread_count, 0)

  async function generate() {
    setStarting(true)
    try {
      await apiPost('/api/journal/generate')
      setViewingId(null)
      await mutate()
    } catch (err) {
      const code = err instanceof ApiError ? err.data.code : undefined
      if (code === 'no_articles') toast(t('journal.noArticles'))
      else if (code === 'busy') toast(t('journal.busy'))
      else toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setStarting(false)
    }
  }

  const masthead = new Intl.DateTimeFormat(locale, { dateStyle: 'full' }).format(
    edition ? new Date(sqlToIso(edition.created_at)) : new Date(),
  )
  const since = edition?.period_start
    ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(sqlToIso(edition.period_start)))
    : null

  return (
    <div className="max-w-3xl mx-auto px-4 md:px-6 py-6 md:py-10 flex flex-col gap-9">
      <header className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-text pb-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
          <span>{masthead}</span>
          {edition?.number != null && <span>{t('journal.edition', { number: String(edition.number) })}</span>}
        </div>
        <div className="flex flex-wrap items-end justify-between gap-5">
          <div className="flex flex-col gap-2 min-w-0">
            <h1 className="m-0 text-5xl md:text-6xl font-semibold leading-none tracking-tight text-text" style={{ fontFamily: 'var(--font-article)' }}>
              {t('journal.title')}
            </h1>
            {edition && (
              <p className="m-0 text-sm text-muted">
                {since ? t('journal.coversSince', { since }) : t('journal.coversFirst')}
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {(editionsData?.editions.length ?? 0) > 0 && (
              <label className="flex items-center gap-2 h-11 rounded-xl border border-border bg-bg-card px-3 text-sm text-text">
                <History size={16} strokeWidth={1.8} aria-hidden="true" />
                <span className="sr-only">{t('journal.editions')}</span>
                <select
                  value={viewingId ?? ''}
                  onChange={e => setViewingId(e.target.value ? Number(e.target.value) : null)}
                  className="bg-transparent outline-none text-sm"
                >
                  <option value="">{t('journal.editions')}</option>
                  {editionsData!.editions.map(e => (
                    <option key={e.id} value={e.id}>
                      {t('journal.edition', { number: String(e.number ?? e.id) })} · {new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(sqlToIso(e.created_at)))}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <button
              type="button"
              onClick={() => { void generate() }}
              disabled={running || starting}
              className="flex items-center gap-2 h-11 rounded-xl bg-text px-4 text-sm font-semibold text-bg shadow-sm transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              <Sparkles size={16} strokeWidth={1.8} aria-hidden="true" />
              {t('journal.generate')}
            </button>
          </div>
        </div>

        {viewingId !== null && (
          <button type="button" onClick={() => setViewingId(null)} className="self-start text-sm font-medium text-accent hover:underline">
            {t('journal.backToLatest')}
          </button>
        )}

        {viewingId === null && latest?.status === 'done' && (overview?.pending_count ?? 0) > 0 && (
          <p className="m-0 rounded-xl bg-bg-subtle px-4 py-2.5 text-sm text-text">
            {t('journal.pending', { count: String(overview!.pending_count) })}
          </p>
        )}

        {running && <Progress done={latest.sections_done} total={latest.sections_total} t={t} />}

        {edition?.status === 'error' && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-error px-4 py-3 text-sm text-error">
            <span>{t('journal.failed', { error: edition.error ?? '' })}</span>
            <button type="button" onClick={() => { void generate() }} className="font-semibold hover:underline">
              {t('journal.retry')}
            </button>
          </div>
        )}

        {edition?.content && <Stats edition={edition} t={t} />}
      </header>

      {!overview && (
        <div className="flex flex-col gap-4">
          <Skeleton className="h-32 w-full rounded-2xl" />
          <Skeleton className="h-48 w-full rounded-2xl" />
        </div>
      )}

      {overview && !latest && (
        <p className="text-center text-sm text-muted py-12">{t('journal.empty')}</p>
      )}

      {edition?.content && (
        <EditionBody
          edition={edition}
          feedback={feedback}
          instructions={overview?.instructions ?? {}}
          onInstructionsChange={() => { void mutate() }}
          locale={locale}
          t={t}
        />
      )}

      {edition?.status === 'done' && (
        <footer className="flex flex-wrap items-center justify-between gap-3 border-t-2 border-text pt-3.5 text-xs text-muted">
          <span>{t('journal.footerRead', { count: String(edition.article_count) })}</span>
          {githubUnread > 0 && <span>{t('journal.footerGithub', { count: String(githubUnread) })}</span>}
        </footer>
      )}
    </div>
  )
}

function Progress({ done, total, t }: { done: number; total: number; t: TranslateFn }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0
  return (
    <div className="flex flex-col gap-2" role="status">
      <span className="text-sm text-muted">{t('journal.generating', { done: String(done), total: String(total) })}</span>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-bg-subtle">
        <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${Math.max(pct, 4)}%` }} />
      </div>
    </div>
  )
}

function Stats({ edition, t }: { edition: JournalEdition; t: TranslateFn }) {
  const content = edition.content!
  const stats = [
    { value: String(edition.article_count), label: t('journal.statArticles') },
    { value: String(content.sources.length), label: t('journal.statSources') },
    { value: String(content.sections.length), label: t('journal.statThemes') },
    { value: String(readingMinutes(edition)), label: t('journal.statMinutes') },
  ]
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-px overflow-hidden rounded-2xl border border-border bg-border">
      {stats.map(s => (
        <div key={s.label} className="flex flex-col gap-0.5 bg-bg-card px-4 py-3">
          <span className="text-3xl font-semibold leading-tight text-text" style={{ fontFamily: 'var(--font-article)' }}>{s.value}</span>
          <span className="text-xs text-muted">{s.label}</span>
        </div>
      ))}
    </div>
  )
}

function EditionBody({ edition, feedback, instructions, onInstructionsChange, locale, t }: {
  edition: JournalEdition
  feedback: Record<number, number>
  instructions: Record<string, string>
  onInstructionsChange: () => void
  locale: string
  t: TranslateFn
}) {
  const content = edition.content!
  const sourceByN = useMemo(() => new Map(content.sources.map(s => [s.n, s])), [content.sources])
  const [votes, setVotes] = useState<Record<number, number>>({})
  const voteOf = (articleId: number) => votes[articleId] ?? feedback[articleId] ?? 0

  async function vote(articleId: number, value: -1 | 1) {
    const next = voteOf(articleId) === value ? 0 : value
    setVotes(v => ({ ...v, [articleId]: next }))
    try {
      await apiPost('/api/journal/feedback', { article_id: articleId, vote: next })
    } catch (err) {
      setVotes(v => ({ ...v, [articleId]: voteOf(articleId) }))
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <>
      {content.essentials.length > 0 && (
        <section aria-labelledby="journal-essentials" className="flex flex-col gap-4 rounded-2xl bg-text px-6 py-6 text-bg md:px-7">
          <h2 id="journal-essentials" className="m-0 text-[11px] font-semibold uppercase tracking-[0.1em] opacity-70">{t('journal.essentials')}</h2>
          <ol className="m-0 flex list-none flex-col gap-3.5 p-0 text-lg leading-snug" style={{ fontFamily: 'var(--font-article)' }}>
            {content.essentials.map((e, i) => (
              <li key={i} className="flex gap-3.5">
                <span className="pt-1 font-sans text-xs font-bold opacity-60">{String(i + 1).padStart(2, '0')}</span>
                <span><CitedText text={e.text} sources={sourceByN} inverse /></span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {content.sections.map((section, i) => (
        <Section
          key={section.theme}
          index={i}
          section={section}
          label={sectionLabel(section, content.sections.length, t)}
          sources={sourceByN}
          voteOf={voteOf}
          onVote={vote}
          instruction={instructions[section.theme] ?? ''}
          onInstructionsChange={onInstructionsChange}
          locale={locale}
          t={t}
        />
      ))}
    </>
  )
}

function Section({ index, section, label, sources, voteOf, onVote, instruction, onInstructionsChange, locale, t }: {
  index: number
  section: JournalSection
  label: string
  sources: Map<number, JournalSource>
  voteOf: (articleId: number) => number
  onVote: (articleId: number, value: -1 | 1) => Promise<void>
  instruction: string
  onInstructionsChange: () => void
  locale: string
  t: TranslateFn
}) {
  const cited = section.refs.map(n => sources.get(n)).filter((s): s is JournalSource => !!s)
  const paragraphs = section.summary.split(/\n{2,}/).map(p => p.trim()).filter(Boolean)
  return (
    <section className={`flex flex-col gap-5 ${index > 0 ? 'border-t border-border pt-8' : ''}`}>
      <div className="flex items-center gap-3.5">
        <span className="text-4xl font-medium leading-none text-accent" style={{ fontFamily: 'var(--font-article)' }}>
          {String(index + 1).padStart(2, '0')}
        </span>
        <div className="flex flex-col">
          <h2 className="m-0 text-3xl font-semibold leading-tight tracking-tight text-text" style={{ fontFamily: 'var(--font-article)' }}>{label}</h2>
          <span className="text-xs text-muted">{t('journal.sectionMeta', { count: String(section.article_count), cited: String(cited.length) })}</span>
        </div>
      </div>

      <div className="flex flex-col gap-3.5 text-lg leading-relaxed text-text" style={{ fontFamily: 'var(--font-article)' }}>
        {paragraphs.map((p, i) => <p key={i} className="m-0"><CitedText text={p} sources={sources} /></p>)}
      </div>

      {cited.length > 0 && (
        <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
          {cited.map(source => (
            <SourceCard key={source.n} source={source} vote={voteOf(source.article_id)} onVote={onVote} locale={locale} t={t} />
          ))}
        </div>
      )}

      {section.uncited.length > 0 && <Uncited section={section} t={t} />}

      <InstructionBox theme={section.theme} value={instruction} onSaved={onInstructionsChange} t={t} />
    </section>
  )
}

function CitedText({ text, sources, inverse = false }: { text: string; sources: Map<number, JournalSource>; inverse?: boolean }) {
  const navigate = useNavigate()
  const parts = text.split(/(\[\d+\])/g)
  return (
    <>
      {parts.map((part, i) => {
        const match = /^\[(\d+)\]$/.exec(part)
        const source = match ? sources.get(Number(match[1])) : undefined
        if (!match) return <span key={i}>{part}</span>
        if (!source) return null
        const path = articleUrlToPath(source.url)
        // Adjacent citations ("[1][2]") split around an empty string: separate them
        const follows = i >= 2 && parts[i - 1] === '' && /^\[\d+\]$/.test(parts[i - 2])
        return (
          <a
            key={i}
            href={path}
            title={source.title}
            onClick={e => { e.preventDefault(); void navigate(path) }}
            className={`ml-0.5 align-super font-sans text-[11px] font-bold hover:underline ${inverse ? 'text-bg opacity-80' : 'text-accent'}`}
          >
            {follows ? `,${source.n}` : source.n}
          </a>
        )
      })}
    </>
  )
}

function SourceCard({ source, vote, onVote, locale, t }: {
  source: JournalSource
  vote: number
  onVote: (articleId: number, value: -1 | 1) => Promise<void>
  locale: string
  t: TranslateFn
}) {
  const navigate = useNavigate()
  const path = articleUrlToPath(source.url)
  const [archived, setArchived] = useState(false)

  async function archive() {
    try {
      await apiPost('/api/articles/from-url', { url: source.url, force: true })
      setArchived(true)
      toast(t('journal.archived'))
    } catch (err) {
      // 409 without can_force: it already is a clip
      if (err instanceof ApiError && err.status === 409) {
        setArchived(true)
        return
      }
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <article className="flex flex-col gap-2.5 rounded-2xl border border-border bg-bg-card p-3.5">
      <div className="flex items-center gap-2 text-xs text-muted">
        <span className="flex-1 truncate">
          {source.feed_name}
          {source.published_at && ` · ${formatRelativeDate(source.published_at, locale, { justNow: t('date.justNow') })}`}
        </span>
        <span className="font-bold text-accent">{source.n}</span>
      </div>
      <a
        href={path}
        onClick={e => { e.preventDefault(); void navigate(path) }}
        className="font-semibold leading-snug text-text hover:underline"
      >
        {source.title}
      </a>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => { void onVote(source.article_id, 1) }}
          aria-pressed={vote === 1}
          className={`flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold transition-colors ${
            vote === 1 ? 'border-success text-success' : 'border-border text-muted hover:text-text'
          }`}
        >
          <ThumbsUp size={14} strokeWidth={1.8} aria-hidden="true" />
          {t('journal.more')}
        </button>
        <button
          type="button"
          onClick={() => { void onVote(source.article_id, -1) }}
          aria-pressed={vote === -1}
          aria-label={t('journal.less')}
          title={t('journal.less')}
          className={`flex h-8 w-8 items-center justify-center rounded-lg border transition-colors ${
            vote === -1 ? 'border-error text-error' : 'border-border text-muted hover:text-text'
          }`}
        >
          <ThumbsDown size={14} strokeWidth={1.8} aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => { void archive() }}
          disabled={archived}
          aria-label={archived ? t('journal.archived') : t('journal.archive')}
          title={archived ? t('journal.archived') : t('journal.archive')}
          className={`ml-auto flex h-8 w-8 items-center justify-center rounded-lg border transition-colors ${
            archived ? 'border-accent text-accent' : 'border-border text-muted hover:text-text'
          }`}
        >
          <Paperclip size={14} strokeWidth={1.8} aria-hidden="true" />
        </button>
      </div>
    </article>
  )
}

function Uncited({ section, t }: { section: JournalSection; t: TranslateFn }) {
  const navigate = useNavigate()
  return (
    <details>
      <summary className="cursor-pointer select-none text-sm font-semibold text-accent">
        {t('journal.showUncited', { count: String(section.uncited.length) })}
      </summary>
      <ul className="mt-2 flex flex-col gap-1.5 pl-1">
        {section.uncited.map(a => {
          const path = articleUrlToPath(a.url)
          return (
            <li key={a.article_id} className="text-sm">
              <a href={path} onClick={e => { e.preventDefault(); void navigate(path) }} className="text-text hover:underline">{a.title}</a>
              <span className="text-muted"> — {a.feed_name}</span>
            </li>
          )
        })}
      </ul>
    </details>
  )
}

function InstructionBox({ theme, value, onSaved, t }: { theme: string; value: string; onSaved: () => void; t: TranslateFn }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const [saving, setSaving] = useState(false)
  const fieldId = `journal-instruction-${theme}`

  async function save() {
    setSaving(true)
    try {
      await apiPut(`/api/journal/instructions/${encodeURIComponent(theme)}`, { instruction: draft })
      setEditing(false)
      onSaved()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  if (!editing && !value) {
    return (
      <button
        type="button"
        onClick={() => { setDraft(''); setEditing(true) }}
        className="flex items-center gap-2 self-start text-sm text-muted hover:text-text"
      >
        <PenLine size={14} strokeWidth={1.8} aria-hidden="true" />
        {t('journal.addInstruction')}
      </button>
    )
  }

  return (
    <div className="flex items-start gap-3 rounded-xl bg-bg-subtle px-4 py-3">
      <PenLine size={16} strokeWidth={1.8} className="mt-0.5 shrink-0 text-accent" aria-hidden="true" />
      <div className="flex flex-1 flex-col gap-1.5 min-w-0">
        {editing
          ? <label htmlFor={fieldId} className="text-[11px] font-bold uppercase tracking-[0.08em] text-accent">{t('journal.instruction')}</label>
          : <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-accent">{t('journal.instruction')}</span>}
        {editing ? (
          <>
            <textarea
              id={fieldId}
              value={draft}
              onChange={e => setDraft(e.target.value)}
              rows={2}
              maxLength={1000}
              placeholder={t('journal.instructionPlaceholder')}
              className="w-full resize-y rounded-lg border border-border bg-bg-input px-2.5 py-2 text-sm text-text outline-none focus:border-accent"
            />
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => { void save() }} disabled={saving} className="h-8 rounded-lg bg-accent px-3 text-xs font-semibold text-accent-text disabled:opacity-50">
                {t('journal.save')}
              </button>
              <button type="button" onClick={() => { setDraft(value); setEditing(false) }} className="h-8 rounded-lg px-3 text-xs font-semibold text-muted hover:text-text">
                {t('journal.cancel')}
              </button>
              <span className="text-xs text-muted">{t('journal.instructionHint')}</span>
            </div>
          </>
        ) : (
          <span className="text-sm text-text">{value}</span>
        )}
      </div>
      {!editing && (
        <button type="button" onClick={() => { setDraft(value); setEditing(true) }} className="h-8 shrink-0 rounded-lg bg-bg-card px-3 text-xs font-semibold text-accent">
          {t('journal.edit')}
        </button>
      )}
    </div>
  )
}
