-- SecureShare — drop file-attachment support, and the vestigial anonymous
-- sender column that 003 deferred.
--
-- Idempotent, like every file here. Applies automatically on a fresh volume via
-- docker-entrypoint-initdb.d, or by hand against a running database:
--   docker compose exec -T postgres psql -U appuser -d secretshare < sql/004_drop_file_support.sql

-- ---------------------------------------------------------------------------
-- 1. file attachments
-- ---------------------------------------------------------------------------
-- The product no longer accepts attachments: the create form has no file input,
-- and the encrypted envelope no longer carries a file segment. Nothing reads
-- this column any more.
--
-- Note this drops metadata only. Attachment CONTENT was never stored here — it
-- lived inside the AES-GCM envelope in Redis, which the server could not read
-- and which expires on its own.
ALTER TABLE secrets DROP COLUMN IF EXISTS has_file;

-- ---------------------------------------------------------------------------
-- 2. the pre-Phase-2 anonymous sender id
-- ---------------------------------------------------------------------------
-- 003_accounts.sql replaced this with user_id (a real FK to users) and marked
-- the column VESTIGIAL, retained one release so pre-cutover rows stayed
-- readable for forensics. That release has passed and nothing writes it.
ALTER TABLE secrets DROP COLUMN IF EXISTS sender_id;

-- The `senders` TABLE deliberately stays. It is empty and unwritten (003 revoked
-- app_rw's INSERT and UPDATE on it), but verify_boundary.py asserts that the
-- application still cannot insert into it — proof that the anonymous-identity
-- path is closed. Dropping the table would turn that check into "relation does
-- not exist", which is a weaker statement than "permission denied".
