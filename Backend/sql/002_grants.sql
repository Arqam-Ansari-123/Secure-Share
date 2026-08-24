-- SecureShare — least privilege + an append-only audit trail.
--
-- Runs as the schema OWNER (appuser). The application connects as app_rw, which
-- owns nothing. Two mechanisms, because either one alone is insufficient:
--
--   1. A non-owning role. This matters because REVOKE does NOT bind a table's
--      OWNER — revoking from appuser (who owns these tables) would accomplish
--      nothing at all.
--
--   2. A BEFORE UPDATE/DELETE trigger, which DOES bind the owner. Backstop for
--      the case where someone points DATABASE_URL at appuser by mistake.
--
-- Net effect: the application can append and read audit rows but cannot rewrite
-- or erase one, even if the application itself is fully compromised.
--
-- Role app_rw is created by 000_roles.sh (it needs a password from the env).
-- Idempotent: safe to re-apply.

-- ---------------------------------------------------------------------------
-- 1. least privilege
-- ---------------------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO app_rw;
GRANT USAGE ON SCHEMA audit  TO app_rw;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.secrets TO app_rw;
GRANT SELECT, INSERT, UPDATE         ON public.senders TO app_rw;

-- the whole point: SELECT and INSERT only. No UPDATE. No DELETE.
GRANT SELECT, INSERT ON audit.events                 TO app_rw;
GRANT USAGE          ON SEQUENCE audit.events_id_seq TO app_rw;

-- and make sure nothing grants them back by default
REVOKE UPDATE, DELETE, TRUNCATE ON audit.events FROM app_rw;
REVOKE ALL ON audit.events FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 2. append-only trigger (binds the owner too)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit.no_mutate() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'audit.events is append-only (attempted %)', TG_OP;
END $$;

DROP TRIGGER IF EXISTS events_append_only ON audit.events;
CREATE TRIGGER events_append_only
    BEFORE UPDATE OR DELETE ON audit.events
    FOR EACH ROW EXECUTE FUNCTION audit.no_mutate();
