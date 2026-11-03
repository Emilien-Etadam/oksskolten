-- Importance for the reader: a third closed question (notjev) asked with the
-- format and the theme. ESSENTIAL / USEFUL / SKIP; NULL when not asked yet or
-- when the model was undecided, which the journal reads as USEFUL.
ALTER TABLE articles ADD COLUMN importance TEXT;

-- Recreate the view: a SQLite view created with SELECT * freezes its column
-- list at creation time, so new columns require a rebuild.
DROP VIEW IF EXISTS active_articles;
CREATE VIEW active_articles AS
SELECT * FROM articles WHERE purged_at IS NULL;
