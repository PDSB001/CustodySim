BEGIN;
-- Stored content identity: same SHA-256 prefix as the existing reader protocol.
-- Existing rows are populated by PostgreSQL; inserts/file replacements recompute it.
-- Uses built-in sha256(bytea), not the optional pgcrypto extension.
ALTER TABLE library_books ADD COLUMN IF NOT EXISTS content_revision varchar(24)
  GENERATED ALWAYS AS (
    substr(encode(sha256(decode('7265616465722d736368656d612d333a', 'hex') || bytes), 'hex'), 1, 24)
  ) STORED NOT NULL;
COMMIT;
