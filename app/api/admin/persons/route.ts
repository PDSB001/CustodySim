import { asc, count, eq, ilike, inArray, or } from "drizzle-orm"
import { NextRequest } from "next/server"

import { failure, success } from "@/lib/api-response"
import { getAdminUser } from "@/lib/admin-api"
import { PersonSchema } from "@/lib/admin-schemas"
import { writeAuditLog } from "@/lib/audit"
import { db } from "@/lib/db"
import { organizations, persons, profileRecords, users } from "@/lib/db/schema"
import { validatePersonOrganizationAssignment } from "@/lib/organization-assignment"
import type { OrganizationCategory } from "@/lib/constants"

import {
  PersonListQuerySchema,
  escapeLikeSearch,
  summarizePersonArchives,
} from "@/lib/person-list"

export async function GET(request: NextRequest) {
  const actor = await getAdminUser()
  if (!actor) return failure("FORBIDDEN", "仅管理员可查看人员", 403)
  const params = request.nextUrl.searchParams
  const paginated = ["page", "pageSize", "q"].some((key) => params.has(key))
  const parsed = PersonListQuerySchema.safeParse(Object.fromEntries(params))
  if (!parsed.success)
    return failure("VALIDATION_ERROR", "分页或搜索参数无效", 400)
  const { page: requestedPage, pageSize, q } = parsed.data
  try {
    const pattern = "%" + escapeLikeSearch(q) + "%"
    const where = q
      ? or(
          ilike(persons.name, pattern),
          ilike(persons.prisonerNumber, pattern),
          ilike(persons.customNumber, pattern),
          ilike(users.username, pattern),
        )
      : undefined
    const [totals] = paginated
      ? await db
          .select({ total: count() })
          .from(persons)
          .leftJoin(users, eq(persons.userId, users.id))
          .where(where)
      : []
    const total = totals?.total ?? 0
    const page = Math.min(
      requestedPage,
      Math.max(1, Math.ceil(total / pageSize)),
    )
    const query = db
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
      .where(where)
      .orderBy(asc(persons.createdAt), asc(persons.id))
      .$dynamic()
    const data = await (paginated
      ? query.limit(pageSize).offset((page - 1) * pageSize)
      : query)
    const userIds = data.flatMap((person) =>
      person.userId ? [person.userId] : [],
    )
    const records = userIds.length
      ? await db
          .select({
            userId: profileRecords.userId,
            status: profileRecords.status,
            count: count(),
          })
          .from(profileRecords)
          .where(inArray(profileRecords.userId, userIds))
          .groupBy(profileRecords.userId, profileRecords.status)
      : []
    const summaries = summarizePersonArchives(records)
    const items = data.map((person) => ({
      ...person,
      ...((person.userId ? summaries.get(person.userId) : undefined) ?? {
        archiveRecordCount: 0,
        archiveStatus: "UNFILLED",
      }),
    }))
    return success(paginated ? { items, total, page, pageSize } : items)
  } catch (error) {
    console.error("[API admin/persons GET]", error)
    return failure("INTERNAL_ERROR", "服务器错误", 500)
  }
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
