CREATE TABLE IF NOT EXISTS courses (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  title_ar TEXT NOT NULL,
  subject TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  education_level TEXT NOT NULL DEFAULT 'undergraduate',
  language TEXT NOT NULL DEFAULT 'ar' CHECK (language IN ('ar', 'en')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'archived')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS course_chapters (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL,
  title TEXT NOT NULL,
  title_ar TEXT NOT NULL,
  learning_objectives_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (course_id, sort_order)
);

CREATE TABLE IF NOT EXISTS course_lessons (
  id TEXT PRIMARY KEY,
  chapter_id TEXT NOT NULL REFERENCES course_chapters(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  title_ar TEXT NOT NULL,
  learning_objectives_json TEXT NOT NULL DEFAULT '[]',
  estimated_duration_sec INTEGER NOT NULL DEFAULT 300 CHECK (estimated_duration_sec BETWEEN 8 AND 1800),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (chapter_id, sort_order)
);

CREATE INDEX IF NOT EXISTS idx_courses_owner_updated
  ON courses(owner_user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_course_chapters_course_order
  ON course_chapters(course_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_course_lessons_chapter_order
  ON course_lessons(chapter_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_course_lessons_project
  ON course_lessons(project_id);
