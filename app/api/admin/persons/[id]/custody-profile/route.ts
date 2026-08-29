import { eq } from "drizzle-orm"
import { NextRequest } from "next/server"

import { getAdminUser } from "@/lib/admin-api"
import { CustodyProfileSchema } from "@/lib/admin-schemas"
import { failure, success } from "@/lib/api-response"
import { writeAuditLog } from "@/lib/audit"
import { db } from "@/lib/db"
import { persons } from "@/lib/db/schema"

type RouteContext = { params: Promise<{ id: string }> }

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const actor = await getAdminUser()
  if (!actor) return failure("FORBIDDEN", "仅管理员可调整监管档案", 403)
  const parsed = CustodyProfileSchema.safeParse(await request.json())
  if (!parsed.success)
    return failure("VALIDATION_ERROR", "监管级别或囚犯状态不合法", 400)
  const { id } = await params
  const [current] = await db
    .select({ custodyStatus: persons.custodyStatus })
    .from(persons)
    .where(eq(persons.id, id))
    .limit(1)
  if (!current) return failure("NOT_FOUND", "人员不存在", 404)
  if (
    current.custodyStatus === "ISOLATION" ||
    parsed.data.custodyStatus === "ISOLATION"
  )
    return failure("CONFLICT", "禁闭状态由积分系统统一控制", 409)
  const [updated] = await db
    .update(persons)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(persons.id, id))
    .returning()
  if (!updated) return failure("NOT_FOUND", "人员不存在", 404)
  await writeAuditLog({
    actor,
    action: "UPDATE",
    actionLabel: "调整监管级别与囚犯状态",
    entityType: "person",
    entityId: id,
    detail: parsed.data,
  })
  return success(updated)
}
