-- Add a high-entropy second factor for pairing sessions.
-- This mitigates 6-digit code guessing / session hijacking / status probing.

ALTER TABLE handshakes ADD COLUMN session_secret_hash TEXT;

CREATE INDEX IF NOT EXISTS idx_handshakes_secret_hash ON handshakes(session_secret_hash);

