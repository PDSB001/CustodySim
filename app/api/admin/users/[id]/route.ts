import { eq } from "drizzle-orm"
import { NextRequest } from "next/server"

import { failure, success } from "@/lib/api-response"
import { getAdminUser } from "@/lib/admin-api"
import { UserUpdateSchema } from "@/lib/admin-schemas"
import { writeAuditLog } from "@/lib/audit"
import { db } from "@/lib/db"
import { users } from "@/lib/db/schema"
import { organizations } from "@/lib/db/schema"
import { validateUserOrganizationAssignment } from "@/lib/organization-assignment"
import type { OrganizationCategory } from "@/lib/constants"

type RouteContext = { params: Promise<{ id: string }> }

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const actor = await getAdminUser()
  if (!actor) return failure("FORBIDDEN", "仅管理员可管理用户", 403)
  const { id } = await params
  const parsed = UserUpdateSchema.safeParse(await request.json())
  if (!parsed.success)
    return failure(
      "VALIDATION_ERROR",
      JSON.stringify(parsed.error.flatten().fieldErrors),
      400,
    )
  if (id === actor.id && parsed.data.status === "disabled")
    return failure("VALIDATION_ERROR", "不能停用当前登录账号", 400)
  try {
    const [organization] = parsed.data.organizationId
      ? await db
          .select({ category: organizations.category })
          .from(organizations)
          .where(eq(organizations.id, parsed.data.organizationId))
          .limit(1)
      : [undefined]
    const organizationError = validateUserOrganizationAssignment(
      parsed.data.role,
      (organization?.category ?? null) as OrganizationCategory | null,
    )
    if (organizationError)
      return failure("VALIDATION_ERROR", organizationError, 400)
    const [existing] = await db
      .select({ role: users.role })
      .from(users)
      .where(eq(users.id, id))
      .limit(1)
    if (!existing) return failure("NOT_FOUND", "用户不存在", 404)
    if (existing.role !== parsed.data.role)
      return failure(
        "VALIDATION_ERROR",
        "账号角色创建后不可直接修改，请新建正确角色账号以避免人员档案失配",
        400,
      )
    const [updated] = await db
      .update(users)
      .set({
        ...parsed.data,
        organizationId: parsed.data.organizationId ?? null,
        phone: parsed.data.phone ?? null,
        updatedAt: new Date(),
      })
      .where(eq(users.id, id))
      .returning()
    if (!updated) return failure("NOT_FOUND", "用户不存在", 404)
    await writeAuditLog({
      actor,
      action: "UPDATE",
      actionLabel: "编辑用户",
      entityType: "user",
      entityId: id,
      detail: { username: updated.username },
    })
    return success(updated)
  } catch (error) {
    console.error("[API admin/users PATCH]", error)
    return failure("INTERNAL_ERROR", "服务器错误", 500)
  }
}
