import { and, eq, sql } from "drizzle-orm"
import { NextRequest } from "next/server"
import { z } from "zod"

import { failure, success } from "@/lib/api-response"
import { ChatReadSchema } from "@/lib/chat"
import { getChatConversationAccess, notifyChatEvent } from "@/lib/chat-server"
import { db } from "@/lib/db"
import { chatMessages } from "@/lib/db/schema"
import { getSessionUser } from "@/lib/session"

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const actor = await getSessionUser()
  if (!actor) return failure("UNAUTHORIZED", "请先登录", 401)
  const id = z
    .string()
    .uuid()
    .safeParse((await context.params).id)
  if (!id.success) return failure("VALIDATION_ERROR", "会话编号无效", 400)
  const parsed = ChatReadSchema.safeParse(await request.json())
  if (!parsed.success) return failure("VALIDATION_ERROR", "消息编号无效", 400)
  const conversation = await getChatConversationAccess(actor, id.data)
  if (!conversation) return failure("NOT_FOUND", "会话不存在", 404)
  try {
    const [lastMessage] = await db
      .select({ id: chatMessages.id })
      .from(chatMessages)
      .where(
        and(
          eq(chatMessages.id, parsed.data.messageId),
          eq(chatMessages.conversationId, conversation.id),
        ),
      )
      .limit(1)
    if (!lastMessage) return failure("NOT_FOUND", "消息不存在", 404)
    const readCount = await db.transaction(async (tx) => {
      // Keep the boundary comparison entirely in PostgreSQL. Converting its
      // microsecond timestamp to a JavaScript Date truncates precision and can
      // otherwise exclude the boundary message itself, leaving unreadCount at 1.
      const result = await tx.execute(sql`
        insert into chat_message_reads (message_id, user_id)
        select ${chatMessages.id}, ${actor.id}::uuid
        from ${chatMessages}
        where ${chatMessages.conversationId} = ${conversation.id}::uuid
          and ${chatMessages.createdAt} <= (
            select boundary.created_at
            from chat_messages boundary
            where boundary.id = ${lastMessage.id}::uuid
          )
          and ${chatMessages.senderId} is distinct from ${actor.id}::uuid
        on conflict (message_id, user_id) do nothing
        returning message_id
      `)
      await notifyChatEvent(tx, {
        type: "message.read",
        conversationId: conversation.id,
        messageId: parsed.data.messageId,
      })
      return result.rowCount ?? 0
    })
    return success({ messageId: parsed.data.messageId, readCount })
  } catch (error) {
    console.error("[API chat read POST]", error)
    return failure("INTERNAL_ERROR", "更新已读状态失败", 500)
  }
}
