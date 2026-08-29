import { and, desc, eq, gte, inArray, isNull, or, sql } from "drizzle-orm"
import { NextRequest } from "next/server"

import { failure, success } from "@/lib/api-response"
import { writeAuditLog } from "@/lib/audit"
import {
  buildDirectConversationKey,
  ChatCreateConversationSchema,
  retentionCutoff,
} from "@/lib/chat"
import {
  filterAccessibleChatConversations,
  getChatUserSummary,
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
  users,
} from "@/lib/db/schema"
import { getSessionUser } from "@/lib/session"

async function serializeConversations(
  actor: NonNullable<Awaited<ReturnType<typeof getSessionUser>>>,
  conversations: Array<typeof chatConversations.$inferSelect>,
) {
  if (conversations.length === 0) return []
  const cutoff = retentionCutoff(actor.role)
  const conversationIds = conversations.map((conversation) => conversation.id)
  const roomOrganizationIds = [
    ...new Set(
      conversations.flatMap((conversation) =>
        conversation.roomOrganizationId
          ? [conversation.roomOrganizationId]
          : [],
      ),
    ),
  ]
  const [memberRows, roomRows, lastMessageRows, unreadRows] = await Promise.all(
    [
      db
        .select({
          conversationId: chatConversationMembers.conversationId,
          id: users.id,
          name: users.name,
        })
        .from(chatConversationMembers)
        .innerJoin(users, eq(users.id, chatConversationMembers.userId))
        .where(
          and(
            inArray(chatConversationMembers.conversationId, conversationIds),
            isNull(chatConversationMembers.leftAt),
          ),
        ),
      roomOrganizationIds.length
        ? db
            .select({ id: organizations.id, name: organizations.name })
            .from(organizations)
            .where(inArray(organizations.id, roomOrganizationIds))
        : Promise.resolve([]),
      db
        .selectDistinctOn([chatMessages.conversationId], {
          conversationId: chatMessages.conversationId,
          id: chatMessages.id,
          content: chatMessages.content,
          recalledAt: chatMessages.recalledAt,
          createdAt: chatMessages.createdAt,
        })
        .from(chatMessages)
        .where(
          and(
            inArray(chatMessages.conversationId, conversationIds),
            gte(chatMessages.createdAt, cutoff),
          ),
        )
        .orderBy(
          chatMessages.conversationId,
          desc(chatMessages.createdAt),
          desc(chatMessages.id),
        ),
      db
        .select({
          conversationId: chatMessages.conversationId,
          count: sql<number>`count(*)::int`,
        })
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
            inArray(chatMessages.conversationId, conversationIds),
            gte(chatMessages.createdAt, cutoff),
            sql`${chatMessages.senderId} is distinct from ${actor.id}::uuid`,
            isNull(chatMessageReads.id),
          ),
        )
        .groupBy(chatMessages.conversationId),
    ],
  )
  const membersByConversation = new Map<
    string,
    Array<{ id: string; name: string }>
  >()
  for (const member of memberRows)
    membersByConversation.set(member.conversationId, [
      ...(membersByConversation.get(member.conversationId) ?? []),
      { id: member.id, name: member.name },
    ])
  const roomNames = new Map(roomRows.map((room) => [room.id, room.name]))
  const lastMessages = new Map(
    lastMessageRows.map((message) => [message.conversationId, message]),
  )
  const unreadCounts = new Map(
    unreadRows.map((row) => [row.conversationId, row.count]),
  )
  return conversations.map((conversation) => {
    const members = membersByConversation.get(conversation.id) ?? []
    const otherMembers = members.filter((member) => member.id !== actor.id)
    const lastMessage = lastMessages.get(conversation.id)
    return {
      id: conversation.id,
      type: conversation.type,
      title:
        conversation.type === "ROOM"
          ? `${conversation.roomOrganizationId ? (roomNames.get(conversation.roomOrganizationId) ?? "当前监室") : "当前监室"}群聊`
          : otherMembers.map((member) => member.name).join("、") || "私聊",
      roomOrganizationId: conversation.roomOrganizationId,
      members,
      lastMessage: lastMessage
        ? {
            id: lastMessage.id,
            content: lastMessage.recalledAt
              ? "消息已撤回"
              : lastMessage.content,
            createdAt: lastMessage.createdAt.toISOString(),
          }
        : null,
      unreadCount: unreadCounts.get(conversation.id) ?? 0,
    }
  })
}

async function serializeConversation(
  actor: NonNullable<Awaited<ReturnType<typeof getSessionUser>>>,
  conversation: typeof chatConversations.$inferSelect,
) {
  const [serialized] = await serializeConversations(actor, [conversation])
  if (!serialized) throw new Error("序列化聊天会话失败")
  return serialized
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
    const visible = await filterAccessibleChatConversations(actor, candidates)
    const accessible = await serializeConversations(actor, visible)
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
      const outcome = await db.transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`chat-request:${directKey}`}, 0))`,
        )
        const [activeDirect] = await tx
          .select()
          .from(chatConversations)
          .where(
            and(
              eq(chatConversations.directKey, directKey),
              eq(chatConversations.status, "ACTIVE"),
            ),
          )
          .limit(1)
        if (activeDirect)
          return { kind: "EXISTING" as const, conversation: activeDirect }
        const [pending] = await tx
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
        if (pending) return { kind: "PENDING" as const }
        const [requestRow] = await tx
          .insert(chatDirectRequests)
          .values({ requesterId: actor.id, targetId: targetUserId, reason })
          .returning()
        if (!requestRow) throw new Error("创建私聊申请失败")
        await writeAuditLog(
          {
            actor,
            action: "CHAT_REQUEST",
            actionLabel: "提交跨监室私聊申请",
            entityType: "chat_direct_request",
            entityId: requestRow.id,
            detail: { targetUserId },
          },
          tx,
        )
        return { kind: "CREATED" as const, request: requestRow }
      })
      if (outcome.kind === "EXISTING")
        return success(await serializeConversation(actor, outcome.conversation))
      if (outcome.kind === "PENDING")
        return failure("CONFLICT", "双方已有待审批的私聊申请", 409)
      return success(
        { status: "PENDING", requestId: outcome.request.id },
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
