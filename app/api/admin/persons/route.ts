import { asc, eq } from "drizzle-orm"
import { NextRequest } from "next/server"

import { failure, success } from "@/lib/api-response"
import { getAdminUser } from "@/lib/admin-api"
import { PersonSchema } from "@/lib/admin-schemas"
import { writeAuditLog } from "@/lib/audit"
import { db } from "@/lib/db"
import { organizations, persons, profileRecords, users } from "@/lib/db/schema"
import { validatePersonOrganizationAssignment } from "@/lib/organization-assignment"
import type { OrganizationCategory } from "@/lib/constants"

export async function GET() {
  const actor = await getAdminUser()
  if (!actor) return failure("FORBIDDEN", "仅管理员可查看人员", 403)
  try {
    const [data, records] = await Promise.all([
      db
        .select({
          id: persons.id,
          name: persons.name,
          gender: persons.gender,
          age: persons.age,
          personType: persons.personType,
          prisonerNumber: persons.prisonerNumber,
          customNumber: persons.customNumber,
          status: persons.status,
          custodyLevel: persons.custodyLevel,
          custodyStatus: persons.custodyStatus,
          chargeName: persons.chargeName,
          sentenceStartDate: persons.sentenceStartDate,
          sentenceEndDate: persons.sentenceEndDate,
          organizationId: persons.organizationId,
          organizationName: organizations.name,
          userId: persons.userId,
          username: users.username,
          createdAt: persons.createdAt,
        })
        .from(persons)
        .leftJoin(organizations, eq(persons.organizationId, organizations.id))
        .leftJoin(users, eq(persons.userId, users.id))
        .orderBy(asc(persons.createdAt)),
      db
        .select({
          userId: profileRecords.userId,
          status: profileRecords.status,
        })
        .from(profileRecords),
    ])
    return success(
      data.map((person) => {
        const archiveRecords = records.filter(
          (record) => record.userId === person.userId,
        )
        return {
          ...person,
          archiveRecordCount: archiveRecords.length,
          archiveStatus: getArchiveStatus(
            archiveRecords.map((record) => record.status),
          ),
        }
      }),
    )
  } catch (error) {
    console.error("[API admin/persons GET]", error)
    return failure("INTERNAL_ERROR", "服务器错误", 500)
  }
}

function getArchiveStatus(statuses: string[]) {
  if (!statuses.length) return "UNFILLED"
  if (statuses.every((status) => status === "LOCKED")) return "LOCKED"
  if (statuses.some((status) => status === "PENDING_REVIEW"))
    return "PENDING_REVIEW"
  if (statuses.some((status) => status === "RETURNED")) return "RETURNED"
  return "DRAFT"
}

export async function POST(request: NextRequest) {
  const actor = await getAdminUser()
  if (!actor) return failure("FORBIDDEN", "仅管理员可管理人员", 403)
  const parsed = PersonSchema.safeParse(await request.json())
  if (!parsed.success)
    return failure(
      "VALIDATION_ERROR",
      JSON.stringify(parsed.error.flatten().fieldErrors),
      400,
    )
  if (parsed.data.custodyStatus === "ISOLATION")
    return failure("VALIDATION_ERROR", "禁闭状态只能由周度积分结算触发", 400)
  try {
    const [organization] = parsed.data.organizationId
      ? await db
          .select({ category: organizations.category })
          .from(organizations)
          .where(eq(organizations.id, parsed.data.organizationId))
          .limit(1)
      : [undefined]
    if (parsed.data.personType === "SUPERVISED") {
      const organizationError = validatePersonOrganizationAssignment(
        (organization?.category ?? null) as OrganizationCategory | null,
      )
      if (organizationError)
        return failure("VALIDATION_ERROR", organizationError, 400)
    }
    const [created] = await db
      .insert(persons)
      .values({
        ...parsed.data,
        gender: parsed.data.gender ?? null,
        age: parsed.data.age ?? null,
        prisonerNumber: parsed.data.prisonerNumber ?? null,
        customNumber: parsed.data.customNumber ?? null,
        treatmentLevel: parsed.data.treatmentLevel ?? null,
        nativePlace: parsed.data.nativePlace ?? null,
        level: parsed.data.level ?? null,
        evaluation: parsed.data.evaluation ?? null,
        chargeName: parsed.data.chargeName ?? null,
        sentenceStartDate: parsed.data.sentenceStartDate ?? null,
        sentenceEndDate: parsed.data.sentenceEndDate ?? null,
        custodyLevel: parsed.data.custodyLevel,
        custodyStatus: parsed.data.custodyStatus,
        remark: parsed.data.remark ?? null,
        organizationId: parsed.data.organizationId ?? null,
        userId: parsed.data.userId ?? null,
      })
      .returning()
    if (!created) return failure("INTERNAL_ERROR", "创建人员失败", 500)
    await writeAuditLog({
      actor,
      action: "CREATE",
      actionLabel: "创建人员",
      entityType: "person",
      entityId: created.id,
      detail: { name: created.name },
    })
    return success(created, { status: 201 })
  } catch (error) {
    const code =
      typeof error === "object" && error && "code" in error ? error.code : null
    if (code === "23505")
      return failure("CONFLICT", "人员账号或编号已被占用", 409)
    console.error("[API admin/persons POST]", error)
    return failure("INTERNAL_ERROR", "服务器错误", 500)
  }
}
