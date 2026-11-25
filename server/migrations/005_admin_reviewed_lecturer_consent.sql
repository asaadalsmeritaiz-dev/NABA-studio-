ALTER TABLE lecturers
ADD COLUMN consent_approved_by TEXT REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE lecturers
ADD COLUMN consent_approved_at TEXT;

UPDATE lecturers
SET consent_verified = 0
WHERE is_custom = 1;
