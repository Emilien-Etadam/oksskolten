-- Hidden themes: articles classified into a theme the reader hid get the
-- usual filtered_at marker, and hidden_by_theme records which theme did it,
-- so un-hiding the theme brings back exactly those articles (and never the
-- ones the AI filter or a rule hid).
ALTER TABLE articles ADD COLUMN hidden_by_theme TEXT;

CREATE INDEX IF NOT EXISTS idx_articles_hidden_by_theme ON articles(hidden_by_theme);

-- Recreate the view: a SQLite view created with SELECT * freezes its column
-- list at creation time, so new columns require a rebuild.
DROP VIEW IF EXISTS active_articles;
CREATE VIEW active_articles AS
SELECT * FROM articles WHERE purged_at IS NULL;
