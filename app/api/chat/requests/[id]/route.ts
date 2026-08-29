import { and, eq } from "drizzle-orm"
import { NextRequest } from "next/server"
import { z } from "zod"

import { failure, success } from "@/lib/api-response"
import { writeAuditLog } from "@/lib/audit"
import { buildDirectConversationKey, ChatRequestReviewSchema } from "@/lib/chat"
import { notifyChatEvent } from "@/lib/chat-server"
import { db } from "@/lib/db"
import {
  chatConversationMembers,
  chatConversations,
  chatDirectRequests,
} from "@/lib/db/schema"
import { getSessionUser } from "@/lib/session"

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const actor = await getSessionUser()
  if (!actor) return failure("UNAUTHORIZED", "请先登录", 401)
  if (actor.role !== "ADMIN")
    return failure("FORBIDDEN", "仅管理员可审批跨监室私聊", 403)
  const id = z
    .string()
    .uuid()
    .safeParse((await context.params).id)
  if (!id.success) return failure("VALIDATION_ERROR", "申请编号无效", 400)
  const parsed = ChatRequestReviewSchema.safeParse(await request.json())
  if (!parsed.success) return failure("VALIDATION_ERROR", "审批参数不合法", 400)
  try {
    const result = await db.transaction(async (tx) => {
      const [chatRequest] = await tx
        .select()
        .from(chatDirectRequests)
        .where(
          and(
            eq(chatDirectRequests.id, id.data),
            eq(chatDirectRequests.status, "PENDING"),
          ),
        )
        .limit(1)
      if (!chatRequest) return null

      let conversationId: string | null = null
      if (parsed.data.result === "APPROVED") {
        const directKey = buildDirectConversationKey(
          chatRequest.requesterId,
          chatRequest.targetId,
        )
        const [created] = await tx
          .insert(chatConversations)
          .values({ type: "DIRECT", directKey, createdBy: actor.id })
          .onConflictDoNothing()
          .returning({ id: chatConversations.id })
        const conversation =
          created ??
          (
            await tx
              .select({ id: chatConversations.id })
              .from(chatConversations)
              .where(eq(chatConversations.directKey, directKey))
              .limit(1)
          )[0]
        if (!conversation) throw new Error("创建获批私聊失败")
        conversationId = conversation.id
        await tx
          .insert(chatConversationMembers)
          .values([
            { conversationId, userId: chatRequest.requesterId },
            { conversationId, userId: chatRequest.targetId },
          ])
          .onConflictDoNothing()
        if (created)
          await notifyChatEvent(tx, {
            type: "conversation.created",
            conversationId,
          })
      }

      const now = new Date()
      const [updated] = await tx
        .update(chatDirectRequests)
        .set({
          status: parsed.data.result,
          conversationId,
          reviewedBy: actor.id,
          reviewComment: parsed.data.comment || null,
          reviewedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(chatDirectRequests.id, chatRequest.id),
            eq(chatDirectRequests.status, "PENDING"),
          ),
        )
        .returning()
      if (!updated) return null
      await writeAuditLog(
        {
          actor,
          action: "CHAT_REQUEST_REVIEW",
          actionLabel:
            parsed.data.result === "APPROVED"
              ? "批准跨监室私聊"
              : "拒绝跨监室私聊",
          entityType: "chat_direct_request",
          entityId: chatRequest.id,
          detail: {
            requesterId: chatRequest.requesterId,
            targetId: chatRequest.targetId,
            result: parsed.data.result,
            conversationId,
          },
        },
        tx,
      )
      return updated
    })
    if (!result) return failure("CONFLICT", "申请不存在或已处理", 409)
    return success(result)
  } catch (error) {
    console.error("[API chat request PATCH]", error)
    return failure("INTERNAL_ERROR", "审批私聊申请失败", 500)
  }
}
