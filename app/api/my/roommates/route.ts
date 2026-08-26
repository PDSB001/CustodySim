import { and, eq, ne } from "drizzle-orm"

import { failure, success } from "@/lib/api-response"
import {
  CUSTODY_LEVEL_LABELS,
  PRISONER_CUSTODY_STATUS_LABELS,
  type CustodyLevel,
  type PrisonerCustodyStatus,
} from "@/lib/constants"
import { db } from "@/lib/db"
import { organizations, persons } from "@/lib/db/schema"
import { getSessionUser } from "@/lib/session"

export async function GET() {
  const actor = await getSessionUser()
  if (!actor) return failure("UNAUTHORIZED", "请先登录", 401)
  if (actor.role !== "SUPERVISED")
    return failure("FORBIDDEN", "仅被监管人可查看同监室汇总", 403)
  try {
    const [person] = await db
      .select({ id: persons.id, organizationId: persons.organizationId })
      .from(persons)
      .where(
        and(eq(persons.userId, actor.id), eq(persons.personType, "SUPERVISED")),
      )
      .limit(1)
    if (!person?.organizationId)
      return success({ roomName: null, roommates: [] })
    const [[room], roommates] = await Promise.all([
      db
        .select({ name: organizations.name })
        .from(organizations)
        .where(eq(organizations.id, person.organizationId))
        .limit(1),
      db
        .select({
          id: persons.id,
          name: persons.name,
          prisonerNumber: persons.prisonerNumber,
          customNumber: persons.customNumber,
          custodyLevel: persons.custodyLevel,
          custodyStatus: persons.custodyStatus,
        })
        .from(persons)
        .where(
          and(
            eq(persons.organizationId, person.organizationId),
            eq(persons.personType, "SUPERVISED"),
            eq(persons.status, "active"),
            ne(persons.id, person.id),
          ),
        )
        .orderBy(persons.name),
    ])
    return success({
      roomName: room?.name ?? null,
      roommates: roommates.map((roommate) => ({
        id: roommate.id,
        name: roommate.name,
        number: roommate.prisonerNumber ?? roommate.customNumber,
        custodyLevelLabel:
          CUSTODY_LEVEL_LABELS[roommate.custodyLevel as CustodyLevel],
        custodyStatusLabel:
          PRISONER_CUSTODY_STATUS_LABELS[
            roommate.custodyStatus as PrisonerCustodyStatus
          ],
      })),
    })
  } catch (error) {
    console.error("[API my/roommates GET]", error)
    return failure("INTERNAL_ERROR", "服务器错误", 500)
  }
}
