import { and, desc, eq, gte, inArray, sql } from "drizzle-orm"
import { NextRequest } from "next/server"
import { z } from "zod"

import { failure, success } from "@/lib/api-response"
import {
  ChatMessageDraftSchema,
  CHAT_SEND_RATE_LIMIT_COUNT,
  CHAT_SEND_RATE_LIMIT_WINDOW_MS,
  retentionCutoff,
} from "@/lib/chat"
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

class ChatRateLimitError extends Error {}

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
    const before = beforeValue ? IdSchema.safeParse(beforeValue) : null
    if (before && !before.success)
      return failure("VALIDATION_ERROR", "分页游标无效", 400)
    const conditions = [
      eq(chatMessages.conversationId, conversation.id),
      gte(chatMessages.createdAt, retentionCutoff(actor.role)),
    ]
    if (before?.success)
      conditions.push(sql<boolean>`
        (${chatMessages.createdAt}, ${chatMessages.id}) < (
          select boundary.created_at, boundary.id
          from chat_messages boundary
          where boundary.id = ${before.data}::uuid
            and boundary.conversation_id = ${conversation.id}::uuid
        )
      `)
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
        .orderBy(desc(chatMessages.createdAt), desc(chatMessages.id))
        .limit(50)
    ).reverse()
    const readRows = rows.length
      ? await db
          .select({ messageId: chatMessageReads.messageId })
          .from(chatMessageReads)
          .innerJoin(users, eq(users.id, chatMessageReads.userId))
          .where(
            and(
              inArray(
                chatMessageReads.messageId,
                rows.map((row) => row.id),
              ),
              eq(users.role, "SUPERVISED"),
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
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`chat-send:${actor.id}`}, 0))`,
      )
      const [usage] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(chatMessages)
        .where(
          and(
            eq(chatMessages.senderId, actor.id),
            gte(
              chatMessages.createdAt,
              new Date(now.getTime() - CHAT_SEND_RATE_LIMIT_WINDOW_MS),
            ),
          ),
        )
      if ((usage?.count ?? 0) >= CHAT_SEND_RATE_LIMIT_COUNT)
        throw new ChatRateLimitError()
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
        readCount: actor.role === "SUPERVISED" ? 1 : 0,
      },
      { status: 201 },
    )
  } catch (error) {
    if (error instanceof ChatRateLimitError)
      return failure("RATE_LIMITED", "消息发送过于频繁，请稍后再试", 429)
    console.error("[API chat messages POST]", error)
    return failure("INTERNAL_ERROR", "发送消息失败", 500)
  }
}
