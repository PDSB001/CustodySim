CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX CONCURRENTLY IF NOT EXISTS audit_logs_created_id_idx
  ON public.audit_logs (created_at DESC NULLS FIRST, id DESC NULLS FIRST);
CREATE INDEX CONCURRENTLY IF NOT EXISTS audit_logs_search_trgm_idx
  ON public.audit_logs USING gin
  ((actor_name || ' ' || action_label || ' ' || action || ' ' || entity_type || ' ' || coalesce(entity_id::text, '') || ' ' || id::text) gin_trgm_ops);
