BEGIN;
ALTER TABLE library_books ADD COLUMN IF NOT EXISTS reader_text text;
ALTER TABLE rules ADD COLUMN IF NOT EXISTS reading_minutes integer NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS library_score_settings (
  id integer PRIMARY KEY DEFAULT 1, enabled boolean NOT NULL DEFAULT true,
  minutes_per_point integer NOT NULL DEFAULT 15, daily_cap integer NOT NULL DEFAULT 2
);
INSERT INTO library_score_settings(id, enabled, minutes_per_point, daily_cap)
  VALUES (1, true, 15, 2) ON CONFLICT DO NOTHING;
COMMIT;
