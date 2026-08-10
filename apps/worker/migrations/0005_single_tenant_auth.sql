-- Expand the existing single-user schema into explicit single-tenant auth state.
-- This migration is additive so the previous Worker can still run during rollout.

CREATE TABLE _single_tenant_guard (
    valid INTEGER NOT NULL CHECK (valid = 1)
);

INSERT INTO _single_tenant_guard(valid)
SELECT CASE WHEN COUNT(*) <= 1 THEN 1 ELSE 0 END
FROM users;

DROP TABLE _single_tenant_guard;

ALTER TABLE users ADD COLUMN tenant_key TEXT NOT NULL DEFAULT 'default';
CREATE UNIQUE INDEX idx_users_single_tenant ON users(tenant_key);

ALTER TABLE credentials ADD COLUMN revoked_at INTEGER;
ALTER TABLE credentials ADD COLUMN updated_at INTEGER;
ALTER TABLE credentials ADD COLUMN created_by_ceremony_id TEXT;
ALTER TABLE credentials ADD COLUMN last_auth_ceremony_id TEXT;

UPDATE credentials
SET updated_at = COALESCE(last_used_at, created_at, 0)
WHERE updated_at IS NULL;

CREATE UNIQUE INDEX idx_credentials_created_by_ceremony
ON credentials(created_by_ceremony_id)
WHERE created_by_ceremony_id IS NOT NULL;

CREATE INDEX idx_credentials_last_auth_ceremony
ON credentials(last_auth_ceremony_id)
WHERE last_auth_ceremony_id IS NOT NULL;

CREATE INDEX idx_credentials_active
ON credentials(user_id, last_used_at DESC)
WHERE revoked_at IS NULL;

CREATE TABLE auth_ceremonies (
    id TEXT PRIMARY KEY,
    vault_id TEXT NOT NULL,
    purpose TEXT NOT NULL CHECK (purpose IN ('vault_create', 'login', 'device_add')),
    challenge TEXT NOT NULL UNIQUE,
    preferred_credential_id TEXT,
    device_grant_id TEXT,
    client_request_id TEXT,
    response_hash TEXT,
    state TEXT NOT NULL DEFAULT 'pending'
        CHECK (state IN ('pending', 'verifying', 'succeeded', 'failed', 'expired', 'cancelled')),
    result_credential_id TEXT,
    failure_code TEXT,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    claimed_at INTEGER,
    completed_at INTEGER,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY(vault_id) REFERENCES users(id) ON DELETE CASCADE,
    CHECK (expires_at > created_at)
);

CREATE UNIQUE INDEX idx_auth_ceremonies_idempotency
ON auth_ceremonies(vault_id, purpose, client_request_id)
WHERE client_request_id IS NOT NULL;

CREATE INDEX idx_auth_ceremonies_active
ON auth_ceremonies(state, expires_at);

CREATE TABLE device_grants (
    id TEXT PRIMARY KEY,
    vault_id TEXT NOT NULL,
    source TEXT NOT NULL CHECK (source IN ('pairing', 'enrollment', 'authenticated')),
    secret_hash TEXT NOT NULL UNIQUE,
    state TEXT NOT NULL CHECK (state IN ('pending', 'ready', 'consuming', 'consumed', 'revoked', 'expired')),
    issued_by_credential_id TEXT,
    consuming_ceremony_id TEXT,
    consumed_by_credential_id TEXT,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    ready_at INTEGER,
    consumed_at INTEGER,
    revoked_at INTEGER,
    updated_at INTEGER NOT NULL,
    version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
    FOREIGN KEY(vault_id) REFERENCES users(id) ON DELETE CASCADE,
    CHECK (expires_at > created_at)
);

CREATE INDEX idx_device_grants_active
ON device_grants(state, expires_at);

ALTER TABLE handshakes ADD COLUMN state TEXT NOT NULL DEFAULT 'waiting_join';
ALTER TABLE handshakes ADD COLUMN device_grant_id TEXT;
ALTER TABLE handshakes ADD COLUMN protocol_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE handshakes ADD COLUMN version INTEGER NOT NULL DEFAULT 0;

UPDATE handshakes
SET state = CASE
    WHEN bob_public_key IS NULL THEN 'waiting_join'
    WHEN encrypted_payload IS NULL OR payload_iv IS NULL THEN 'waiting_confirm'
    ELSE 'ready'
END;

CREATE UNIQUE INDEX idx_handshakes_device_grant
ON handshakes(device_grant_id)
WHERE device_grant_id IS NOT NULL;
