-- SecureShare — Active Directory authentication.
--
-- Idempotent. Applies on a fresh volume via docker-entrypoint-initdb.d, or by
-- hand against a running database:
--   docker compose exec -T postgres psql -U appuser -d secretshare < sql/007_ad_auth.sql
--
-- Staff authenticate against the domain instead of a local password. Two things
-- have to give: an AD user has no local password hash, and the application has
-- no INSERT privilege on `users` — deliberately, so that remote code execution
-- inside the API container still cannot mint an account.

-- ---------------------------------------------------------------------------
-- 1. where an account's password lives
-- ---------------------------------------------------------------------------
ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_source TEXT NOT NULL DEFAULT 'local';
-- userPrincipalName. This forest has `mail` empty on every account, so the UPN
-- is the only usable identity string.
ALTER TABLE users ADD COLUMN IF NOT EXISTS ad_upn      TEXT;
-- objectGUID: stable across renames, email changes and OU moves, which `email`
-- is not. This is the real identity; email is a label.
ALTER TABLE users ADD COLUMN IF NOT EXISTS ad_guid     TEXT;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_auth_source_chk') THEN
        ALTER TABLE users ADD CONSTRAINT users_auth_source_chk
            CHECK (auth_source IN ('local', 'ad'));
    END IF;
END $$;

-- An AD user has no local hash. Relax NOT NULL, but keep the format check for
-- LOCAL accounts — a local user with a NULL or malformed hash would be an
-- account nobody could authenticate as, and nobody would notice.
ALTER TABLE users ALTER COLUMN pw_hash DROP NOT NULL;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_pw_hash_chk;
ALTER TABLE users ADD CONSTRAINT users_pw_hash_chk CHECK (
       (auth_source = 'local' AND pw_hash LIKE 'scrypt$%')
    OR (auth_source = 'ad'    AND pw_hash IS NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS users_ad_guid_key ON users (ad_guid) WHERE ad_guid IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. provisioning, without giving the application INSERT
-- ---------------------------------------------------------------------------
-- 003_accounts.sql revokes INSERT on `users` from app_rw and verify_boundary.py
-- asserts it stays revoked. Granting it back for just-in-time provisioning
-- would discard the property that revocation encodes.
--
-- Instead: one narrow SECURITY DEFINER function, owned by the schema owner. It
-- runs with the owner's rights but can only do exactly one thing — create an
-- ordinary, non-admin, AD-sourced user. The privileged fields are hard-coded
-- rather than parameters, so there is no argument the caller can pass to become
-- an administrator or to set a local password.
CREATE OR REPLACE FUNCTION public.provision_ad_user(
    p_email        TEXT,
    p_display_name TEXT,
    p_upn          TEXT,
    p_guid         TEXT
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
-- Never omit on a SECURITY DEFINER function: without a pinned search_path the
-- caller can put a malicious `users` table earlier in the path and have it
-- written by the owner's privileges.
SET search_path = public, pg_temp
AS $$
DECLARE
    v_id uuid;
BEGIN
    IF p_guid IS NULL OR length(p_guid) < 8 THEN
        RAISE EXCEPTION 'provision_ad_user: a directory GUID is required';
    END IF;

    -- Match on GUID first: it survives a rename, where the email does not.
    SELECT id INTO v_id FROM users WHERE ad_guid = p_guid;
    IF v_id IS NOT NULL THEN
        RETURN v_id;
    END IF;

    -- An existing LOCAL account with the same address is not silently taken
    -- over — that would let anyone who can create a matching AD account inherit
    -- a local admin's identity.
    SELECT id INTO v_id FROM users WHERE email = lower(p_email);
    IF v_id IS NOT NULL THEN
        RAISE EXCEPTION 'provision_ad_user: % already exists with a different source', p_email;
    END IF;

    INSERT INTO users (email, display_name, pw_hash, auth_source, ad_upn, ad_guid,
                       is_active, is_admin, must_change_password)
    VALUES (lower(p_email), p_display_name, NULL, 'ad', p_upn, p_guid,
            true,            -- active
            false,           -- NEVER an admin: promotion stays an operator action
            false)           -- no local password to rotate
    RETURNING id INTO v_id;

    RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public.provision_ad_user(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.provision_ad_user(TEXT, TEXT, TEXT, TEXT) TO app_rw;

-- ---------------------------------------------------------------------------
-- 3. privileges
-- ---------------------------------------------------------------------------
-- 003 grants UPDATE on `users` column by column, precisely so the application
-- cannot touch is_admin or is_active. New columns are unwritable until named.
--
-- display_name joins the list because Active Directory is now the authority for
-- it: a user who is renamed in AD should be renamed here at their next sign-in,
-- and the audit trail should show the current name. It is a label, not a
-- privilege — is_admin and is_active remain firmly out of reach.
GRANT UPDATE (auth_source, ad_upn, ad_guid, display_name) ON public.users TO app_rw;

-- Unchanged and load-bearing: app_rw still has no INSERT, no DELETE, and no
-- UPDATE on is_admin or is_active. The function above is the only door, and it
-- opens one way.
