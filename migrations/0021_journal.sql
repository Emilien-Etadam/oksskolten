-- Journal: an on-demand digest of everything that arrived since the previous
-- edition, one sourced synthesis per article theme. An edition is written by
-- a background job; `status` moves from 'running' to 'done' or 'error', and
-- `content` holds the finished edition as JSON (sections, sources, essentials).
CREATE TABLE IF NOT EXISTS journal_editions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  -- Articles whose created_at falls in (period_start, period_end] are covered.
  -- NULL period_start: the first edition, which looks back a fixed window.
  period_start  TEXT,
  period_end    TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'running',
  error         TEXT,
  article_count INTEGER NOT NULL DEFAULT 0,
  sections_done INTEGER NOT NULL DEFAULT 0,
  sections_total INTEGER NOT NULL DEFAULT 0,
  content       TEXT,
  finished_at   TEXT
);

CREATE INDEX IF NOT EXISTS idx_journal_editions_status ON journal_editions(status);

-- Free-text instruction the reader gives for one theme ("ignore memes").
-- Keyed by theme id; '_' is the bucket of articles without a theme.
CREATE TABLE IF NOT EXISTS journal_instructions (
  theme       TEXT PRIMARY KEY,
  instruction TEXT NOT NULL,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- "More like this" (1) / "less like this" (-1) on a cited source. Recent
-- votes are shown to the model as examples when it writes that theme.
CREATE TABLE IF NOT EXISTS journal_feedback (
  article_id  INTEGER PRIMARY KEY REFERENCES articles(id) ON DELETE CASCADE,
  vote        INTEGER NOT NULL,
  theme       TEXT,
  title       TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
