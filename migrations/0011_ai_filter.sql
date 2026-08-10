-- Per-feed AI relevance filter: a criterion written by the reader is checked
-- against every new article of that feed. Rejected articles keep their row but
-- are marked filtered_at and hidden from the lists, so nothing is lost.
ALTER TABLE feeds ADD COLUMN ai_filter TEXT;
ALTER TABLE articles ADD COLUMN filter_pending_at TEXT;
ALTER TABLE articles ADD COLUMN filtered_at TEXT;

CREATE INDEX IF NOT EXISTS idx_articles_filtered_at ON articles(filtered_at);

-- Recreate the view: a SQLite view created with SELECT * freezes its column
-- list at creation time, so new columns require a rebuild.
DROP VIEW IF EXISTS active_articles;
CREATE VIEW active_articles AS
SELECT * FROM articles WHERE purged_at IS NULL;
