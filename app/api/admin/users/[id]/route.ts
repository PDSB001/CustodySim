import { eq } from "drizzle-orm"
import { NextRequest } from "next/server"
import { z } from "zod"

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
  if (!z.string().uuid().safeParse(id).success)
    return failure("VALIDATION_ERROR", "用户 ID 不合法", 400)
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
          .select({
            category: organizations.category,
            name: organizations.name,
          })
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
    const updated = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(users)
        .set({
          ...parsed.data,
          organizationId: parsed.data.organizationId ?? null,
          phone: parsed.data.phone ?? null,
          updatedAt: new Date(),
        })
        .where(eq(users.id, id))
        .returning({
          id: users.id,
          username: users.username,
          name: users.name,
          role: users.role,
          status: users.status,
          mustChangePassword: users.mustChangePassword,
          phone: users.phone,
          organizationId: users.organizationId,
          createdAt: users.createdAt,
        })
      if (!row) return null
      await writeAuditLog(
        {
          actor,
          action: "UPDATE",
          actionLabel: "编辑用户",
          entityType: "user",
          entityId: id,
          detail: { username: row.username },
        },
        tx,
      )
      return row
    })
    if (!updated) return failure("NOT_FOUND", "用户不存在", 404)
    return success({
      ...updated,
      organizationName: organization?.name ?? null,
    })
  } catch (error) {
    console.error("[API admin/users PATCH]", error)
    return failure("INTERNAL_ERROR", "服务器错误", 500)
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteContext) {
  const actor = await getAdminUser()
  if (!actor) return failure("FORBIDDEN", "仅管理员可管理用户", 403)
  const { id } = await params
  if (!z.string().uuid().safeParse(id).success)
    return failure("VALIDATION_ERROR", "用户 ID 不合法", 400)
  if (id === actor.id)
    return failure("VALIDATION_ERROR", "不能删除当前登录账号", 400)
  try {
    const deleted = await db.transaction(async (tx) => {
      // persons.user_id 为级联删除，删号会一并移除其在押人员档案及其附属记录。
      const [row] = await tx
        .delete(users)
        .where(eq(users.id, id))
        .returning({
          id: users.id,
          username: users.username,
          name: users.name,
          role: users.role,
        })
      if (!row) return null
      await writeAuditLog(
        {
          actor,
          action: "DELETE",
          actionLabel: "删除用户",
          entityType: "user",
          entityId: id,
          detail: { username: row.username, name: row.name, role: row.role },
        },
        tx,
      )
      return row
    })
    if (!deleted) return failure("NOT_FOUND", "用户不存在", 404)
    return success({ id })
  } catch (error) {
    const code =
      typeof error === "object" && error && "code" in error ? error.code : null
    // 业务历史（任务、打卡、积分、档案记录、会签等）为保留留痕会阻止删除。
    if (code === "23503")
      return failure(
        "CONFLICT",
        "该账户已有任务、打卡、积分或档案记录，为保留留痕不能删除；请改为停用该账户。",
        409,
      )
    console.error("[API admin/users DELETE]", error)
    return failure("INTERNAL_ERROR", "服务器错误", 500)
  }
}
