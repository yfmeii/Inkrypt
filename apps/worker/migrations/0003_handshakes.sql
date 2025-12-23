-- Ephemeral device pairing handshakes (ECDH-SAS)
CREATE TABLE handshakes (
    session_code TEXT PRIMARY KEY, -- 6-digit short code like "829401"

    -- Bind the handshake to a vault/user (single-user deployments still benefit from this)
    user_id TEXT NOT NULL,

    -- Ephemeral ECDH public keys (JWK JSON string)
    alice_public_key TEXT NOT NULL,
    bob_public_key TEXT,

    -- Encrypted payload (Alice -> Bob): Master Key wrapped with a transport key derived from ECDH
    encrypted_payload TEXT,
    payload_iv TEXT,

    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,

    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_handshakes_user ON handshakes(user_id);
