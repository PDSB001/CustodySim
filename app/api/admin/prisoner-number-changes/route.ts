import { desc, eq } from "drizzle-orm"

import { failure, success } from "@/lib/api-response"
import { getAdminUser } from "@/lib/admin-api"
import { db } from "@/lib/db"
import { persons, prisonerNumberChanges, users } from "@/lib/db/schema"

export async function GET() {
  const actor = await getAdminUser()
  if (!actor) return failure("FORBIDDEN", "仅管理员可查看编号变更", 403)
  const data = await db
    .select({
      id: prisonerNumberChanges.id,
      personId: prisonerNumberChanges.personId,
      personName: persons.name,
      oldNumber: prisonerNumberChanges.oldNumber,
      newNumber: prisonerNumberChanges.newNumber,
      reason: prisonerNumberChanges.reason,
      status: prisonerNumberChanges.status,
      requestedByName: users.name,
      createdAt: prisonerNumberChanges.createdAt,
    })
    .from(prisonerNumberChanges)
    .leftJoin(persons, eq(prisonerNumberChanges.personId, persons.id))
    .leftJoin(users, eq(prisonerNumberChanges.requestedBy, users.id))
    .orderBy(desc(prisonerNumberChanges.createdAt))
  return success(data)
}
