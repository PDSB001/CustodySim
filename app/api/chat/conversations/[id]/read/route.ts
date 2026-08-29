import { and, eq, lte, ne } from "drizzle-orm"
import { NextRequest } from "next/server"
import { z } from "zod"

import { failure, success } from "@/lib/api-response"
import { ChatReadSchema } from "@/lib/chat"
import { getChatConversationAccess, notifyChatEvent } from "@/lib/chat-server"
import { db } from "@/lib/db"
import { chatMessageReads, chatMessages } from "@/lib/db/schema"
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
      .select({ createdAt: chatMessages.createdAt })
      .from(chatMessages)
      .where(
        and(
          eq(chatMessages.id, parsed.data.messageId),
          eq(chatMessages.conversationId, conversation.id),
        ),
      )
      .limit(1)
    if (!lastMessage) return failure("NOT_FOUND", "消息不存在", 404)
    await db.transaction(async (tx) => {
      const unread = await tx
        .select({ id: chatMessages.id })
        .from(chatMessages)
        .where(
          and(
            eq(chatMessages.conversationId, conversation.id),
            lte(chatMessages.createdAt, lastMessage.createdAt),
            ne(chatMessages.senderId, actor.id),
          ),
        )
      if (unread.length)
        await tx
          .insert(chatMessageReads)
          .values(
            unread.map((message) => ({
              messageId: message.id,
              userId: actor.id,
            })),
          )
          .onConflictDoNothing()
      await notifyChatEvent(tx, {
        type: "message.read",
        conversationId: conversation.id,
        messageId: parsed.data.messageId,
      })
    })
    return success({ messageId: parsed.data.messageId })
  } catch (error) {
    console.error("[API chat read POST]", error)
    return failure("INTERNAL_ERROR", "更新已读状态失败", 500)
  }
}
