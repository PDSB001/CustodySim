BEGIN;
ALTER TABLE report_templates ADD COLUMN IF NOT EXISTS reading_minutes integer NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS library_books (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), title varchar(200) NOT NULL,
  author varchar(200) NOT NULL DEFAULT '', format varchar(10) NOT NULL,
  filename text NOT NULL, bytes bytea NOT NULL, enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS reading_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  book_id uuid NOT NULL REFERENCES library_books(id), last_heartbeat timestamptz NOT NULL DEFAULT now(),
  active boolean NOT NULL DEFAULT true, closed boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS reading_sessions_user_idx ON reading_sessions(user_id);
CREATE TABLE IF NOT EXISTS reading_ticks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), session_id uuid NOT NULL REFERENCES reading_sessions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, book_id uuid NOT NULL REFERENCES library_books(id),
  started_at timestamptz NOT NULL, ended_at timestamptz NOT NULL, seconds integer NOT NULL
);
CREATE INDEX IF NOT EXISTS reading_ticks_user_time_idx ON reading_ticks(user_id, ended_at);
CREATE TABLE IF NOT EXISTS reading_progress (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, book_id uuid NOT NULL REFERENCES library_books(id),
  page integer NOT NULL DEFAULT 1, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS reading_progress_user_book_idx ON reading_progress(user_id, book_id);
COMMIT;
