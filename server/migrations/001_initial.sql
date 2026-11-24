-- Naba AI Video Studio — Initial Relational Schema (SQLite / PostgreSQL compatible DDL)
-- Migration 001: Core 12 domain entities with foreign keys and query indexes

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS migrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 1. Users (instructors, admins, reviewers)
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'instructor',
  password_hash TEXT NOT NULL,
  locale TEXT NOT NULL DEFAULT 'ar',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 2. Lecturers (built-in and consent-verified custom virtual presenters)
CREATE TABLE IF NOT EXISTS lecturers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  name_ar TEXT NOT NULL,
  specialty TEXT NOT NULL,
  specialty_ar TEXT NOT NULL,
  bio TEXT NOT NULL,
  bio_ar TEXT NOT NULL,
  image_url TEXT NOT NULL,
  is_custom INTEGER NOT NULL DEFAULT 0,
  consent_verified INTEGER NOT NULL DEFAULT 1,
  consent_note TEXT,
  owner_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 3. Voice Profiles (Arabic & English TTS voices)
CREATE TABLE IF NOT EXISTS voice_profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  name_ar TEXT NOT NULL,
  language TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_voice_id TEXT NOT NULL,
  gender TEXT NOT NULL,
  style_prompt TEXT NOT NULL,
  speaking_rate REAL NOT NULL DEFAULT 1.0,
  is_free_tier INTEGER NOT NULL DEFAULT 1
);

-- 4. Projects (educational video production units)
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  title_ar TEXT NOT NULL,
  subject TEXT NOT NULL,
  education_level TEXT NOT NULL DEFAULT 'undergraduate',
  language TEXT NOT NULL DEFAULT 'ar',
  mode TEXT NOT NULL DEFAULT 'local',
  lecturer_id TEXT NOT NULL REFERENCES lecturers(id),
  voice_id TEXT NOT NULL REFERENCES voice_profiles(id),
  environment_id TEXT NOT NULL DEFAULT 'env-lecture-hall',
  status TEXT NOT NULL DEFAULT 'draft',
  academy_course_id TEXT,
  academy_lesson_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 5. Educational Materials (uploaded PDF, DOCX, PPTX, TXT sources)
CREATE TABLE IF NOT EXISTS educational_materials (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  storage_path TEXT NOT NULL,
  extracted_text TEXT NOT NULL,
  source_checksum TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 6. Scripts (structured educational script versions with instructor approval)
CREATE TABLE IF NOT EXISTS scripts (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  version INTEGER NOT NULL DEFAULT 1,
  learning_objectives_json TEXT NOT NULL DEFAULT '[]',
  key_concepts_json TEXT NOT NULL DEFAULT '[]',
  summary TEXT NOT NULL DEFAULT '',
  source_attribution_json TEXT NOT NULL DEFAULT '{}',
  approved INTEGER NOT NULL DEFAULT 0,
  approved_by TEXT,
  approved_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 7. Scenes (ordered storyboard & timeline segments)
CREATE TABLE IF NOT EXISTS scenes (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  script_id TEXT REFERENCES scripts(id) ON DELETE SET NULL,
  sort_order INTEGER NOT NULL,
  title TEXT NOT NULL,
  scene_type TEXT NOT NULL DEFAULT 'smartboard',
  dialogue TEXT NOT NULL,
  visual_instructions TEXT NOT NULL DEFAULT '',
  code_snippet TEXT NOT NULL DEFAULT '',
  code_language TEXT NOT NULL DEFAULT 'cpp',
  equation_latex TEXT NOT NULL DEFAULT '',
  bullet_points_json TEXT NOT NULL DEFAULT '[]',
  subtitle_text TEXT NOT NULL DEFAULT '',
  duration_sec REAL NOT NULL DEFAULT 4.0,
  audio_asset_id TEXT,
  visual_asset_id TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 8. Media Assets (externalized WAV audio, rendered PNG/MP4 clips, SRT subtitles)
CREATE TABLE IF NOT EXISTS media_assets (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  scene_id TEXT REFERENCES scenes(id) ON DELETE SET NULL,
  asset_type TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  duration_sec REAL NOT NULL DEFAULT 0,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 9. Generation Jobs (persistent async workflow state machine)
CREATE TABLE IF NOT EXISTS generation_jobs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  job_type TEXT NOT NULL DEFAULT 'full_render',
  mode TEXT NOT NULL DEFAULT 'local',
  status TEXT NOT NULL DEFAULT 'queued',
  progress_pct INTEGER NOT NULL DEFAULT 0,
  current_stage TEXT NOT NULL DEFAULT 'queued',
  stages_json TEXT NOT NULL DEFAULT '[]',
  cost_estimate_usd REAL NOT NULL DEFAULT 0,
  error_message TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  cancel_requested INTEGER NOT NULL DEFAULT 0,
  output_video_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 10. Provider Configurations (persisted capability & integration registry)
CREATE TABLE IF NOT EXISTS provider_configs (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  provider_key TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  execution_mode TEXT NOT NULL,
  is_configured INTEGER NOT NULL DEFAULT 0,
  is_free_tier INTEGER NOT NULL DEFAULT 1,
  capabilities_json TEXT NOT NULL DEFAULT '{}',
  notes TEXT NOT NULL DEFAULT ''
);

-- 11. Exported Videos (finished playable MP4 artifacts & Naba Academy publish state)
CREATE TABLE IF NOT EXISTS exported_videos (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  job_id TEXT REFERENCES generation_jobs(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  file_path TEXT NOT NULL,
  srt_path TEXT NOT NULL DEFAULT '',
  duration_sec REAL NOT NULL DEFAULT 0,
  resolution TEXT NOT NULL DEFAULT '1280x720',
  size_bytes INTEGER NOT NULL DEFAULT 0,
  render_mode TEXT NOT NULL DEFAULT 'deterministic_smartboard_ffmpeg',
  has_real_lipsync INTEGER NOT NULL DEFAULT 0,
  has_real_tts INTEGER NOT NULL DEFAULT 0,
  academy_published INTEGER NOT NULL DEFAULT 0,
  academy_payload_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 12. Audit Events (immutable trace of consent, script approvals, renders, exports)
CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Performance Indexes
CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id);
CREATE INDEX IF NOT EXISTS idx_materials_project ON educational_materials(project_id);
CREATE INDEX IF NOT EXISTS idx_scripts_project ON scripts(project_id);
CREATE INDEX IF NOT EXISTS idx_scenes_project_order ON scenes(project_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_media_assets_project ON media_assets(project_id);
CREATE INDEX IF NOT EXISTS idx_jobs_project_status ON generation_jobs(project_id, status);
CREATE INDEX IF NOT EXISTS idx_exports_project ON exported_videos(project_id);
CREATE INDEX IF NOT EXISTS idx_audit_project_time ON audit_events(project_id, created_at);
