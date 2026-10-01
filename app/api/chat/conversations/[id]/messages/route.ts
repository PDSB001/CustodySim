import { and, asc, count, desc, eq, gte, inArray, sql } from "drizzle-orm"
import { NextRequest } from "next/server"
import { z } from "zod"

import { failure, success } from "@/lib/api-response"
import {
  ChatMessageDraftSchema,
  CHAT_MESSAGE_MAX_LENGTH,
  CHAT_SEND_RATE_LIMIT_COUNT,
  CHAT_SEND_RATE_LIMIT_WINDOW_MS,
  chatImagesInline,
  chatMessagePayload,
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
    const afterValue = request.nextUrl.searchParams.get("after")
    const before = beforeValue ? IdSchema.safeParse(beforeValue) : null
    const after = afterValue ? IdSchema.safeParse(afterValue) : null
    if (before && !before.success)
      return failure("VALIDATION_ERROR", "分页游标无效", 400)
    if (after && !after.success)
      return failure("VALIDATION_ERROR", "增量游标无效", 400)
    if (beforeValue && afterValue)
      return failure("VALIDATION_ERROR", "不能同时使用 before 与 after", 400)
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
    // `after` 是给轮询用的增量游标：只取比游标更新的消息，游标本身严格排除。
    // 用正序 + 50 条（而不是倒序取"最新 50 条"）是为了**多轮能顺序补齐、不丢消息**：
    // 一次新增超过 50 条时，客户端把游标推进到本页最后一条，下一次轮询接着取下一页。
    if (after?.success)
      conditions.push(sql<boolean>`
        (${chatMessages.createdAt}, ${chatMessages.id}) > (
          select boundary.created_at, boundary.id
          from chat_messages boundary
          where boundary.id = ${after.data}::uuid
            and boundary.conversation_id = ${conversation.id}::uuid
        )
      `)
    const incremental = Boolean(after?.success)
    const page = await db
      .select({
        id: chatMessages.id,
        senderId: chatMessages.senderId,
        senderName: users.name,
        senderAvatar: users.avatar,
        type: chatMessages.type,
        content: chatMessages.content,
        caption: chatMessages.caption,
        recalledAt: chatMessages.recalledAt,
        createdAt: chatMessages.createdAt,
      })
      .from(chatMessages)
      .leftJoin(users, eq(users.id, chatMessages.senderId))
      .where(and(...conditions))
      .orderBy(
        incremental
          ? asc(chatMessages.createdAt)
          : desc(chatMessages.createdAt),
        incremental ? asc(chatMessages.id) : desc(chatMessages.id),
      )
      .limit(50)
    // 历史页是倒序取"最新的 50 条"，翻回正序下发；增量页本身就是正序，不再翻。
    const rows = incremental ? page : page.reverse()
    const readRows = rows.length
      ? await db
          .select({ messageId: chatMessageReads.messageId, count: count() })
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
          .groupBy(chatMessageReads.messageId)
      : []
    const readCounts = new Map(
      readRows.map((row) => [row.messageId, row.count]),
    )
    // 图片按代际决定内联还是给独立端点：代际 1 的 App 继续拿 data URL，
    // 浏览器与代际 ≥ 2 只拿 `imageUrl`（列表里不再有 Base64）。
    const inlineImage = chatImagesInline(request.headers)
    return success(
      rows.map((row) => ({
        ...row,
        ...chatMessagePayload(row, { inlineImage }),
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
    return failure(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ??
        `消息不能为空且不能超过${CHAT_MESSAGE_MAX_LENGTH}字`,
      400,
    )
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
          type: parsed.data.type,
          content: parsed.data.content,
          caption:
            parsed.data.type === "IMAGE" ? (parsed.data.caption ?? null) : null,
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
        // 与列表响应同一形态：发送方也不必再回传一遍整张 data URL。
        ...chatMessagePayload(message, {
          inlineImage: chatImagesInline(request.headers),
        }),
        senderName: actor.name,
        senderAvatar: actor.avatar ?? null,
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
