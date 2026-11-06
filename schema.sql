-- Cabo Crew D1 schema (already applied to the cabo-crew database).
CREATE TABLE IF NOT EXISTS families (id TEXT PRIMARY KEY, name TEXT NOT NULL, token TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS members (id TEXT PRIMARY KEY, family_id TEXT NOT NULL, name TEXT NOT NULL, age INTEGER NOT NULL, pos INTEGER NOT NULL DEFAULT 0, fig BLOB, fig_mime TEXT, fig_v INTEGER NOT NULL DEFAULT 0, fig_kind TEXT);
CREATE INDEX IF NOT EXISTS members_family ON members(family_id);
CREATE TABLE IF NOT EXISTS budget (day TEXT PRIMARY KEY, n INTEGER NOT NULL DEFAULT 0);
