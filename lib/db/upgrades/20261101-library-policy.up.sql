BEGIN;
-- Change the insertion default only. Preserve any rule explicitly saved by an administrator.
ALTER TABLE library_score_settings ALTER COLUMN daily_cap SET DEFAULT 2;
COMMIT;
