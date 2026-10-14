PRAGMA foreign_keys = ON;
-- One database per person, in that person's own Cloudflare account.
CREATE TABLE migration_owner (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  app_slug TEXT NOT NULL CHECK (app_slug IN ('eren','begum')),
  source_workspace_hash TEXT NOT NULL CHECK (length(source_workspace_hash) = 64),
  snapshot_at TEXT NOT NULL
);
CREATE TABLE schedule_manual_tasks (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 120),
  text TEXT NOT NULL CHECK (length(text) BETWEEN 1 AND 500),
  done INTEGER NOT NULL DEFAULT 0 CHECK (done IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX tasks_created ON schedule_manual_tasks(created_at DESC, id DESC);
CREATE TABLE schedule_transfer_items (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('text','link','file')),
  content TEXT,
  storage_key TEXT,
  download_storage_key TEXT,
  filename TEXT,
  content_type TEXT,
  bytes INTEGER DEFAULT 0 CHECK (bytes >= 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX transfers_created ON schedule_transfer_items(created_at DESC);
-- No push subscriptions, VAPID keys, Gmail credentials or notification tables.
