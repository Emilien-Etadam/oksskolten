-- Interest profile learned from reading feedback (likes, bookmarks, opened
-- articles): weighted terms grouped into islands of co-occurring terms.
-- Each unread article carries an interest_score against that profile,
-- which orders the Recommended list.
CREATE TABLE IF NOT EXISTS interest_terms (
  term       TEXT PRIMARY KEY,
  weight     REAL NOT NULL DEFAULT 0,
  island     INTEGER NOT NULL DEFAULT 0,
  muted      INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

ALTER TABLE articles ADD COLUMN interest_score REAL NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_articles_interest ON articles(interest_score);

-- Recreate the view: a SQLite view created with SELECT * freezes its column
-- list at creation time, so new columns require a rebuild.
DROP VIEW IF EXISTS active_articles;
CREATE VIEW active_articles AS
SELECT * FROM articles WHERE purged_at IS NULL;
