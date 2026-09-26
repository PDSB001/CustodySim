-- Execute each statement separately, outside a transaction.
DROP INDEX CONCURRENTLY IF EXISTS public.report_reviews_created_idx;
DROP INDEX CONCURRENTLY IF EXISTS public.checkin_records_user_checkin_idx;
DROP INDEX CONCURRENTLY IF EXISTS public.chat_messages_sender_created_idx;
DROP INDEX CONCURRENTLY IF EXISTS public.chat_messages_conversation_cursor_idx;
DROP INDEX CONCURRENTLY IF EXISTS public.persons_created_id_idx;
