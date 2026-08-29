import { and, eq, inArray, isNull, sql } from "drizzle-orm"

import { db } from "@/lib/db"
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
  if (actor.role === "ADMIN") return conversation

  if (conversation.type === "ROOM") {
    if (!conversation.roomOrganizationId) return null
    if (actor.role === "SUPERVISED") {
      const roomId = await getSupervisedRoom(actor.id)
      return roomId === conversation.roomOrganizationId ? conversation : null
    }
    const scopedIds = await getSupervisedUserIdsForSupervisor(actor.id)
    if (scopedIds.size === 0) return null
    const [roomMember] = await db
      .select({ id: persons.id })
      .from(persons)
      .where(
        and(
          eq(persons.organizationId, conversation.roomOrganizationId),
          inArray(persons.userId, [...scopedIds]),
          eq(persons.status, "active"),
        ),
      )
      .limit(1)
    return roomMember ? conversation : null
  }

  const memberIds = await getConversationMemberIds(conversationId)
  if (actor.role === "SUPERVISED")
    return memberIds.includes(actor.id) ? conversation : null
  const scopedIds = await getSupervisedUserIdsForSupervisor(actor.id)
  return memberIds.length > 0 && memberIds.every((id) => scopedIds.has(id))
    ? conversation
    : null
}

export async function listAccessibleConversationIds(actor: SessionUser) {
  const rows = await db
    .select({ id: chatConversations.id })
    .from(chatConversations)
    .where(eq(chatConversations.status, "ACTIVE"))
  const ids: string[] = []
  for (const row of rows)
    if (await getChatConversationAccess(actor, row.id)) ids.push(row.id)
  return ids
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
