/**
 * Interest profile learned from reading feedback.
 *
 * Every liked, bookmarked or opened article of the last 90 days votes for
 * the terms of its title (and translated title): likes weigh 3, bookmarks 2,
 * an opened article 1. Votes are discounted by how common a term is across
 * the whole archive (an idf term), so "google" or "nouveau" never dominate.
 * The top terms are grouped into *islands* — terms that keep appearing in
 * the same articles — which is what the settings page shows, and what a
 * reader can mute.
 *
 * The same feedback also measures an affinity for article classes (the
 * theme and format given by the local model): for each class seen often
 * enough, its engagement rate against the average one, as -1..1. A theme
 * the reader keeps opening pulls up; one they scroll past pulls down.
 *
 * Each unread article then gets an interest score: the sum of the weights
 * of the profile terms it mentions, muted terms counting against it, plus
 * the affinities of its theme and format. The Recommended list is that
 * score, descending.
 */
import { getDb } from '../db/connection.js'
import { setArticleInterestScore } from '../db/articles.js'
import { logger } from '../logger.js'

const log = logger.child('interests')

const FEEDBACK_WINDOW_DAYS = 90
const MAX_TERMS = 80
const MIN_TERM_LENGTH = 3
/** Sample of recent articles used to estimate how common a term is */
const DF_SAMPLE = 5000
/** Co-occurrence needed (Jaccard over engaged articles) to put two terms on one island */
const ISLAND_JACCARD = 0.25
/** Unread articles this recent get rescored when the profile changes */
const RESCORE_WINDOW_DAYS = 14
/** A class needs this many seen articles before its affinity counts */
const CLASS_MIN_SEEN = 5
/** Pseudo-count pulling small classes toward the average engagement rate */
const CLASS_SHRINK = 5
/** Weight of one class affinity in the interest score (a top term weighs 1) */
const CLASS_WEIGHT = 1

const STOPWORDS = new Set(`
a about above after again against all also am an and any are as at be because been before being below between
both but by can could did do does doing down during each few for from further had has have having he her here
hers herself him himself his how i if in into is it its itself just let me more most my myself no nor not now of
off on once only or other our ours ourselves out over own same she should so some such than that the their theirs
them themselves then there these they this those through to too under until up very was we were what when where
which while who whom why will with would you your yours yourself yourselves new news says said year years one two
first last week today via how why what make made get gets got
au aux avec ce ces cet cette dans de des du elle elles en est et eux il ils je la le les leur leurs lui ma mais me
même mes moi mon ne nos notre nous on ont ou par pas pour qu que qui sa se ses son sur ta te tes toi ton tu un une
vos votre vous été être avoir fait faire plus sans sous chez vers entre comme aussi tout tous toute toutes après
avant bien encore déjà très peu ici là où dont cela ceci celui celle ceux celles quel quelle quels quelles ans
nouveau nouvelle nouveaux nouvelles selon contre depuis pendant
`.split(/\s+/).filter(Boolean))

export function tokenize(text: string): string[] {
  const out = new Set<string>()
  for (const raw of text.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    const term = raw.trim()
    if (term.length < MIN_TERM_LENGTH) continue
    if (/^\d+$/.test(term)) continue
    if (STOPWORDS.has(term)) continue
    out.add(term)
  }
  return [...out]
}

export interface InterestTerm {
  term: string
  weight: number
  island: number
  muted: number
  updated_at: string
}

export interface InterestIsland {
  id: number
  terms: InterestTerm[]
}

export type ClassKind = 'theme' | 'format'

export interface InterestClass {
  kind: ClassKind
  class_id: string
  affinity: number
  seen: number
  engaged: number
  muted: number
}

export interface ArticleClasses {
  theme?: string | null
  format?: string | null
}

let profileCache: Map<string, { weight: number; muted: boolean }> | null = null
let classCache: Map<string, { affinity: number; muted: boolean }> | null = null

function classKey(kind: ClassKind, id: string): string {
  return `${kind}:${id}`
}

function loadClassProfile(): Map<string, { affinity: number; muted: boolean }> {
  if (classCache) return classCache
  const rows = getDb().prepare('SELECT kind, class_id, affinity, muted FROM interest_classes').all() as Array<{ kind: ClassKind; class_id: string; affinity: number; muted: number }>
  classCache = new Map(rows.map(r => [classKey(r.kind, r.class_id), { affinity: r.affinity, muted: r.muted === 1 }]))
  return classCache
}

/** A muted class counts as a full "not interested", whatever was measured */
function classContribution(kind: ClassKind, id: string | null | undefined): number {
  if (!id) return 0
  const entry = loadClassProfile().get(classKey(kind, id))
  if (!entry) return 0
  return (entry.muted ? -1 : entry.affinity) * CLASS_WEIGHT
}

function loadProfile(): Map<string, { weight: number; muted: boolean }> {
  if (profileCache) return profileCache
  const rows = getDb().prepare('SELECT term, weight, muted FROM interest_terms').all() as Array<{ term: string; weight: number; muted: number }>
  profileCache = new Map(rows.map(r => [r.term, { weight: r.weight, muted: r.muted === 1 }]))
  return profileCache
}

export function invalidateInterestProfile(): void {
  profileCache = null
  classCache = null
}

/** Interest score of one article against the current profile. */
export function scoreInterest(title: string, titleTranslated?: string | null, classes?: ArticleClasses): number {
  const profile = loadProfile()
  let score = classContribution('theme', classes?.theme) + classContribution('format', classes?.format)
  for (const term of profile.size > 0 ? tokenize(`${title} ${titleTranslated ?? ''}`) : []) {
    const entry = profile.get(term)
    if (!entry) continue
    score += entry.muted ? -entry.weight : entry.weight
  }
  return Math.round(score * 1000) / 1000
}

export function getInterestIslands(): InterestIsland[] {
  const rows = getDb().prepare('SELECT * FROM interest_terms ORDER BY island ASC, weight DESC').all() as InterestTerm[]
  const byIsland = new Map<number, InterestTerm[]>()
  for (const row of rows) {
    const list = byIsland.get(row.island)
    if (list) list.push(row); else byIsland.set(row.island, [row])
  }
  return [...byIsland.entries()]
    .map(([id, terms]) => ({ id, terms }))
    .sort((a, b) => b.terms.reduce((s, t) => s + t.weight, 0) - a.terms.reduce((s, t) => s + t.weight, 0))
}

export function getInterestClasses(): InterestClass[] {
  return getDb().prepare(`
    SELECT kind, class_id, affinity, seen, engaged, muted FROM interest_classes
    ORDER BY kind DESC, affinity DESC
  `).all() as InterestClass[]
}

export function setInterestClassMuted(kind: ClassKind, classId: string, muted: boolean): boolean {
  const result = getDb().prepare('UPDATE interest_classes SET muted = ? WHERE kind = ? AND class_id = ?').run(muted ? 1 : 0, kind, classId)
  if (result.changes > 0) invalidateInterestProfile()
  return result.changes > 0
}

/**
 * Affinity per class from the articles the reader has seen in the window.
 * The engagement rate of a class is shrunk toward the overall rate (small
 * classes stay near 0), then compared to it on a log2 scale: twice the
 * average engagement is +0.5, half is -0.5, clamped to -1..1. Muted flags
 * survive; classes seen fewer than CLASS_MIN_SEEN times are dropped.
 */
export function rebuildClassAffinities(): { classes: number } {
  const db = getDb()
  const rows = db.prepare(`
    SELECT theme, format,
      (CASE WHEN liked_at IS NOT NULL THEN 3 ELSE 0 END)
      + (CASE WHEN bookmarked_at IS NOT NULL THEN 2 ELSE 0 END)
      + (CASE WHEN read_at IS NOT NULL THEN 1 ELSE 0 END) AS weight
    FROM active_articles
    WHERE seen_at IS NOT NULL
      AND classified_at IS NOT NULL
      AND seen_at >= datetime('now', '-${FEEDBACK_WINDOW_DAYS} days')
  `).all() as Array<{ theme: string | null; format: string | null; weight: number }>

  const stats = new Map<string, { kind: ClassKind; id: string; seen: number; engaged: number }>()
  let totalWeight = 0
  for (const row of rows) {
    totalWeight += row.weight
    for (const [kind, id] of [['theme', row.theme], ['format', row.format]] as Array<[ClassKind, string | null]>) {
      if (!id) continue
      const key = classKey(kind, id)
      const entry = stats.get(key) ?? { kind, id, seen: 0, engaged: 0 }
      entry.seen++
      entry.engaged += row.weight
      stats.set(key, entry)
    }
  }

  const overall = rows.length > 0 ? totalWeight / rows.length : 0
  const kept = [...stats.values()].filter(s => s.seen >= CLASS_MIN_SEEN)
  // Muted rows are never deleted, so a reader's "not interested" survives a
  // class falling out of the window; the upsert refreshes their numbers
  const upsert = db.prepare(`
    INSERT INTO interest_classes (kind, class_id, affinity, seen, engaged, muted, updated_at)
    VALUES (?, ?, ?, ?, ?, 0, datetime('now'))
    ON CONFLICT(kind, class_id) DO UPDATE SET
      affinity = excluded.affinity, seen = excluded.seen, engaged = excluded.engaged, updated_at = excluded.updated_at
  `)
  db.transaction(() => {
    db.prepare('DELETE FROM interest_classes WHERE muted = 0').run()
    for (const s of kept) {
      let affinity = 0
      if (overall > 0) {
        const rate = (s.engaged + overall * CLASS_SHRINK) / (s.seen + CLASS_SHRINK)
        affinity = Math.max(-1, Math.min(1, Math.log2(rate / overall) / 2))
      }
      upsert.run(s.kind, s.id, Math.round(affinity * 1000) / 1000, s.seen, s.engaged)
    }
  })()
  invalidateInterestProfile()
  return { classes: kept.length }
}

export function setInterestMuted(term: string, muted: boolean): boolean {
  const result = getDb().prepare('UPDATE interest_terms SET muted = ? WHERE term = ?').run(muted ? 1 : 0, term)
  if (result.changes > 0) invalidateInterestProfile()
  return result.changes > 0
}

interface EngagedArticle {
  id: number
  title: string
  title_translated: string | null
  weight: number
}

/**
 * Rebuild the profile from recent feedback. Muted flags survive a rebuild
 * for terms that stay in the profile. Returns the number of terms kept.
 */
export function rebuildInterestProfile(): { terms: number; islands: number } {
  const db = getDb()
  const engaged = db.prepare(`
    SELECT id, title, title_translated,
      (CASE WHEN liked_at IS NOT NULL THEN 3 ELSE 0 END)
      + (CASE WHEN bookmarked_at IS NOT NULL THEN 2 ELSE 0 END)
      + (CASE WHEN read_at IS NOT NULL THEN 1 ELSE 0 END) AS weight
    FROM active_articles
    WHERE (liked_at IS NOT NULL OR bookmarked_at IS NOT NULL OR read_at IS NOT NULL)
      AND COALESCE(read_at, liked_at, bookmarked_at, fetched_at) >= datetime('now', '-${FEEDBACK_WINDOW_DAYS} days')
  `).all() as EngagedArticle[]

  const muted = new Set((db.prepare('SELECT term FROM interest_terms WHERE muted = 1').all() as Array<{ term: string }>).map(r => r.term))

  if (engaged.length === 0) {
    db.prepare('DELETE FROM interest_terms').run()
    invalidateInterestProfile()
    return { terms: 0, islands: 0 }
  }

  // Document frequency over a sample of the archive, engaged or not
  const sample = db.prepare(`
    SELECT title, title_translated FROM active_articles ORDER BY id DESC LIMIT ${DF_SAMPLE}
  `).all() as Array<{ title: string; title_translated: string | null }>
  const df = new Map<string, number>()
  for (const row of sample) {
    for (const term of tokenize(`${row.title} ${row.title_translated ?? ''}`)) df.set(term, (df.get(term) ?? 0) + 1)
  }
  const sampleSize = Math.max(sample.length, 1)

  // Votes and the set of engaged articles per term
  const votes = new Map<string, number>()
  const docs = new Map<string, Set<number>>()
  for (const article of engaged) {
    for (const term of tokenize(`${article.title} ${article.title_translated ?? ''}`)) {
      votes.set(term, (votes.get(term) ?? 0) + article.weight)
      let set = docs.get(term)
      if (!set) { set = new Set(); docs.set(term, set) }
      set.add(article.id)
    }
  }

  const scored = [...votes.entries()]
    .filter(([term]) => (docs.get(term)?.size ?? 0) >= 2 || engaged.length < 5)
    .map(([term, vote]) => {
      const idf = Math.log((sampleSize + 1) / ((df.get(term) ?? 0) + 1)) + 0.1
      return { term, raw: vote * idf }
    })
    .sort((a, b) => b.raw - a.raw)
    .slice(0, MAX_TERMS)

  if (scored.length === 0) {
    db.prepare('DELETE FROM interest_terms').run()
    invalidateInterestProfile()
    return { terms: 0, islands: 0 }
  }

  const maxRaw = scored[0].raw
  const terms = scored.map(s => ({ term: s.term, weight: Math.round((s.raw / maxRaw) * 1000) / 1000 }))

  // Islands: union terms whose engaged-article sets overlap enough
  const parent = new Map<string, string>(terms.map(t => [t.term, t.term]))
  const find = (x: string): string => {
    let r = x
    while (parent.get(r) !== r) r = parent.get(r)!
    return r
  }
  for (let i = 0; i < terms.length; i++) {
    const a = docs.get(terms[i].term)!
    for (let j = i + 1; j < terms.length; j++) {
      const b = docs.get(terms[j].term)!
      let inter = 0
      for (const id of a) if (b.has(id)) inter++
      if (inter === 0) continue
      const jaccard = inter / (a.size + b.size - inter)
      if (jaccard >= ISLAND_JACCARD) parent.set(find(terms[i].term), find(terms[j].term))
    }
  }
  const islandIds = new Map<string, number>()
  const islandWeight = new Map<string, number>()
  for (const t of terms) {
    const root = find(t.term)
    islandWeight.set(root, (islandWeight.get(root) ?? 0) + t.weight)
  }
  // Number islands by descending total weight so island 0 is the strongest
  const rootsSorted = [...islandWeight.entries()].sort((a, b) => b[1] - a[1]).map(([root]) => root)
  rootsSorted.forEach((root, index) => islandIds.set(root, index))

  const insert = db.prepare(`
    INSERT INTO interest_terms (term, weight, island, muted, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
  `)
  db.transaction(() => {
    db.prepare('DELETE FROM interest_terms').run()
    for (const t of terms) {
      insert.run(t.term, t.weight, islandIds.get(find(t.term)) ?? 0, muted.has(t.term) ? 1 : 0)
    }
  })()
  invalidateInterestProfile()

  log.info(`Interest profile rebuilt: ${terms.length} terms, ${rootsSorted.length} islands from ${engaged.length} articles`)
  return { terms: terms.length, islands: rootsSorted.length }
}

/** Rescore recent unread articles against the current profile. */
export function recalculateInterestScores(): { updated: number } {
  const db = getDb()
  const rows = db.prepare(`
    SELECT id, title, title_translated, theme, format FROM active_articles
    WHERE seen_at IS NULL AND fetched_at >= datetime('now', '-${RESCORE_WINDOW_DAYS} days')
  `).all() as Array<{ id: number; title: string; title_translated: string | null } & ArticleClasses>
  const update = db.prepare('UPDATE articles SET interest_score = ? WHERE id = ?')
  db.transaction(() => {
    for (const row of rows) update.run(scoreInterest(row.title, row.title_translated, row), row.id)
  })()
  return { updated: rows.length }
}

/** Rescore one article, e.g. once the model has given it a theme and format. */
export function rescoreArticleInterest(articleId: number): void {
  const row = getDb().prepare('SELECT title, title_translated, theme, format FROM active_articles WHERE id = ?')
    .get(articleId) as ({ title: string; title_translated: string | null } & ArticleClasses) | undefined
  if (!row) return
  setArticleInterestScore(articleId, scoreInterest(row.title, row.title_translated, row))
}

/** Score one freshly inserted article against the current profile. */
export function scoreNewArticle(articleId: number, title: string): void {
  const score = scoreInterest(title)
  if (score !== 0) setArticleInterestScore(articleId, score)
}

let lastRebuildAt = 0
const REBUILD_INTERVAL_MS = 60 * 60 * 1000

/** Rebuild the profile at most hourly; meant for the score cron. */
export function maybeRebuildInterestProfile(force = false): boolean {
  if (!force && Date.now() - lastRebuildAt < REBUILD_INTERVAL_MS) return false
  lastRebuildAt = Date.now()
  rebuildInterestProfile()
  rebuildClassAffinities()
  recalculateInterestScores()
  return true
}

export function _resetInterestsForTests(): void {
  profileCache = null
  lastRebuildAt = 0
}
