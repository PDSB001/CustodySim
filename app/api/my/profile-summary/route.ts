import { and, desc, eq } from "drizzle-orm"

import { failure, success } from "@/lib/api-response"
import { CUSTODY_LEVEL_LABELS, type CustodyLevel } from "@/lib/constants"
import { db } from "@/lib/db"
import { organizations, persons, profileRecords } from "@/lib/db/schema"
import { buildOrgPathMapFromCategory } from "@/lib/org-tree"
import { resolveProfileSummary } from "@/lib/profile-summary"
import { getSessionUser } from "@/lib/session"

export async function GET() {
  const actor = await getSessionUser()
  if (!actor) return failure("UNAUTHORIZED", "请先登录", 401)
  if (actor.role !== "SUPERVISED")
    return failure("FORBIDDEN", "仅被监管人可查看个人监管摘要", 403)
  try {
    const [person] = await db
      .select({
        prisonerNumber: persons.prisonerNumber,
        customNumber: persons.customNumber,
        organizationId: persons.organizationId,
        custodyLevel: persons.custodyLevel,
        chargeName: persons.chargeName,
        sentenceStartDate: persons.sentenceStartDate,
        sentenceEndDate: persons.sentenceEndDate,
      })
      .from(persons)
      .where(
        and(eq(persons.userId, actor.id), eq(persons.personType, "SUPERVISED")),
      )
      .limit(1)
    if (!person) return failure("NOT_FOUND", "未建立人员主档", 404)
    const [organizationsRows, archiveRecords] = await Promise.all([
      db
        .select({
          id: organizations.id,
          name: organizations.name,
          parentId: organizations.parentId,
          category: organizations.category,
          sort: organizations.sort,
        })
        .from(organizations),
      db
        .select({ data: profileRecords.data })
        .from(profileRecords)
        .where(eq(profileRecords.userId, actor.id))
        .orderBy(desc(profileRecords.updatedAt)),
    ])
    const linked = resolveProfileSummary({
      chargeName: person.chargeName,
      sentenceStartDate: person.sentenceStartDate,
      sentenceEndDate: person.sentenceEndDate,
      archiveRecords,
    })
    const organizationPath = person.organizationId
      ? (buildOrgPathMapFromCategory(
          organizationsRows,
          "SUPERVISED_ROOT",
        ).get(person.organizationId) ?? null)
      : null
    return success({
      number: person.prisonerNumber ?? person.customNumber,
      organizationPath,
      custodyLevel: person.custodyLevel,
      custodyLevelLabel:
        CUSTODY_LEVEL_LABELS[person.custodyLevel as CustodyLevel],
      ...linked,
    })
  } catch (error) {
    console.error("[API my/profile-summary GET]", error)
    return failure("INTERNAL_ERROR", "服务器错误", 500)
  }
}
