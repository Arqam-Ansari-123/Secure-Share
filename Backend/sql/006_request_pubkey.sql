-- SecureShare — pin each request to the public key it was issued with.
--
-- Idempotent. Applies on a fresh volume via docker-entrypoint-initdb.d, or by
-- hand against a running database:
--   docker compose exec -T postgres psql -U appuser -d secretshare < sql/006_request_pubkey.sql
--
-- Why this exists
-- ---------------
-- The client encrypts to the requesting employee's public key, which was read
-- from `users.pubkey` at the moment they opened the link. But that column can
-- change afterwards — an admin password reset rotates the keypair, and so does
-- any re-publish. When it does, a reply already in flight was encrypted to a
-- key the employee no longer holds.
--
-- Nothing detected that. Retrieval is a GETDEL, so the ciphertext was destroyed
-- BEFORE decryption was attempted, and a mismatch meant the credential was gone
-- and unreadable in the same click.
--
-- Recording the key on the request makes the mismatch detectable, so the app can
-- refuse to consume a reply it cannot read.
ALTER TABLE secret_requests ADD COLUMN IF NOT EXISTS pubkey BYTEA;

COMMENT ON COLUMN secret_requests.pubkey IS
    'Snapshot of users.pubkey when this request was created. The client encrypts '
    'to THIS key, and it is compared against the employee''s current key before a '
    'reply is destroyed. NULL for requests created before this migration.';
