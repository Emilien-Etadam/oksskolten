-- Git backup: GitHub repositories archived as pull mirrors on a Forgejo
-- instance (docs/spec/86_feature_git_backup.md). Forgejo holds the code;
-- this table only remembers which repositories are archived, where, and what
-- the last check found.
CREATE TABLE IF NOT EXISTS git_backups (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  github_owner     TEXT NOT NULL COLLATE NOCASE,
  github_repo      TEXT NOT NULL COLLATE NOCASE,
  forgejo_owner    TEXT NOT NULL,
  forgejo_repo     TEXT NOT NULL,
  default_branch   TEXT NOT NULL,
  -- 'importing' | 'ok' | 'blocked' | 'frozen' | 'error'
  status           TEXT NOT NULL DEFAULT 'importing',
  -- JSON array of the refs a sync would lose, set while status = 'blocked'
  blocked_refs     TEXT,
  last_error       TEXT,
  last_checked_at  TEXT,
  last_synced_at   TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (github_owner, github_repo)
);
