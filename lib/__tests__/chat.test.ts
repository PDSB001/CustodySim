import { describe, expect, it } from "vitest"

import {
  buildDirectConversationKey,
  ChatMessageDraftSchema,
  chatMessagePreview,
  canRecallChatMessage,
  hasCompleteChatScope,
  retentionCutoff,
} from "@/lib/chat"

describe("chat policy", () => {
  it("accepts plain images and images with a caption as one message", () => {
    const image = "data:image/png;base64,aGVsbG8="
    expect(ChatMessageDraftSchema.safeParse({ type: "IMAGE", content: image }).success).toBe(true)
    expect(ChatMessageDraftSchema.safeParse({ type: "IMAGE", content: image, caption: "说明" }).success).toBe(true)
    expect(ChatMessageDraftSchema.safeParse({ type: "TEXT", content: "你好", caption: "多余" }).success).toBe(false)
    expect(chatMessagePreview("IMAGE", image, "说明")).toBe("[图片] 说明")
  })
  it("builds the same direct key regardless of participant order", () => {
    expect(buildDirectConversationKey("b", "a")).toBe("a:b")
    expect(buildDirectConversationKey("a", "b")).toBe("a:b")
  })

  it("uses 14 days for supervised users and 28 days for staff", () => {
    const now = new Date("2026-08-29T00:00:00.000Z")
    expect(retentionCutoff("SUPERVISED", now).toISOString()).toBe(
      "2026-08-15T00:00:00.000Z",
    )
    expect(retentionCutoff("ADMIN", now).toISOString()).toBe(
      "2026-08-01T00:00:00.000Z",
    )
  })

  it("requires the supervisor scope to cover every chat participant", () => {
    const scope = new Set(["user-a", "user-b"])
    expect(hasCompleteChatScope(["user-a", "user-b"], scope)).toBe(true)
    expect(hasCompleteChatScope(["user-a", "user-c"], scope)).toBe(false)
    expect(hasCompleteChatScope([], scope)).toBe(false)
  })

  it("allows only the sender to recall within five minutes", () => {
    const createdAt = new Date("2026-08-29T00:00:00.000Z")
    expect(
      canRecallChatMessage({
        actorId: "sender",
        senderId: "sender",
        createdAt,
        recalledAt: null,
        now: new Date("2026-08-29T00:05:00.000Z"),
      }),
    ).toBe(true)
    expect(
      canRecallChatMessage({
        actorId: "sender",
        senderId: "sender",
        createdAt,
        recalledAt: null,
        now: new Date("2026-08-29T00:05:00.001Z"),
      }),
    ).toBe(false)
    expect(
      canRecallChatMessage({
        actorId: "other",
        senderId: "sender",
        createdAt,
        recalledAt: null,
      }),
    ).toBe(false)
  })
})
