-- Add a strictly increasing per-vault sequence for lossless incremental sync.

ALTER TABLE users ADD COLUMN note_change_seq INTEGER NOT NULL DEFAULT 0;
ALTER TABLE notes ADD COLUMN change_seq INTEGER NOT NULL DEFAULT 0;

WITH ranked AS (
    SELECT
        id,
        ROW_NUMBER() OVER (
            PARTITION BY user_id
            ORDER BY updated_at ASC, id ASC
        ) AS next_change_seq
    FROM notes
)
UPDATE notes
SET change_seq = (
    SELECT next_change_seq
    FROM ranked
    WHERE ranked.id = notes.id
);

UPDATE users
SET note_change_seq = COALESCE(
    (SELECT MAX(change_seq) FROM notes WHERE notes.user_id = users.id),
    0
);

CREATE UNIQUE INDEX idx_notes_user_change_seq
ON notes(user_id, change_seq)
WHERE change_seq > 0;

CREATE INDEX idx_notes_user_change_scan
ON notes(user_id, change_seq);

CREATE TRIGGER notes_assign_change_seq_after_insert
AFTER INSERT ON notes
WHEN NEW.change_seq = 0
BEGIN
    UPDATE users
    SET note_change_seq = note_change_seq + 1
    WHERE id = NEW.user_id;

    UPDATE notes
    SET change_seq = (
        SELECT note_change_seq
        FROM users
        WHERE id = NEW.user_id
    )
    WHERE id = NEW.id;
END;

CREATE TRIGGER notes_assign_change_seq_after_version_update
AFTER UPDATE OF version ON notes
WHEN NEW.version > OLD.version AND NEW.change_seq = OLD.change_seq
BEGIN
    UPDATE users
    SET note_change_seq = note_change_seq + 1
    WHERE id = NEW.user_id;

    UPDATE notes
    SET change_seq = (
        SELECT note_change_seq
        FROM users
        WHERE id = NEW.user_id
    )
    WHERE id = NEW.id;
END;
