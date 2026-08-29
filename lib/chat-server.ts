import { and, eq, inArray, isNull, sql } from "drizzle-orm"

import { db } from "@/lib/db"
import { hasCompleteChatScope } from "@/lib/chat"
import {
  chatConversationMembers,
  chatConversations,
  persons,
  users,
} from "@/lib/db/schema"
import type { SessionUser } from "@/lib/session"
import { getSupervisedUserIdsForSupervisor } from "@/lib/supervision-scope"

export type ChatConversationRecord = typeof chatConversations.$inferSelect

export async function getSupervisedRoom(userId: string) {
  const [room] = await db
    .select({ organizationId: persons.organizationId })
    .from(persons)
    .where(
      and(
        eq(persons.userId, userId),
        eq(persons.personType, "SUPERVISED"),
        eq(persons.status, "active"),
      ),
    )
    .limit(1)
  return room?.organizationId ?? null
}

export async function getConversationMemberIds(conversationId: string) {
  const rows = await db
    .select({ userId: chatConversationMembers.userId })
    .from(chatConversationMembers)
    .where(
      and(
        eq(chatConversationMembers.conversationId, conversationId),
        isNull(chatConversationMembers.leftAt),
      ),
    )
  return rows.map((row) => row.userId)
}

export async function getChatConversationAccess(
  actor: SessionUser,
  conversationId: string,
) {
  const [conversation] = await db
    .select()
    .from(chatConversations)
    .where(
      and(
        eq(chatConversations.id, conversationId),
        eq(chatConversations.status, "ACTIVE"),
      ),
    )
    .limit(1)
  if (!conversation) return null
  return (
    (await filterAccessibleChatConversations(actor, [conversation]))[0] ?? null
  )
}

export async function filterAccessibleChatConversations(
  actor: SessionUser,
  conversations: ChatConversationRecord[],
) {
  const active = conversations.filter((item) => item.status === "ACTIVE")
  if (actor.role === "ADMIN" || active.length === 0) return active

  const conversationIds = active.map((item) => item.id)
  const memberRows = await db
    .select({
      conversationId: chatConversationMembers.conversationId,
      userId: chatConversationMembers.userId,
    })
    .from(chatConversationMembers)
    .where(
      and(
        inArray(chatConversationMembers.conversationId, conversationIds),
        isNull(chatConversationMembers.leftAt),
      ),
    )
  const memberIds = new Map<string, string[]>()
  for (const row of memberRows)
    memberIds.set(row.conversationId, [
      ...(memberIds.get(row.conversationId) ?? []),
      row.userId,
    ])

  if (actor.role === "SUPERVISED") {
    const roomId = await getSupervisedRoom(actor.id)
    return active.filter((conversation) =>
      conversation.type === "ROOM"
        ? Boolean(roomId && conversation.roomOrganizationId === roomId)
        : (memberIds.get(conversation.id) ?? []).includes(actor.id),
    )
  }

  const scopedIds = await getSupervisedUserIdsForSupervisor(actor.id)
  if (scopedIds.size === 0) return []
  const roomIds = [
    ...new Set(
      active.flatMap((conversation) =>
        conversation.type === "ROOM" && conversation.roomOrganizationId
          ? [conversation.roomOrganizationId]
          : [],
      ),
    ),
  ]
  const roomMemberRows = roomIds.length
    ? await db
        .select({
          organizationId: persons.organizationId,
          userId: users.id,
        })
        .from(persons)
        .innerJoin(users, eq(users.id, persons.userId))
        .where(
          and(
            inArray(persons.organizationId, roomIds),
            eq(persons.personType, "SUPERVISED"),
            eq(persons.status, "active"),
            eq(users.status, "active"),
          ),
        )
    : []
  const roomMemberIds = new Map<string, string[]>()
  for (const row of roomMemberRows) {
    if (!row.organizationId) continue
    roomMemberIds.set(row.organizationId, [
      ...(roomMemberIds.get(row.organizationId) ?? []),
      row.userId,
    ])
  }
  return active.filter((conversation) => {
    const ids =
      conversation.type === "ROOM" && conversation.roomOrganizationId
        ? (roomMemberIds.get(conversation.roomOrganizationId) ?? [])
        : (memberIds.get(conversation.id) ?? [])
    return hasCompleteChatScope(ids, scopedIds)
  })
}

export async function getChatUserSummary(userId: string) {
  const [user] = await db
    .select({
      id: users.id,
      name: users.name,
      role: users.role,
      status: users.status,
      organizationId: persons.organizationId,
    })
    .from(users)
    .leftJoin(persons, eq(persons.userId, users.id))
    .where(eq(users.id, userId))
    .limit(1)
  return user ?? null
}

export async function notifyChatEvent(
  executor: Pick<typeof db, "execute">,
  event: {
    type:
      | "message.created"
      | "message.recalled"
      | "message.read"
      | "conversation.created"
    conversationId: string
    messageId?: string
  },
) {
  await executor.execute(
    sql`select pg_notify('custodysim_chat', ${JSON.stringify(event)})`,
  )
}
