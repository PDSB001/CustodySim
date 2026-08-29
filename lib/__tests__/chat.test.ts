import { describe, expect, it } from "vitest"

import {
  buildDirectConversationKey,
  canRecallChatMessage,
  retentionCutoff,
} from "@/lib/chat"

describe("chat policy", () => {
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
