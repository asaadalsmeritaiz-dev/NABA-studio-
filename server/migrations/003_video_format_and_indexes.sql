-- Naba AI Video Studio — Video Format Support & Performance Indexes
-- Non-destructive migration: preserves all existing projects, scenes, and exports.

ALTER TABLE projects ADD COLUMN aspect_ratio TEXT NOT NULL DEFAULT '16:9';
ALTER TABLE projects ADD COLUMN resolution TEXT NOT NULL DEFAULT '720p';

CREATE INDEX IF NOT EXISTS idx_projects_user_updated ON projects(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_scenes_project_order ON scenes(project_id, sort_order ASC);
CREATE INDEX IF NOT EXISTS idx_exports_project_created ON exported_videos(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_project_created ON generation_jobs(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_media_assets_project ON media_assets(project_id, created_at DESC);
