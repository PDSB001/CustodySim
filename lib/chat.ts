import { z } from "zod"

import { validateTaskImageDataUrl } from "@/lib/task-image"

export const CHAT_RECALL_WINDOW_MS = 5 * 60 * 1000
export const CHAT_USER_RETENTION_DAYS = 14
export const CHAT_AUDIT_RETENTION_DAYS = 28
export const CHAT_SEND_RATE_LIMIT_COUNT = 10
export const CHAT_SEND_RATE_LIMIT_WINDOW_MS = 10 * 1000

/** 一条文本消息的最大长度（与 Web 端 Textarea 的 maxLength 保持一致）。 */
export const CHAT_MESSAGE_MAX_LENGTH = 4000

/**
 * 消息类型。
 *
 * - `TEXT`：正文为纯文本
 * - `IMAGE`：正文为单张图片的 data URL（复用任务图片的格式与体积约定：
 *   jpeg/png/webp、压缩后 ≤ 1 MB）。一条消息只带一张图，避免 `content` 膨胀；
 *   多图场景请连发多条。
 */
export const CHAT_MESSAGE_TYPE_TEXT = "TEXT"
export const CHAT_MESSAGE_TYPE_IMAGE = "IMAGE"

export const ChatCreateConversationSchema = z.object({
  kind: z.enum(["ROOM", "DIRECT"]),
  targetUserId: z.string().uuid().optional(),
  reason: z.string().trim().max(500).optional(),
})

/**
 * 发消息的请求体。
 *
 * `type` 缺省视为 `TEXT`（兼容尚未升级的客户端）；两种类型各自校验 `content`，
 * 这样报错文案能直接给到用户（例如「压缩后的图片不能超过 1 MB」）。
 */
export const ChatMessageDraftSchema = z
  .object({
    type: z
      .enum([CHAT_MESSAGE_TYPE_TEXT, CHAT_MESSAGE_TYPE_IMAGE])
      .optional()
      .default(CHAT_MESSAGE_TYPE_TEXT),
    content: z.string().trim().min(1, "消息不能为空"),
    caption: z.string().trim().max(CHAT_MESSAGE_MAX_LENGTH, `图片说明不能超过${CHAT_MESSAGE_MAX_LENGTH}字`).optional(),
  })
  .superRefine((value, context) => {
    if (value.type === CHAT_MESSAGE_TYPE_IMAGE) {
      const error = validateTaskImageDataUrl(value.content)
      if (error)
        context.addIssue({ code: "custom", message: error, path: ["content"] })
      return
    }
    if (value.caption)
      context.addIssue({ code: "custom", message: "文字消息不能附带图片说明", path: ["caption"] })
    if (value.content.length > CHAT_MESSAGE_MAX_LENGTH)
      context.addIssue({
        code: "custom",
        message: `消息不能超过${CHAT_MESSAGE_MAX_LENGTH}字`,
        path: ["content"],
      })
  })

/**
 * 会话列表里展示的消息摘要。
 *
 * 图片消息的 `content` 是整张 data URL，绝不能直接下发到列表（体积与观感都不合适），
 * 这里统一折叠成「[图片]」。
 */
export function chatMessagePreview(type: string, content: string | null, caption?: string | null) {
  if (type === CHAT_MESSAGE_TYPE_IMAGE) return caption ? `[图片] ${caption.slice(0, 80)}` : "[图片]"
  return content
}

export const ChatReadSchema = z.object({
  messageId: z.string().uuid(),
})

export const ChatRealtimeTokenSchema = z.object({
  conversationId: z.string().uuid(),
})

export const ChatRequestReviewSchema = z.object({
  result: z.enum(["APPROVED", "REJECTED"]),
  comment: z.string().trim().max(500).optional(),
})

export function buildDirectConversationKey(
  leftUserId: string,
  rightUserId: string,
) {
  return [leftUserId, rightUserId].sort().join(":")
}

export function hasCompleteChatScope(
  participantIds: string[],
  scopedIds: ReadonlySet<string>,
) {
  return (
    participantIds.length > 0 &&
    participantIds.every((participantId) => scopedIds.has(participantId))
  )
}

export function retentionCutoff(role: string, now = new Date()) {
  const days =
    role === "SUPERVISED" ? CHAT_USER_RETENTION_DAYS : CHAT_AUDIT_RETENTION_DAYS
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
}

export function canRecallChatMessage({
  actorId,
  senderId,
  createdAt,
  recalledAt,
  now = new Date(),
}: {
  actorId: string
  senderId: string | null
  createdAt: Date
  recalledAt: Date | null
  now?: Date
}) {
  return (
    actorId === senderId &&
    !recalledAt &&
    now.getTime() - createdAt.getTime() <= CHAT_RECALL_WINDOW_MS
  )
}
