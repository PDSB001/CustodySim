import { asc, eq } from "drizzle-orm"
import { NextRequest } from "next/server"
import { z } from "zod"

import { getAdminUser } from "@/lib/admin-api"
import { ArchiveBoxSchema } from "@/lib/admin-schemas"
import { failure, success } from "@/lib/api-response"
import { writeAuditLog } from "@/lib/audit"
import { db } from "@/lib/db"
import { archiveBoxes, persons } from "@/lib/db/schema"

const ParamsSchema = z.object({ id: z.string().uuid() })
type RouteContext = { params: Promise<{ id: string }> }

export async function GET(_: Request, context: RouteContext) {
  if (!(await getAdminUser()))
    return failure("FORBIDDEN", "仅管理员可查看档案盒", 403)
  const params = ParamsSchema.safeParse(await context.params)
  if (!params.success) return failure("VALIDATION_ERROR", "参数不合法", 400)
  return success(
    await db
      .select()
      .from(archiveBoxes)
      .where(eq(archiveBoxes.personId, params.data.id))
      .orderBy(asc(archiveBoxes.createdAt)),
  )
}

export async function POST(request: NextRequest, context: RouteContext) {
  const actor = await getAdminUser()
  if (!actor) return failure("FORBIDDEN", "仅管理员可管理档案盒", 403)
  const [params, parsed] = await Promise.all([
    context.params.then((value) => ParamsSchema.safeParse(value)),
    request.json().then((value: unknown) => ArchiveBoxSchema.safeParse(value)),
  ])
  if (!params.success || !parsed.success)
    return failure("VALIDATION_ERROR", "档案盒参数不合法", 400)
  try {
    const [person] = await db
      .select({ id: persons.id })
      .from(persons)
      .where(eq(persons.id, params.data.id))
      .limit(1)
    if (!person) return failure("NOT_FOUND", "人员不存在", 404)
    const [created] = await db
      .insert(archiveBoxes)
      .values({
        personId: person.id,
        ...parsed.data,
        remark: parsed.data.remark ?? null,
      })
      .returning()
    if (!created) return failure("INTERNAL_ERROR", "创建档案盒失败", 500)
    await writeAuditLog({
      actor,
      action: "CREATE",
      actionLabel: "创建人员档案盒",
      entityType: "archive_box",
      entityId: created.id,
      detail: { personId: person.id, name: created.name },
    })
    return success(created, { status: 201 })
  } catch (error) {
    const code =
      typeof error === "object" && error && "code" in error ? error.code : null
    if (code === "23505")
      return failure("CONFLICT", "该人员已有同名档案盒", 409)
    console.error("[API admin/persons/boxes POST]", error)
    return failure("INTERNAL_ERROR", "服务器错误", 500)
  }
}
