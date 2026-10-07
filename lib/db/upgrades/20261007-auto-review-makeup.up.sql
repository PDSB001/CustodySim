BEGIN;
SET LOCAL lock_timeout = '5s';
SELECT pg_advisory_xact_lock(hashtext('custodysim:20261007:auto-review-makeup'));

CREATE TABLE IF NOT EXISTS public.auto_review_settings (
  id varchar(20) PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT false,
  actor_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  template_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  revision uuid NOT NULL DEFAULT gen_random_uuid(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  makeup_enabled boolean NOT NULL DEFAULT false,
  provider varchar(20) NOT NULL DEFAULT 'bigmodel'
);

ALTER TABLE public.auto_review_settings
  ADD COLUMN IF NOT EXISTS makeup_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS provider varchar(20) NOT NULL DEFAULT 'bigmodel';

CREATE SCHEMA IF NOT EXISTS custodysim_backup_auto_review_20261007;
CREATE TABLE IF NOT EXISTS custodysim_backup_auto_review_20261007.settings AS
  SELECT * FROM public.auto_review_settings;

CREATE TABLE IF NOT EXISTS public.auto_review_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id uuid NOT NULL REFERENCES public.report_submissions(id) ON DELETE CASCADE,
  input_version text NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'PROCESSING',
  result varchar(20),
  reason text,
  model varchar(80) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS auto_review_runs_submission_version_unique
  ON public.auto_review_runs (submission_id, input_version);

CREATE TABLE IF NOT EXISTS public.auto_review_makeup_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  makeup_id uuid NOT NULL REFERENCES public.checkin_makeups(id) ON DELETE CASCADE,
  input_version text NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'PROCESSING',
  result varchar(20),
  reason text,
  model varchar(80) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS auto_review_makeup_runs_input_unique
  ON public.auto_review_makeup_runs (makeup_id, input_version);

COMMIT;
