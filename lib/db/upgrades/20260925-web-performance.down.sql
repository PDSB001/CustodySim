-- Execute each statement separately, outside a transaction.
DROP INDEX CONCURRENTLY IF EXISTS public.chat_messages_sender_created_idx;
DROP INDEX CONCURRENTLY IF EXISTS public.chat_messages_conversation_cursor_idx;
DROP INDEX CONCURRENTLY IF EXISTS public.persons_created_id_idx;
