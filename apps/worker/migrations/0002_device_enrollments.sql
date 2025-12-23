-- One-time device enrollment tokens (optional, for secure recovery onboarding)
CREATE TABLE device_enrollments (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_device_enrollments_user ON device_enrollments(user_id);

