#!/usr/bin/env node --import tsx
/**
 * Evaluate article "format" classification (news, opinion, guide…) with notjev
 * against a local OpenAI-compatible inference server, before wiring it into
 * the app.
 *
 * Reads the most recent articles from the SQLite database in read-only mode
 * (safe while the server is running), asks one closed question per article and
 * prints the verdict, its probability and band. `UNDECIDED` means the margin
 * between the two best formats is below theta. Results are also written to a
 * CSV file for review.
 *
 * Usage:
 *   NOTJEV_BASE_URL=http://host:8000 NOTJEV_MODEL=<model> \
 *     npx tsx scripts/format-eval.ts [--limit 50] [--theta 0.5] [--db ./data/rss.db] [--out file.csv]
 */
import fs from 'node:fs'
import Database from 'libsql'
import notjev from 'notjev'

const FORMATS = [
  { id: 'NEWS', description: 'news or current event: reports what happened, including product launches and company news' },
  { id: 'QUESTION', description: 'the author asks for help, advice or a recommendation for their own situation' },
  { id: 'DISCUSSION', description: 'the author opens a debate or asks the community what they think' },
  { id: 'OPINION', description: 'analysis, opinion or editorial: the author argues a point of view' },
  { id: 'GUIDE', description: 'tutorial, how-to or guide: teaches how to do something' },
  { id: 'REVIEW', description: 'review or hands-on experience of a product, service or work' },
  { id: 'RELEASE', description: 'new version of a software or project: release notes, changelog' },
  { id: 'STORY', description: 'personal story or testimony told by the author' },
  { id: 'RESOURCE', description: 'resource or tool: a list, a link collection, a dataset, a project' },
  { id: 'ENTERTAINMENT', description: 'entertainment, humor or meme' },
  { id: 'OTHER', description: 'none of the above' },
]

const QUESTION = 'What is the format of this article?'
const BODY_CHARS = 1500

interface Args {
  limit: number
  theta: number
  db: string
  out: string
}

interface ArticleRow {
  id: number
  title: string
  feed: string | null
  full_text: string | null
  excerpt: string | null
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    limit: 50,
    theta: 0.5,
    db: './data/rss.db',
    out: `./data/format-eval-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`,
  }
  for (let i = 0; i < argv.length; i++) {
    const value = argv[i + 1]
    switch (argv[i]) {
      case '--limit': args.limit = Number(value); i++; break
      case '--theta': args.theta = Number(value); i++; break
      case '--db': args.db = value; i++; break
      case '--out': args.out = value; i++; break
      default:
        console.error(`Unknown argument: ${argv[i]}`)
        process.exit(1)
    }
  }
  if (!Number.isInteger(args.limit) || args.limit <= 0) {
    console.error('--limit must be a positive integer')
    process.exit(1)
  }
  return args
}

function buildState(row: ArticleRow): string {
  const body = (row.full_text || row.excerpt || '').replace(/\s+/g, ' ').trim().slice(0, BODY_CHARS)
  return `Title: ${row.title}\nSource: ${row.feed ?? 'unknown'}\n\n${body}\n`
}

function csvCell(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!fs.existsSync(args.db)) {
    console.error(`Database not found: ${args.db}`)
    process.exit(1)
  }

  const db = new Database(args.db, { readonly: true })
  const rows = db.prepare(`
    SELECT a.id, a.title, f.name AS feed, a.full_text, a.excerpt
    FROM articles a
    LEFT JOIN feeds f ON f.id = a.feed_id
    ORDER BY a.published_at DESC, a.id DESC
    LIMIT ?
  `).all(args.limit) as ArticleRow[]
  db.close()

  if (rows.length === 0) {
    console.error('No articles found.')
    process.exit(1)
  }

  const jev = notjev.createClient()
  const header = ['id', 'title', 'feed', 'format', 'top', 'p1', 'p2', 'band', 'undecided', 'degraded', 'ms']
  const lines = [header.join(',')]
  const counts = new Map<string, number>()
  let undecided = 0
  let errors = 0
  let totalMs = 0

  console.log(`Classifying ${rows.length} articles (theta ${args.theta})…\n`)
  for (const [i, row] of rows.entries()) {
    try {
      const r = await jev.decide({
        state: buildState(row),
        question: QUESTION,
        options: FORMATS,
        theta: args.theta,
      })
      const label = r.choice ?? 'UNDECIDED'
      counts.set(label, (counts.get(label) ?? 0) + 1)
      if (r.undecided) undecided++
      totalMs += r.ms
      console.log(
        `${String(i + 1).padStart(3)}. ${label.padEnd(13)} ${r.p1.toFixed(2)} ${r.band.padEnd(7)} `
        + `${r.undecided ? `(top ${r.top}) ` : ''}${truncate(row.title, 70)}`,
      )
      lines.push([
        row.id, row.title, row.feed, r.choice, r.top, r.p1.toFixed(3), r.p2.toFixed(3),
        r.band, r.undecided, r.degraded, r.ms,
      ].map(csvCell).join(','))
    } catch (err) {
      errors++
      const message = err instanceof Error ? err.message : String(err)
      console.log(`${String(i + 1).padStart(3)}. ERROR         ${truncate(row.title, 50)} — ${message}`)
      lines.push([row.id, row.title, row.feed, 'ERROR', '', '', '', '', '', '', ''].map(csvCell).join(','))
    }
  }

  fs.writeFileSync(args.out, `${lines.join('\n')}\n`)

  const done = rows.length - errors
  console.log('\nDistribution:')
  for (const [label, n] of [...counts].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${label.padEnd(13)} ${String(n).padStart(3)}`)
  }
  console.log(`\nUndecided: ${undecided}/${done}  Errors: ${errors}  Avg latency: ${done ? Math.round(totalMs / done) : 0} ms`)
  console.log(`CSV written to ${args.out}`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
