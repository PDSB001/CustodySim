import { QueryClient } from "@tanstack/react-query"
import { expect, test } from "vitest"
import { invalidateChatEvent } from "@/lib/chat-query-events"

test.each([{ messages: [] }, { messages: [{ id: "message" }] }])(
  "new messages fetch empty history but preserve populated history: %j",
  ({ messages }) => {
    const client = new QueryClient()
    const history = ["chat-messages", "conversation"]
    const tail = ["chat-tail", "conversation", "cursor"]
    client.setQueryData(history, { pages: [messages], pageParams: [null] })
    client.setQueryData(tail, [])
    invalidateChatEvent(client, {
      type: "message.created",
      conversationId: "conversation",
    })
    expect(client.getQueryState(history)?.isInvalidated).toBe(
      messages.length === 0,
    )
    expect(client.getQueryState(tail)?.isInvalidated).toBe(true)
    client.clear()
  },
)

test("recall refreshes existing history", () => {
  const client = new QueryClient()
  const key = ["chat-messages", "conversation"]
  client.setQueryData(key, { pages: [[{ id: "old" }]], pageParams: [null] })
  invalidateChatEvent(client, {
    type: "message.recalled",
    conversationId: "conversation",
  })
  expect(client.getQueryState(key)?.isInvalidated).toBe(true)
  client.clear()
})
