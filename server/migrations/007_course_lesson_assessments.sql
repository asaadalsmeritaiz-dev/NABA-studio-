ALTER TABLE course_lessons
  ADD COLUMN exercises_json TEXT NOT NULL DEFAULT '[]';

ALTER TABLE course_lessons
  ADD COLUMN assessment_json TEXT NOT NULL DEFAULT '[]';

CREATE TABLE IF NOT EXISTS course_lesson_sources (
  lesson_id TEXT NOT NULL REFERENCES course_lessons(id) ON DELETE CASCADE,
  material_id TEXT NOT NULL REFERENCES educational_materials(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (lesson_id, material_id)
);

CREATE INDEX IF NOT EXISTS idx_course_lesson_sources_material
  ON course_lesson_sources(material_id);
