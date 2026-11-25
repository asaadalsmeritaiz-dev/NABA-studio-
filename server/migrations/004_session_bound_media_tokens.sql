ALTER TABLE media_tokens
ADD COLUMN session_token_hash TEXT REFERENCES user_sessions(token_hash) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_media_tokens_session ON media_tokens(session_token_hash);
