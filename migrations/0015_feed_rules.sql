-- Automated actions: regular-expression rules applied to every new article,
-- per feed or across all feeds (feed_id NULL). Actions mark the article as
-- seen, hide it (same filtered_at marker as the AI filter, so nothing is
-- deleted), bookmark or like it, or add a fixed boost to its score.
CREATE TABLE IF NOT EXISTS feed_rules (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  feed_id         INTEGER REFERENCES feeds(id) ON DELETE CASCADE,
  field           TEXT NOT NULL DEFAULT 'title',
  pattern         TEXT NOT NULL,
  action          TEXT NOT NULL,
  value           REAL,
  enabled         INTEGER NOT NULL DEFAULT 1,
  match_count     INTEGER NOT NULL DEFAULT 0,
  last_matched_at TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_feed_rules_feed ON feed_rules(feed_id);

-- Score boost accumulated from rules; folded into the engagement score.
ALTER TABLE articles ADD COLUMN rule_boost REAL NOT NULL DEFAULT 0;

-- Recreate the view: a SQLite view created with SELECT * freezes its column
-- list at creation time, so new columns require a rebuild.
DROP VIEW IF EXISTS active_articles;
CREATE VIEW active_articles AS
SELECT * FROM articles WHERE purged_at IS NULL;
