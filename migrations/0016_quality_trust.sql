-- Article quality (0..1, heuristic: thin body, clickbait title, promotional
-- markers, link density) computed at ingestion, and per-feed trust (0..1,
-- recent reading value of the source) refreshed by the score cron. Both
-- feed the front page and top stories ranking.
ALTER TABLE articles ADD COLUMN quality_score REAL;
ALTER TABLE feeds ADD COLUMN trust_score REAL NOT NULL DEFAULT 0;

-- Recreate the view: a SQLite view created with SELECT * freezes its column
-- list at creation time, so new columns require a rebuild.
DROP VIEW IF EXISTS active_articles;
CREATE VIEW active_articles AS
SELECT * FROM articles WHERE purged_at IS NULL;
