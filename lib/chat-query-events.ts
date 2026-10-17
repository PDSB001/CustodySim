import type { InfiniteData, QueryClient } from "@tanstack/react-query"

export function invalidateChatEvent(
  client: QueryClient,
  event: { conversationId?: string; type?: string },
) {
  void client.invalidateQueries({ queryKey: ["chat-conversations"] })
  if (!event.conversationId) return
  if (event.type === "message.created") {
    const history = client.getQueryData<InfiniteData<unknown[]>>([
      "chat-messages",
      event.conversationId,
    ])
    // Empty conversations have no enabled tail query or polling fallback.
    if (!history?.pages.some((page) => page.length > 0))
      void client.invalidateQueries({
        queryKey: ["chat-messages", event.conversationId],
      })
    void client.invalidateQueries({
      queryKey: ["chat-tail", event.conversationId],
    })
  } else {
    void client.invalidateQueries({
      queryKey: ["chat-messages", event.conversationId],
    })
  }
}
