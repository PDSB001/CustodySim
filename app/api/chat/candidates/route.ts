import { and, eq, ne } from "drizzle-orm"

import { failure, success } from "@/lib/api-response"
import { getSupervisedRoom } from "@/lib/chat-server"
import { db } from "@/lib/db"
import { organizations, persons, users } from "@/lib/db/schema"
import { getSessionUser } from "@/lib/session"

export async function GET() {
  const actor = await getSessionUser()
  if (!actor) return failure("UNAUTHORIZED", "请先登录", 401)
  if (actor.role !== "SUPERVISED")
    return failure("FORBIDDEN", "仅被监管人可选择私聊对象", 403)
  try {
    const roomId = await getSupervisedRoom(actor.id)
    const rows = await db
      .select({
        id: users.id,
        name: users.name,
        organizationId: persons.organizationId,
        roomName: organizations.name,
      })
      .from(users)
      .innerJoin(persons, eq(persons.userId, users.id))
      .leftJoin(organizations, eq(organizations.id, persons.organizationId))
      .where(
        and(
          eq(users.role, "SUPERVISED"),
          eq(users.status, "active"),
          eq(persons.status, "active"),
          ne(users.id, actor.id),
        ),
      )
      .orderBy(organizations.name, users.name)
    return success(
      rows.map((row) => ({
        ...row,
        sameRoom: Boolean(roomId && row.organizationId === roomId),
      })),
    )
  } catch (error) {
    console.error("[API chat candidates GET]", error)
    return failure("INTERNAL_ERROR", "获取聊天对象失败", 500)
  }
}
