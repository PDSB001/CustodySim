import { and, desc, eq, gte, inArray, lt } from "drizzle-orm"
import { NextRequest } from "next/server"
import { z } from "zod"

import { failure, success } from "@/lib/api-response"
import { ChatMessageDraftSchema, retentionCutoff } from "@/lib/chat"
import { getChatConversationAccess, notifyChatEvent } from "@/lib/chat-server"
import { db } from "@/lib/db"
import {
  chatConversations,
  chatMessageReads,
  chatMessages,
  users,
} from "@/lib/db/schema"
import { getSessionUser } from "@/lib/session"

const IdSchema = z.string().uuid()

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const actor = await getSessionUser()
  if (!actor) return failure("UNAUTHORIZED", "请先登录", 401)
  const id = IdSchema.safeParse((await context.params).id)
  if (!id.success) return failure("VALIDATION_ERROR", "会话编号无效", 400)
  const conversation = await getChatConversationAccess(actor, id.data)
  if (!conversation) return failure("NOT_FOUND", "会话不存在", 404)
  try {
    const beforeValue = request.nextUrl.searchParams.get("before")
    const before = beforeValue ? new Date(beforeValue) : null
    if (before && Number.isNaN(before.getTime()))
      return failure("VALIDATION_ERROR", "分页时间无效", 400)
    const conditions = [
      eq(chatMessages.conversationId, conversation.id),
      gte(chatMessages.createdAt, retentionCutoff(actor.role)),
    ]
    if (before) conditions.push(lt(chatMessages.createdAt, before))
    const rows = (
      await db
        .select({
          id: chatMessages.id,
          senderId: chatMessages.senderId,
          senderName: users.name,
          type: chatMessages.type,
          content: chatMessages.content,
          recalledAt: chatMessages.recalledAt,
          createdAt: chatMessages.createdAt,
        })
        .from(chatMessages)
        .leftJoin(users, eq(users.id, chatMessages.senderId))
        .where(and(...conditions))
        .orderBy(desc(chatMessages.createdAt))
        .limit(50)
    ).reverse()
    const readRows = rows.length
      ? await db
          .select({ messageId: chatMessageReads.messageId })
          .from(chatMessageReads)
          .where(
            inArray(
              chatMessageReads.messageId,
              rows.map((row) => row.id),
            ),
          )
      : []
    const readCounts = new Map<string, number>()
    for (const row of readRows)
      readCounts.set(row.messageId, (readCounts.get(row.messageId) ?? 0) + 1)
    return success(
      rows.map((row) => ({
        ...row,
        content: row.recalledAt ? null : row.content,
        recalledAt: row.recalledAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
        readCount: readCounts.get(row.id) ?? 0,
      })),
    )
  } catch (error) {
    console.error("[API chat messages GET]", error)
    return failure("INTERNAL_ERROR", "获取消息失败", 500)
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const actor = await getSessionUser()
  if (!actor) return failure("UNAUTHORIZED", "请先登录", 401)
  const id = IdSchema.safeParse((await context.params).id)
  if (!id.success) return failure("VALIDATION_ERROR", "会话编号无效", 400)
  const parsed = ChatMessageDraftSchema.safeParse(await request.json())
  if (!parsed.success)
    return failure("VALIDATION_ERROR", "消息不能为空且不能超过4000字", 400)
  const conversation = await getChatConversationAccess(actor, id.data)
  if (!conversation) return failure("NOT_FOUND", "会话不存在", 404)
  try {
    const message = await db.transaction(async (tx) => {
      const now = new Date()
      const [created] = await tx
        .insert(chatMessages)
        .values({
          conversationId: conversation.id,
          senderId: actor.id,
          content: parsed.data.content,
        })
        .returning()
      if (!created) throw new Error("发送消息失败")
      await tx
        .update(chatConversations)
        .set({ lastMessageAt: now, updatedAt: now })
        .where(eq(chatConversations.id, conversation.id))
      await tx
        .insert(chatMessageReads)
        .values({ messageId: created.id, userId: actor.id })
        .onConflictDoNothing()
      await notifyChatEvent(tx, {
        type: "message.created",
        conversationId: conversation.id,
        messageId: created.id,
      })
      return created
    })
    return success(
      {
        ...message,
        senderName: actor.name,
        recalledAt: null,
        createdAt: message.createdAt.toISOString(),
        readCount: 1,
      },
      { status: 201 },
    )
  } catch (error) {
    console.error("[API chat messages POST]", error)
    return failure("INTERNAL_ERROR", "发送消息失败", 500)
  }
}
