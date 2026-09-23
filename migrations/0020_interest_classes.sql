-- Interest profile, second half: affinity for article classes (the themes
-- and formats of 87_feature_classification.md). For each class the reader
-- has seen enough of, how much more (or less) they engage with it than with
-- an average article, as a -1..1 affinity added to the interest score.
CREATE TABLE IF NOT EXISTS interest_classes (
  kind       TEXT NOT NULL,                  -- 'theme' | 'format'
  class_id   TEXT NOT NULL,                  -- articles.theme / articles.format value
  affinity   REAL NOT NULL DEFAULT 0,        -- -1..1, 0 = average
  seen       INTEGER NOT NULL DEFAULT 0,     -- articles of that class seen in the window
  engaged    REAL NOT NULL DEFAULT 0,        -- their summed engagement weight
  muted      INTEGER NOT NULL DEFAULT 0,     -- 1 = reader said not interested
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (kind, class_id)
);
