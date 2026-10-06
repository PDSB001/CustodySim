BEGIN;
SET LOCAL lock_timeout = '5s';
SELECT pg_advisory_xact_lock(hashtext('custodysim:20261006:isolation-schedule'));

ALTER TABLE public.isolation_settings
  ALTER COLUMN schedule_time SET DEFAULT '00:00',
  ALTER COLUMN timeout_minutes SET DEFAULT 1380;

-- Keep the original configuration and affected task times for recovery.
-- The backup also marks this one-time change: later deployments preserve
-- any schedule explicitly saved by an administrator after this upgrade.
CREATE SCHEMA IF NOT EXISTS custodysim_backup_isolation_20261006;
DO $$
BEGIN
  IF to_regclass('custodysim_backup_isolation_20261006.settings') IS NOT NULL THEN
    RETURN;
  END IF;

  LOCK TABLE public.isolation_settings, public.report_tasks IN SHARE ROW EXCLUSIVE MODE;
  CREATE TABLE custodysim_backup_isolation_20261006.settings AS
    SELECT * FROM public.isolation_settings WHERE id = 'default';
  CREATE TABLE custodysim_backup_isolation_20261006.tasks AS
    SELECT id, schedule_at, deadline, updated_at
    FROM public.report_tasks
    WHERE source = 'ISOLATION'
      AND status IN ('PENDING', 'RETURNED')
      AND (schedule_at AT TIME ZONE 'Asia/Shanghai')::date =
          (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai')::date;

  INSERT INTO public.isolation_settings (id, schedule_time, timeout_minutes)
    VALUES ('default', '00:00', 1380)
    ON CONFLICT (id) DO UPDATE
      SET schedule_time = EXCLUDED.schedule_time,
          timeout_minutes = EXCLUDED.timeout_minutes,
          updated_at = CURRENT_TIMESTAMP;

  UPDATE public.report_tasks task
    SET schedule_at = date_trunc('day', task.schedule_at AT TIME ZONE 'Asia/Shanghai')
                       AT TIME ZONE 'Asia/Shanghai',
        deadline = (date_trunc('day', task.schedule_at AT TIME ZONE 'Asia/Shanghai')
                    + INTERVAL '23 hours') AT TIME ZONE 'Asia/Shanghai',
        updated_at = CURRENT_TIMESTAMP
    FROM custodysim_backup_isolation_20261006.tasks backup
    WHERE task.id = backup.id;
END $$;
COMMIT;
