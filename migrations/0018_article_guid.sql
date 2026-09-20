-- Article identity: RSS <guid> / Atom <id>.
--
-- Until now an article was identified by its URL alone, enforced by a global
-- UNIQUE constraint. Feeds that publish several distinct entries behind the
-- same link — SOLIDWORKS Tech Alerts points every release note at the same
-- downloads.html, telling them apart only by <guid> — lost every entry after
-- the first: the new items were silently dropped as duplicates and the feed
-- stayed frozen on its oldest article.
--
-- Store the feed's own identifier and make it the identity when present:
-- UNIQUE (feed_id, guid) replaces UNIQUE (url). URL dedup still happens in
-- the ingest layer (cross-feed, and for feeds that carry no guid at all), so
-- dropping the constraint does not open the door to duplicate articles.
--
-- SQLite cannot drop a column constraint in place, so the table is rebuilt.
-- The migration runner disables foreign keys around each migration file.

DROP VIEW IF EXISTS active_articles;

CREATE TABLE articles_new (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  feed_id                 INTEGER NOT NULL REFERENCES feeds(id) ON DELETE CASCADE,
  category_id             INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  title                   TEXT NOT NULL,
  url                     TEXT NOT NULL,
  guid                    TEXT,
  lang                    TEXT,
  full_text               TEXT,
  full_text_translated    TEXT,
  translated_lang         TEXT,
  summary                 TEXT,
  excerpt                 TEXT,
  og_image                TEXT,
  score                   REAL NOT NULL DEFAULT 0,
  last_error              TEXT,
  seen_at                 TEXT,
  read_at                 TEXT,
  bookmarked_at           TEXT,
  liked_at                TEXT,
  images_archived_at      TEXT,
  published_at            TEXT,
  fetched_at              TEXT NOT NULL DEFAULT (datetime('now')),
  created_at              TEXT NOT NULL DEFAULT (datetime('now')),
  retry_count             INTEGER NOT NULL DEFAULT 0,
  last_retry_at           TEXT,
  purged_at               TEXT,
  last_refresh_attempt_at TEXT DEFAULT NULL,
  title_translated        TEXT,
  translate_pending_at    TEXT,
  summarize_pending_at    TEXT,
  filter_pending_at       TEXT,
  filtered_at             TEXT,
  videos_archived_at      TEXT,
  rule_boost              REAL NOT NULL DEFAULT 0,
  quality_score           REAL,
  interest_score          REAL NOT NULL DEFAULT 0
);

INSERT INTO articles_new (
  id, feed_id, category_id, title, url, lang, full_text, full_text_translated,
  translated_lang, summary, excerpt, og_image, score, last_error, seen_at,
  read_at, bookmarked_at, liked_at, images_archived_at, published_at,
  fetched_at, created_at, retry_count, last_retry_at, purged_at,
  last_refresh_attempt_at, title_translated, translate_pending_at,
  summarize_pending_at, filter_pending_at, filtered_at, videos_archived_at,
  rule_boost, quality_score, interest_score
)
SELECT
  id, feed_id, category_id, title, url, lang, full_text, full_text_translated,
  translated_lang, summary, excerpt, og_image, score, last_error, seen_at,
  read_at, bookmarked_at, liked_at, images_archived_at, published_at,
  fetched_at, created_at, retry_count, last_retry_at, purged_at,
  last_refresh_attempt_at, title_translated, translate_pending_at,
  summarize_pending_at, filter_pending_at, filtered_at, videos_archived_at,
  rule_boost, quality_score, interest_score
FROM articles;

DROP TABLE articles;

ALTER TABLE articles_new RENAME TO articles;

CREATE INDEX IF NOT EXISTS idx_articles_feed_id ON articles(feed_id);
CREATE INDEX IF NOT EXISTS idx_articles_published_at ON articles(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_articles_bookmarked_at ON articles(bookmarked_at);
CREATE INDEX IF NOT EXISTS idx_articles_feed_seen_at ON articles(feed_id, seen_at);
CREATE INDEX IF NOT EXISTS idx_articles_seen_at ON articles(seen_at);
CREATE INDEX IF NOT EXISTS idx_articles_read_at ON articles(read_at);
CREATE INDEX IF NOT EXISTS idx_articles_score ON articles(score DESC);
CREATE INDEX IF NOT EXISTS idx_articles_liked_at ON articles(liked_at);
CREATE INDEX IF NOT EXISTS idx_articles_category_published ON articles(category_id, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_articles_feed_score ON articles(feed_id, score DESC);
CREATE INDEX IF NOT EXISTS idx_articles_category_score ON articles(category_id, score DESC);
CREATE INDEX IF NOT EXISTS idx_articles_last_error ON articles(last_error) WHERE last_error IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_articles_purged_at ON articles(purged_at);
CREATE INDEX IF NOT EXISTS idx_articles_filtered_at ON articles(filtered_at);
CREATE INDEX IF NOT EXISTS idx_articles_interest ON articles(interest_score);

-- url lost its implicit unique index with the constraint; dedup lookups and
-- getArticleByUrl still need it.
CREATE INDEX IF NOT EXISTS idx_articles_url ON articles(url);

-- Identity index: a feed cannot carry the same guid twice. Rows with no guid
-- (feeds without one, and every article stored before this migration) are
-- left out of the index entirely.
CREATE UNIQUE INDEX IF NOT EXISTS idx_articles_feed_guid ON articles(feed_id, guid) WHERE guid IS NOT NULL;

-- Recreate the view: a SQLite view created with SELECT * freezes its column
-- list at creation time, so new columns require a rebuild.
CREATE VIEW active_articles AS
SELECT * FROM articles WHERE purged_at IS NULL;

-- Force one full re-read of every feed. The entries dropped as URL duplicates
-- are still in the live XML, but an unchanged body — matched on ETag,
-- Last-Modified or the stored content hash — skips parsing altogether, so
-- without this they would only surface whenever the feed next changes.
UPDATE feeds SET etag = NULL, last_modified = NULL, last_content_hash = NULL;
