-- Contract migration: retire timestamp sync, stored conflict copies,
-- plaintext enrollment tokens, and the global WebAuthn challenge slot.

-- Never discard unresolved historical conflict ciphertext silently. Operators
-- must export or drain these records before this migration can proceed.
CREATE TABLE _legacy_conflict_guard (
    valid INTEGER NOT NULL CHECK (valid = 1)
);

INSERT INTO _legacy_conflict_guard(valid)
SELECT CASE WHEN COUNT(*) = 0 THEN 1 ELSE 0 END
FROM note_conflicts;

DROP TABLE _legacy_conflict_guard;

DROP TABLE note_conflicts;
DROP TABLE device_enrollments;

DROP INDEX IF EXISTS idx_notes_user_updated;

ALTER TABLE users DROP COLUMN current_challenge;
