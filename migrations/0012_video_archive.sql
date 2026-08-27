-- On-demand video archiving, the sibling of image archiving: an article that
-- embeds a video can keep a copy of it so it stays watchable after the source
-- takes it down. Deliberate rather than automatic, because a video is three
-- orders of magnitude larger than the images alongside it.
ALTER TABLE articles ADD COLUMN videos_archived_at TEXT;

-- Recreate the view: a SQLite view created with SELECT * freezes its column
-- list at creation time, so new columns require a rebuild.
DROP VIEW IF EXISTS active_articles;
CREATE VIEW active_articles AS
SELECT * FROM articles WHERE purged_at IS NULL;
