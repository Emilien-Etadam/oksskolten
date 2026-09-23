-- Article classification: every article gets a format (news, question,
-- guide…) and a theme (a reader-defined list), read out of a local language
-- model as a closed-choice decision (notjev). NULL means not classified yet,
-- or the model was undecided; classified_at tells the two apart.
ALTER TABLE articles ADD COLUMN format TEXT;
ALTER TABLE articles ADD COLUMN theme TEXT;
ALTER TABLE articles ADD COLUMN classified_at TEXT;
ALTER TABLE articles ADD COLUMN classify_pending_at TEXT;

CREATE INDEX IF NOT EXISTS idx_articles_format ON articles(format);
CREATE INDEX IF NOT EXISTS idx_articles_theme ON articles(theme);

-- Recreate the view: a SQLite view created with SELECT * freezes its column
-- list at creation time, so new columns require a rebuild.
DROP VIEW IF EXISTS active_articles;
CREATE VIEW active_articles AS
SELECT * FROM articles WHERE purged_at IS NULL;
