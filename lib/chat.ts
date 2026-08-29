import { z } from "zod"

export const CHAT_RECALL_WINDOW_MS = 5 * 60 * 1000
export const CHAT_USER_RETENTION_DAYS = 14
export const CHAT_AUDIT_RETENTION_DAYS = 28
export const CHAT_SEND_RATE_LIMIT_COUNT = 10
export const CHAT_SEND_RATE_LIMIT_WINDOW_MS = 10 * 1000

export const ChatCreateConversationSchema = z.object({
  kind: z.enum(["ROOM", "DIRECT"]),
  targetUserId: z.string().uuid().optional(),
  reason: z.string().trim().max(500).optional(),
})

export const ChatMessageDraftSchema = z.object({
  content: z.string().trim().min(1).max(4000),
})

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
