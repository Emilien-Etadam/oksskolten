-- Smart folders: a saved query (free text plus filters such as
-- `unread:true @week feed:12`) shown in the sidebar as a virtual folder.
-- New matches appear automatically, since the query runs on every open.
CREATE TABLE IF NOT EXISTS smart_folders (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  query      TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
