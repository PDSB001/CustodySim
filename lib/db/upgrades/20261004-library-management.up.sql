BEGIN;
ALTER TABLE library_books ADD COLUMN IF NOT EXISTS cover_bytes bytea;
ALTER TABLE library_books ADD COLUMN IF NOT EXISTS cover_mime varchar(40);
ALTER TABLE library_books ADD COLUMN IF NOT EXISTS cover_updated_at timestamptz;
ALTER TABLE library_books ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
COMMIT;
