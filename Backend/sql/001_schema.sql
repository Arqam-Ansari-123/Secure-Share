-- SecureShare — schema. Single source of truth for the database.
-- Genetech Solutions.
--
-- Applied two ways from this one file, so the two can never drift:
--   1. docker-compose mounts ./sql into /docker-entrypoint-initdb.d (runs on an empty volume)
--   2. the backend lifespan runs db.run_sql_dir("sql") on every startup
-- Every statement is idempotent, so applying it twice is a no-op.
--
-- NOTE: secret CONTENT is never stored here. Ciphertext lives only in Redis.
--       Postgres holds metadata + the audit trail and nothing else.

-- ---------------------------------------------------------------------------
-- senders — anonymous sender identities (no email, no password)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS senders (
    sender_id   TEXT PRIMARY KEY,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- secrets — metadata only. tid = sha256(link token); the token itself is
-- never stored, so a database dump yields no working links.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS secrets (
    tid              TEXT        PRIMARY KEY,
    sender_id        TEXT        NOT NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at       TIMESTAMPTZ NOT NULL,

    -- active | viewed | expired | revoked | destroyed
    status           TEXT        NOT NULL DEFAULT 'active',
    status_at        TIMESTAMPTZ,
    -- viewed | time_expired | revoked | attempts_exceeded
    status_reason    TEXT,

    -- zero-knowledge passphrase material. verifier_hash = sha256(verifier);
    -- the encryption key is derived from the same passphrase client-side under a
    -- different HKDF info string and never reaches this database.
    has_passphrase   BOOLEAN     NOT NULL DEFAULT false,
    kdf_salt         BYTEA,
    kdf_iters        INTEGER,
    verifier_hash    BYTEA,

    max_attempts     SMALLINT    NOT NULL DEFAULT 5,
    failed_attempts  SMALLINT    NOT NULL DEFAULT 0,

    has_file         BOOLEAN     NOT NULL DEFAULT false,
    size_bytes       INTEGER     NOT NULL DEFAULT 0,

    -- optional sender-facing nickname. PLAINTEXT — the UI warns about this.
    label            TEXT,

    webhook_url      TEXT,
    notify_email     TEXT,

    CONSTRAINT secrets_status_chk
        CHECK (status IN ('active','viewed','expired','revoked','destroyed'))
);

CREATE INDEX IF NOT EXISTS secrets_sender_created_idx
    ON secrets (sender_id, created_at DESC);
CREATE INDEX IF NOT EXISTS secrets_sweeper_idx
    ON secrets (status, expires_at);

-- ---------------------------------------------------------------------------
-- audit.events — the tracing log, in its OWN SCHEMA so "stored separately from
-- secret data" is a structural fact rather than a convention.
--
-- Deliberately NO foreign key on tid: purging a secret row must never cascade
-- away its audit trail.
-- ---------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS audit;

CREATE TABLE IF NOT EXISTS audit.events (
    id          BIGSERIAL   PRIMARY KEY,
    tid         TEXT        NOT NULL,
    sender_id   TEXT,
    -- created | peeked | reveal_ok | reveal_fail | revoked | expired
    -- | destroyed | notified
    event       TEXT        NOT NULL,
    ok          BOOLEAN     NOT NULL DEFAULT true,
    at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    ip          INET,
    user_agent  TEXT,
    -- allowlisted keys only; never request data splatted in
    detail      JSONB
);

CREATE INDEX IF NOT EXISTS audit_events_tid_idx    ON audit.events (tid, at);
CREATE INDEX IF NOT EXISTS audit_events_sender_idx ON audit.events (sender_id, at DESC);
