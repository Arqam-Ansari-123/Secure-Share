-- SecureShare — credential requests (the inbound direction) and the employee
-- keypairs that make them readable.
--
-- Idempotent. Applies on a fresh volume via docker-entrypoint-initdb.d, or by
-- hand against a running database:
--   docker compose exec -T postgres psql -U appuser -d secretshare < sql/005_requests.sql
--
-- Until now SecureShare was one-way: staff send secrets out. This adds the
-- reverse — an employee issues a request link, a client opens it and submits
-- their credential. The request link IS the authorization, which is what lets
-- clients send us secrets without giving them access to /create.

-- ---------------------------------------------------------------------------
-- 1. employee keypairs
-- ---------------------------------------------------------------------------
-- A client encrypts to the employee's PUBLIC key, so only that employee can
-- read the reply.
--
-- The private key is stored here WRAPPED — encrypted client-side with a key
-- derived from the employee's password, which the server never sees. So this
-- column holds a blob the server cannot use. Storing the raw private key would
-- let the server decrypt every credential a client ever submits, which would
-- discard the zero-knowledge property that the rest of the design is built on.
--
-- Consequence to keep in mind: `manage.py resetpw` cannot re-wrap (there is no
-- old password to unwrap with), so an admin password reset makes any pending
-- request unreadable. The CLI says so at the point of use.
ALTER TABLE users ADD COLUMN IF NOT EXISTS pubkey          BYTEA;
ALTER TABLE users ADD COLUMN IF NOT EXISTS privkey_wrapped BYTEA;
ALTER TABLE users ADD COLUMN IF NOT EXISTS privkey_salt    BYTEA;
ALTER TABLE users ADD COLUMN IF NOT EXISTS privkey_iters   INTEGER;

COMMENT ON COLUMN users.privkey_wrapped IS
    'X25519 private key, AES-GCM encrypted under PBKDF2(password, privkey_salt). '
    'The server has no key for this and cannot unwrap it.';

-- ---------------------------------------------------------------------------
-- 2. the requests themselves
-- ---------------------------------------------------------------------------
-- rid = sha256(request token), mirroring secrets.tid. The token itself is never
-- stored, so a database dump yields no working request links.
CREATE TABLE IF NOT EXISTS secret_requests (
    rid           TEXT        PRIMARY KEY,
    user_id       UUID        NOT NULL REFERENCES users(id),
    label         TEXT,
    -- Who we sent it to, for the employee's own memory. PLAINTEXT, like
    -- secrets.label — the UI warns.
    client_hint   TEXT,

    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at    TIMESTAMPTZ NOT NULL,

    -- open | fulfilled | expired | revoked
    status        TEXT        NOT NULL DEFAULT 'open',
    status_at     TIMESTAMPTZ,

    -- the secrets row the client's submission created; NULL until fulfilled.
    -- Deliberately no FK: the secret is destroyed on read and its row may be
    -- purged, but the request's history should survive that.
    fulfilled_tid TEXT,

    CONSTRAINT secret_requests_status_chk
        CHECK (status IN ('open', 'fulfilled', 'expired', 'revoked'))
);

CREATE INDEX IF NOT EXISTS secret_requests_user_idx
    ON secret_requests (user_id, created_at DESC);
-- for the expiry sweeper
CREATE INDEX IF NOT EXISTS secret_requests_sweep_idx
    ON secret_requests (status, expires_at);

-- ---------------------------------------------------------------------------
-- 3. privileges
-- ---------------------------------------------------------------------------
-- 003_accounts.sql grants UPDATE on `users` COLUMN BY COLUMN, precisely so the
-- application cannot touch is_admin or is_active. New columns are therefore not
-- writable until named here.
GRANT UPDATE (pubkey, privkey_wrapped, privkey_salt, privkey_iters)
      ON public.users TO app_rw;

-- No DELETE: a request reaches a terminal status, it is never removed.
GRANT SELECT, INSERT, UPDATE ON public.secret_requests TO app_rw;
REVOKE DELETE, TRUNCATE ON public.secret_requests FROM app_rw;
REVOKE ALL ON public.secret_requests FROM PUBLIC;
