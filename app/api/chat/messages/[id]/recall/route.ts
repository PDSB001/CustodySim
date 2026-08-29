import { and, eq, isNull } from "drizzle-orm"
import { z } from "zod"

import { failure, success } from "@/lib/api-response"
import { writeAuditLog } from "@/lib/audit"
import { canRecallChatMessage } from "@/lib/chat"
import { getChatConversationAccess, notifyChatEvent } from "@/lib/chat-server"
import { db } from "@/lib/db"
import { chatMessages } from "@/lib/db/schema"
import { getSessionUser } from "@/lib/session"

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const actor = await getSessionUser()
  if (!actor) return failure("UNAUTHORIZED", "请先登录", 401)
  const id = z
    .string()
    .uuid()
    .safeParse((await context.params).id)
  if (!id.success) return failure("VALIDATION_ERROR", "消息编号无效", 400)
  try {
    const [message] = await db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.id, id.data))
      .limit(1)
    if (!message) return failure("NOT_FOUND", "消息不存在", 404)
    if (!(await getChatConversationAccess(actor, message.conversationId)))
      return failure("NOT_FOUND", "消息不存在", 404)
    const now = new Date()
    if (
      !canRecallChatMessage({
        actorId: actor.id,
        senderId: message.senderId,
        createdAt: message.createdAt,
        recalledAt: message.recalledAt,
        now,
      })
    )
      return failure("FORBIDDEN", "仅可在发送后5分钟内撤回自己的消息", 403)
    const [recalled] = await db.transaction(async (tx) => {
      const rows = await tx
        .update(chatMessages)
        .set({ recalledAt: now, recalledBy: actor.id })
        .where(
          and(
            eq(chatMessages.id, message.id),
            eq(chatMessages.senderId, actor.id),
            isNull(chatMessages.recalledAt),
          ),
        )
        .returning({ id: chatMessages.id })
      if (!rows[0]) return []
      await writeAuditLog(
        {
          actor,
          action: "CHAT_RECALL",
          actionLabel: "撤回聊天消息",
          entityType: "chat_message",
          entityId: message.id,
          detail: { conversationId: message.conversationId },
        },
        tx,
      )
      await notifyChatEvent(tx, {
        type: "message.recalled",
        conversationId: message.conversationId,
        messageId: message.id,
      })
      return rows
    })
    if (!recalled) return failure("CONFLICT", "消息已经撤回", 409)
    return success({ id: message.id, recalledAt: now.toISOString() })
  } catch (error) {
    console.error("[API chat recall POST]", error)
    return failure("INTERNAL_ERROR", "撤回消息失败", 500)
  }
}
