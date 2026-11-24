-- Migration 002: Server-side sessions, scoped media tokens, honest publish status & generative video metadata
-- Strictly non-destructive: preserves all existing users, projects, scenes, media assets, and exported videos.

CREATE TABLE IF NOT EXISTS user_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS media_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_exp ON user_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_media_tokens_user ON media_tokens(user_id);

ALTER TABLE users ADD COLUMN workspace_claimed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE exported_videos ADD COLUMN publish_status TEXT NOT NULL DEFAULT 'not_published';
ALTER TABLE exported_videos ADD COLUMN has_generative_video INTEGER NOT NULL DEFAULT 0;

-- Preserve accurate status for any previously prepared local manifests (never claim remote publish without webhook receipt)
UPDATE exported_videos
SET publish_status = 'prepared_local', academy_published = 0
WHERE academy_published = 1
  AND (academy_payload_json IS NULL OR academy_payload_json NOT LIKE '%"remote_confirmed":true%');
