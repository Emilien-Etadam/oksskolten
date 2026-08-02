-- Background AI pipeline: translated titles + persistent pending markers
-- so queued work survives server restarts, and auto-summarize default.
ALTER TABLE articles ADD COLUMN title_translated TEXT;
ALTER TABLE articles ADD COLUMN translate_pending_at TEXT;
ALTER TABLE articles ADD COLUMN summarize_pending_at TEXT;
INSERT OR IGNORE INTO settings (key, value) VALUES ('reading.auto_summarize', 'off');

-- Recreate the view: a SQLite view created with SELECT * freezes its column
-- list at creation time, so new columns require a rebuild.
DROP VIEW IF EXISTS active_articles;
CREATE VIEW active_articles AS
SELECT * FROM articles WHERE purged_at IS NULL;
