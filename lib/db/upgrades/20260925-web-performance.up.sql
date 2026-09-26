-- Execute each statement separately, outside a transaction.
CREATE INDEX CONCURRENTLY IF NOT EXISTS persons_created_id_idx
  ON public.persons USING btree (created_at, id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS chat_messages_conversation_cursor_idx
  ON public.chat_messages USING btree (conversation_id, created_at DESC, id DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS chat_messages_sender_created_idx
  ON public.chat_messages USING btree (sender_id, created_at);
