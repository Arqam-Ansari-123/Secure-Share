-- SecureShare — named staff accounts, and the database half of the
-- staff/client boundary.
--
-- Runs as the schema OWNER (appuser) from docker-entrypoint-initdb.d, after
-- 002_grants.sql. Additive and idempotent: safe to re-apply by hand with
--   docker compose exec -T postgres psql -U appuser -d secretshare < sql/003_accounts.sql
--
-- The point of this file is that after it runs, the APPLICATION ROLE CANNOT
-- CREATE AN IDENTITY. Not a staff account, not an anonymous sender. An attacker
-- with full remote code execution inside the API container still cannot mint
-- themselves access, because the privilege simply is not granted.

-- ---------------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------------
-- gen_random_uuid() is core in PG13+, so no pgcrypto and no CREATE EXTENSION —
-- which matters because CREATE EXTENSION needs superuser and would tie this
-- file to the initdb path forever.
CREATE TABLE IF NOT EXISTS users (
    id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    email                 TEXT        NOT NULL,
    display_name          TEXT        NOT NULL,
    -- scrypt$<n>$<r>$<p>$<b64 salt>$<b64 dk> — self-describing, so the work
    -- factor can be raised later without a migration.
    pw_hash               TEXT        NOT NULL,

    is_active             BOOLEAN     NOT NULL DEFAULT true,
    is_admin              BOOLEAN     NOT NULL DEFAULT false,
    must_change_password  BOOLEAN     NOT NULL DEFAULT true,

    failed_logins         SMALLINT    NOT NULL DEFAULT 0,
    locked_until          TIMESTAMPTZ,

    pw_changed_at         TIMESTAMPTZ,
    last_login_at         TIMESTAMPTZ,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Normalisation as a database fact rather than an application convention.
    -- Chosen over citext (needs superuser) and over a functional UNIQUE index
    -- on lower(email) (which every query would have to remember to mirror).
    CONSTRAINT users_email_lower_chk CHECK (email = lower(email)),
    CONSTRAINT users_email_shape_chk CHECK (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[a-z]{2,}$'),
    CONSTRAINT users_pw_hash_chk     CHECK (pw_hash LIKE 'scrypt$%'),
    CONSTRAINT users_name_chk        CHECK (length(display_name) BETWEEN 1 AND 120)
);

-- The allowed email DOMAIN is deliberately not a CHECK here — hard-coding
-- genetechsolutions.com into DDL would make adding a second domain a migration.
-- It lives in config.STAFF_EMAIL_DOMAINS and is enforced by manage.py.
CREATE UNIQUE INDEX IF NOT EXISTS users_email_key ON users (email);

-- ---------------------------------------------------------------------------
-- secrets now belong to a named person
-- ---------------------------------------------------------------------------
-- No ON DELETE clause: the default RESTRICT is what we want. Users are
-- deactivated, never deleted, and a secret must never lose its owner.
ALTER TABLE secrets ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id);

-- sender_id held the old anonymous cookie token. Kept for one release because
-- DROP COLUMN is the only irreversible step in an otherwise reversible
-- migration; scheduled for removal in 004_drop_sender.sql.
ALTER TABLE secrets ALTER COLUMN sender_id DROP NOT NULL;
COMMENT ON COLUMN secrets.sender_id IS
    'VESTIGIAL. Pre-Phase-2 anonymous cookie id. No longer written. Retained one '
    'release for forensics on pre-cutover rows; DROP in 004.';

-- user_id must be NOT NULL for the boundary to hold at layer 2 — an INSERT with
-- no authenticated user then fails at the database, not merely at the API. Guard
-- it so a stale volume produces a clear message instead of a constraint error.
DO $$
DECLARE legacy BIGINT;
BEGIN
    SELECT count(*) INTO legacy FROM secrets WHERE user_id IS NULL;
    IF legacy = 0 THEN
        ALTER TABLE secrets ALTER COLUMN user_id SET NOT NULL;
    ELSE
        RAISE EXCEPTION
            'secrets.user_id cannot be SET NOT NULL: % pre-Phase-2 anonymous row(s) remain. '
            'These are throwaway test rows — run "docker compose down -v" and start clean, '
            'or backfill user_id before re-applying this file.', legacy;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS secrets_user_created_idx ON secrets (user_id, created_at DESC);
DROP INDEX IF EXISTS secrets_sender_created_idx;

-- ---------------------------------------------------------------------------
-- audit trail records WHO acted
-- ---------------------------------------------------------------------------
-- No foreign key on actor_user_id, for the same reason 001_schema.sql gives for
-- tid: removing a row elsewhere must never cascade away the audit trail.
ALTER TABLE audit.events ADD COLUMN IF NOT EXISTS actor_user_id UUID;

-- Denormalised on purpose. An append-only trail must be readable without
-- joining a mutable table, and the address AT THE TIME OF THE ACTION is itself
-- the fact being recorded — a join to users would silently rewrite history when
-- somebody's email changes.
ALTER TABLE audit.events ADD COLUMN IF NOT EXISTS actor_email TEXT;

-- Account events (login, logout, password change) belong to no secret.
ALTER TABLE audit.events ALTER COLUMN tid DROP NOT NULL;

CREATE INDEX IF NOT EXISTS audit_events_actor_idx ON audit.events (actor_user_id, at DESC);

-- ---------------------------------------------------------------------------
-- privileges — layer 2 of the boundary
-- ---------------------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO app_rw;
GRANT SELECT ON public.users TO app_rw;

-- Column-level UPDATE. The application may record a login and rotate a
-- password. It can NEVER create an account, re-activate one, or grant itself
-- is_admin — those columns are simply not writable by this role.
GRANT UPDATE (pw_hash, must_change_password, failed_logins,
              locked_until, last_login_at, pw_changed_at)
      ON public.users TO app_rw;

REVOKE INSERT, DELETE, TRUNCATE ON public.users FROM app_rw;
REVOKE ALL ON public.users FROM PUBLIC;

-- Kill the anonymous-identity path at the database, not just in code.
REVOKE INSERT, UPDATE ON public.senders FROM app_rw;

-- DELETE on secrets was granted in 002 and is never used: revocation of a
-- secret sets status and drops the Redis blob; the metadata row must survive
-- so the dashboard and audit trail still resolve.
REVOKE DELETE ON public.secrets FROM app_rw;

-- audit.events deliberately gets NO new grant. The table-level
-- "GRANT SELECT, INSERT" from 002_grants.sql automatically covers columns added
-- above. Do not re-grant here, and never write GRANT ALL — that would hand back
-- UPDATE and DELETE and quietly undo the append-only design.
