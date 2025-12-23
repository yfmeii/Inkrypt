-- Inkrypt D1 schema (v1)

CREATE TABLE users (
    id TEXT PRIMARY KEY,        -- UUID v4
    username TEXT UNIQUE,       -- 用户名（用于公开索引）
    current_challenge TEXT,     -- 暂存当前的 WebAuthn Challenge（防止重放）
    created_at INTEGER NOT NULL
);

CREATE TABLE credentials (
    id TEXT PRIMARY KEY,         -- WebAuthn Credential ID (Base64URL)
    user_id TEXT NOT NULL,
    public_key TEXT NOT NULL,    -- 公钥 (COSE Key 格式)
    device_name TEXT,            -- 用户可读名称 (如 "iPhone 15")
    counter INTEGER DEFAULT 0,   -- WebAuthn 计数器

    -- 【加密核心字段】
    prf_salt TEXT NOT NULL,      -- 只有该设备使用的随机盐 (用于 PRF 输入)
    wrapped_master_key TEXT NOT NULL, -- 使用 KEK 加密后的 Master Key (Base64)
    encryption_iv TEXT NOT NULL, -- 加密 wrapped_master_key 时用的 IV

    last_used_at INTEGER,
    created_at INTEGER,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE notes (
    id TEXT PRIMARY KEY,         -- UUID v4
    user_id TEXT NOT NULL,
    version INTEGER DEFAULT 1,   -- 乐观锁版本号
    updated_at INTEGER NOT NULL,
    is_deleted BOOLEAN DEFAULT 0,-- 软删除标记

    -- 【加密载荷】
    -- 内容：Base64( AES-GCM( GZIP( JSON_String ) ) )
    encrypted_data TEXT NOT NULL,
    data_iv TEXT NOT NULL,       -- 用于解密 encrypted_data 的 IV

    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 索引优化：用于增量同步
CREATE INDEX idx_notes_user_updated ON notes(user_id, updated_at);

CREATE TABLE note_conflicts (
    id TEXT PRIMARY KEY,
    note_id TEXT NOT NULL,
    user_id TEXT NOT NULL,

    encrypted_data TEXT NOT NULL, -- 冲突版本的密文
    data_iv TEXT NOT NULL,
    device_name TEXT,             -- 哪个设备产生了冲突
    created_at INTEGER,

    FOREIGN KEY(note_id) REFERENCES notes(id) ON DELETE CASCADE
);
