import { and, desc, eq, gte, isNull, ne, or } from "drizzle-orm"
import { NextRequest } from "next/server"

import { failure, success } from "@/lib/api-response"
import { writeAuditLog } from "@/lib/audit"
import {
  buildDirectConversationKey,
  ChatCreateConversationSchema,
  retentionCutoff,
} from "@/lib/chat"
import {
  getChatConversationAccess,
  getChatUserSummary,
  getConversationMemberIds,
  getSupervisedRoom,
  notifyChatEvent,
} from "@/lib/chat-server"
import { db } from "@/lib/db"
import {
  chatConversationMembers,
  chatConversations,
  chatDirectRequests,
  chatMessageReads,
  chatMessages,
  organizations,
} from "@/lib/db/schema"
import { getSessionUser } from "@/lib/session"

async function serializeConversation(
  actor: NonNullable<Awaited<ReturnType<typeof getSessionUser>>>,
  conversation: typeof chatConversations.$inferSelect,
) {
  const cutoff = retentionCutoff(actor.role)
  const memberIds = await getConversationMemberIds(conversation.id)
  const [members, [room], [lastMessage], unreadRows] = await Promise.all([
    Promise.all(memberIds.map(getChatUserSummary)),
    conversation.roomOrganizationId
      ? db
          .select({ name: organizations.name })
          .from(organizations)
          .where(eq(organizations.id, conversation.roomOrganizationId))
          .limit(1)
      : Promise.resolve([]),
    db
      .select({
        id: chatMessages.id,
        content: chatMessages.content,
        recalledAt: chatMessages.recalledAt,
        createdAt: chatMessages.createdAt,
      })
      .from(chatMessages)
      .leftJoin(
        chatConversationMembers,
        and(
          eq(chatConversationMembers.conversationId, conversation.id),
          eq(chatConversationMembers.userId, chatMessages.senderId),
        ),
      )
      .where(
        and(
          eq(chatMessages.conversationId, conversation.id),
          gte(chatMessages.createdAt, cutoff),
        ),
      )
      .orderBy(desc(chatMessages.createdAt))
      .limit(1),
    db
      .select({ id: chatMessages.id })
      .from(chatMessages)
      .leftJoin(
        chatMessageReads,
        and(
          eq(chatMessageReads.messageId, chatMessages.id),
          eq(chatMessageReads.userId, actor.id),
        ),
      )
      .where(
        and(
          eq(chatMessages.conversationId, conversation.id),
          gte(chatMessages.createdAt, cutoff),
          ne(chatMessages.senderId, actor.id),
          isNull(chatMessageReads.id),
        ),
      ),
  ])
  const validMembers = members.filter(Boolean)
  const otherMembers = validMembers.filter((member) => member?.id !== actor.id)
  const title =
    conversation.type === "ROOM"
      ? `${room?.name ?? "当前监室"}群聊`
      : otherMembers.map((member) => member?.name).join("、") || "私聊"
  return {
    id: conversation.id,
    type: conversation.type,
    title,
    roomOrganizationId: conversation.roomOrganizationId,
    members: validMembers.map((member) => ({
      id: member!.id,
      name: member!.name,
    })),
    lastMessage: lastMessage
      ? {
          id: lastMessage.id,
          content: lastMessage.recalledAt ? "消息已撤回" : lastMessage.content,
          createdAt: lastMessage.createdAt.toISOString(),
        }
      : null,
    unreadCount: unreadRows.length,
  }
}

export async function GET() {
  const actor = await getSessionUser()
  if (!actor) return failure("UNAUTHORIZED", "请先登录", 401)
  try {
    let candidates: Array<typeof chatConversations.$inferSelect>
    if (actor.role === "ADMIN") {
      candidates = await db
        .select()
        .from(chatConversations)
        .where(eq(chatConversations.status, "ACTIVE"))
        .orderBy(
          desc(chatConversations.lastMessageAt),
          desc(chatConversations.createdAt),
        )
    } else if (actor.role === "SUPERVISED") {
      const roomId = await getSupervisedRoom(actor.id)
      const directRows = await db
        .select({ conversation: chatConversations })
        .from(chatConversationMembers)
        .innerJoin(
          chatConversations,
          eq(chatConversations.id, chatConversationMembers.conversationId),
        )
        .where(
          and(
            eq(chatConversationMembers.userId, actor.id),
            isNull(chatConversationMembers.leftAt),
            eq(chatConversations.status, "ACTIVE"),
          ),
        )
      const rooms = roomId
        ? await db
            .select()
            .from(chatConversations)
            .where(
              and(
                eq(chatConversations.type, "ROOM"),
                eq(chatConversations.roomOrganizationId, roomId),
                eq(chatConversations.status, "ACTIVE"),
              ),
            )
        : []
      candidates = [...rooms, ...directRows.map((row) => row.conversation)]
    } else {
      candidates = await db
        .select()
        .from(chatConversations)
        .where(eq(chatConversations.status, "ACTIVE"))
    }
    const accessible = []
    for (const conversation of candidates) {
      if (await getChatConversationAccess(actor, conversation.id))
        accessible.push(await serializeConversation(actor, conversation))
    }
    accessible.sort((left, right) => {
      const leftAt = left.lastMessage?.createdAt ?? ""
      const rightAt = right.lastMessage?.createdAt ?? ""
      return rightAt.localeCompare(leftAt)
    })
    return success(accessible)
  } catch (error) {
    console.error("[API chat/conversations GET]", error)
    return failure("INTERNAL_ERROR", "获取会话失败", 500)
  }
}

export async function POST(request: NextRequest) {
  const actor = await getSessionUser()
  if (!actor) return failure("UNAUTHORIZED", "请先登录", 401)
  if (actor.role !== "SUPERVISED")
    return failure("FORBIDDEN", "仅被监管人可发起聊天", 403)
  const parsed = ChatCreateConversationSchema.safeParse(await request.json())
  if (!parsed.success) return failure("VALIDATION_ERROR", "会话参数不合法", 400)
  try {
    const actorRoomId = await getSupervisedRoom(actor.id)
    if (!actorRoomId)
      return failure("VALIDATION_ERROR", "当前账号尚未分配监室", 400)

    if (parsed.data.kind === "ROOM") {
      const conversation = await db.transaction(async (tx) => {
        const [created] = await tx
          .insert(chatConversations)
          .values({
            type: "ROOM",
            roomOrganizationId: actorRoomId,
            createdBy: actor.id,
          })
          .onConflictDoNothing()
          .returning()
        const existing = created
          ? null
          : (
              await tx
                .select()
                .from(chatConversations)
                .where(eq(chatConversations.roomOrganizationId, actorRoomId))
                .limit(1)
            )[0]
        const result = created ?? existing
        if (!result) throw new Error("创建监室群聊失败")
        if (created)
          await notifyChatEvent(tx, {
            type: "conversation.created",
            conversationId: result.id,
          })
        return result
      })
      return success(await serializeConversation(actor, conversation), {
        status: 201,
      })
    }

    const targetUserId = parsed.data.targetUserId
    if (!targetUserId || targetUserId === actor.id)
      return failure("VALIDATION_ERROR", "请选择其他聊天对象", 400)
    const target = await getChatUserSummary(targetUserId)
    if (!target || target.role !== "SUPERVISED" || target.status !== "active")
      return failure("NOT_FOUND", "聊天对象不存在", 404)
    if (!target.organizationId)
      return failure("VALIDATION_ERROR", "聊天对象尚未分配监室", 400)

    const directKey = buildDirectConversationKey(actor.id, targetUserId)
    const [existingDirect] = await db
      .select()
      .from(chatConversations)
      .where(
        and(
          eq(chatConversations.directKey, directKey),
          eq(chatConversations.status, "ACTIVE"),
        ),
      )
      .limit(1)
    if (existingDirect)
      return success(await serializeConversation(actor, existingDirect))

    if (target.organizationId !== actorRoomId) {
      const reason = parsed.data.reason?.trim()
      if (!reason)
        return failure("VALIDATION_ERROR", "跨监室私聊必须填写申请原因", 400)
      const [pending] = await db
        .select({ id: chatDirectRequests.id })
        .from(chatDirectRequests)
        .where(
          and(
            eq(chatDirectRequests.status, "PENDING"),
            or(
              and(
                eq(chatDirectRequests.requesterId, actor.id),
                eq(chatDirectRequests.targetId, targetUserId),
              ),
              and(
                eq(chatDirectRequests.requesterId, targetUserId),
                eq(chatDirectRequests.targetId, actor.id),
              ),
            ),
          ),
        )
        .limit(1)
      if (pending) return failure("CONFLICT", "双方已有待审批的私聊申请", 409)
      const [created] = await db
        .insert(chatDirectRequests)
        .values({ requesterId: actor.id, targetId: targetUserId, reason })
        .returning()
      if (!created) throw new Error("创建私聊申请失败")
      await writeAuditLog({
        actor,
        action: "CHAT_REQUEST",
        actionLabel: "提交跨监室私聊申请",
        entityType: "chat_direct_request",
        entityId: created.id,
        detail: { targetUserId },
      })
      return success(
        { status: "PENDING", requestId: created.id },
        { status: 202 },
      )
    }

    const conversation = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(chatConversations)
        .values({ type: "DIRECT", directKey, createdBy: actor.id })
        .onConflictDoNothing()
        .returning()
      const result =
        created ??
        (
          await tx
            .select()
            .from(chatConversations)
            .where(eq(chatConversations.directKey, directKey))
            .limit(1)
        )[0]
      if (!result) throw new Error("创建私聊失败")
      await tx
        .insert(chatConversationMembers)
        .values([
          { conversationId: result.id, userId: actor.id },
          { conversationId: result.id, userId: targetUserId },
        ])
        .onConflictDoNothing()
      if (created)
        await notifyChatEvent(tx, {
          type: "conversation.created",
          conversationId: result.id,
        })
      return result
    })
    return success(await serializeConversation(actor, conversation), {
      status: 201,
    })
  } catch (error) {
    console.error("[API chat/conversations POST]", error)
    return failure("INTERNAL_ERROR", "创建会话失败", 500)
  }
}
