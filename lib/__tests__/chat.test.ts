import { describe, expect, it } from "vitest"

import {
  buildDirectConversationKey,
  ChatMessageDraftSchema,
  chatImagesInline,
  chatMessagePayload,
  chatMessagePreview,
  chatMessageImageUrl,
  canRecallChatMessage,
  hasCompleteChatScope,
  retentionCutoff,
} from "@/lib/chat"
import { isChatImagePath } from "@/lib/chat-image-path"

describe("chat policy", () => {
  it("accepts plain images and images with a caption as one message", () => {
    const image = "data:image/png;base64,aGVsbG8="
    expect(
      ChatMessageDraftSchema.safeParse({ type: "IMAGE", content: image })
        .success,
    ).toBe(true)
    expect(
      ChatMessageDraftSchema.safeParse({
        type: "IMAGE",
        content: image,
        caption: "说明",
      }).success,
    ).toBe(true)
    expect(
      ChatMessageDraftSchema.safeParse({
        type: "TEXT",
        content: "你好",
        caption: "多余",
      }).success,
    ).toBe(false)
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

  it("inlines images only for the published generation 1", () => {
    const headers = (value?: string) =>
      new Headers(value ? { "x-custodysim-client": value } : {})
    // 浏览器（不带客户端头）与代际 ≥ 2 都走独立图片端点，不再内联 Base64。
    expect(chatImagesInline(headers())).toBe(false)
    expect(chatImagesInline(headers("android-app/2"))).toBe(false)
    expect(chatImagesInline(headers("android-app/10"))).toBe(false)
    expect(chatImagesInline(headers("android-app"))).toBe(false)
    // 已发布的代际 1 只认内联 data URL，必须继续内联，否则它会看不到图片。
    expect(chatImagesInline(headers("android-app/1"))).toBe(true)
  })

  it("shapes image messages by generation and drops content after recall", () => {
    const message = {
      id: "2b6f0f5e-2f39-4b1f-9a1f-6a0f2c9c1234",
      type: "IMAGE",
      content: "data:image/png;base64,aGVsbG8=",
      caption: "说明",
      recalledAt: null,
    }
    expect(chatMessagePayload(message, { inlineImage: true })).toEqual({
      content: message.content,
      caption: "说明",
      hasImage: true,
      imageUrl: null,
    })
    expect(chatMessagePayload(message, { inlineImage: false })).toEqual({
      content: null,
      caption: "说明",
      hasImage: true,
      imageUrl: `/api/chat/messages/${message.id}/image`,
    })
    // 撤回后一律不下发内容，也不再指向图片端点。
    expect(
      chatMessagePayload(
        { ...message, recalledAt: new Date() },
        { inlineImage: true },
      ),
    ).toEqual({ content: null, caption: null, hasImage: false, imageUrl: null })
    // 文本消息不带图片字段。
    expect(
      chatMessagePayload(
        { ...message, type: "TEXT", content: "你好", caption: null },
        { inlineImage: false },
      ),
    ).toEqual({
      content: "你好",
      caption: null,
      hasImage: false,
      imageUrl: null,
    })
  })

  it("keeps the image endpoint path and the proxy cache exemption in sync", () => {
    const url = chatMessageImageUrl("2b6f0f5e-2f39-4b1f-9a1f-6a0f2c9c1234")
    expect(url).toBe(
      "/api/chat/messages/2b6f0f5e-2f39-4b1f-9a1f-6a0f2c9c1234/image",
    )
    // proxy 依赖这个判定放行强缓存；两处不一致会让缓存静默失效（没有任何报错）。
    expect(isChatImagePath(url)).toBe(true)
    expect(isChatImagePath("/api/chat/messages")).toBe(false)
    expect(isChatImagePath("/api/chat/conversations/1/messages")).toBe(false)
    expect(isChatImagePath(`${url}/preview`)).toBe(false)
  })
})
