import { and, eq } from "drizzle-orm"
import { NextRequest } from "next/server"
import { z } from "zod"

import { failure, success } from "@/lib/api-response"
import { getAdminUser } from "@/lib/admin-api"
import { writeAuditLog } from "@/lib/audit"
import type { OrganizationCategory, Role } from "@/lib/constants"
import { db } from "@/lib/db"
import { organizations, users } from "@/lib/db/schema"
import { validateUserOrganizationAssignment } from "@/lib/organization-assignment"

const AssignSchema = z.object({ userId: z.string().uuid() })
type RouteContext = { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, { params }: RouteContext) {
  const actor = await getAdminUser()
  if (!actor) return failure("FORBIDDEN", "仅管理员可分配用户", 403)
  const { id } = await params
  if (!z.string().uuid().safeParse(id).success)
    return failure("VALIDATION_ERROR", "组织参数无效", 400)
  const parsed = AssignSchema.safeParse(await request.json())
  if (!parsed.success) return failure("VALIDATION_ERROR", "用户参数无效", 400)
  try {
    const [organization] = await db
      .select({ id: organizations.id, category: organizations.category })
      .from(organizations)
      .where(eq(organizations.id, id))
      .limit(1)
    if (!organization) return failure("NOT_FOUND", "组织不存在", 404)
    const result = await db.transaction(async (tx) => {
      const [target] = await tx
        .select({ id: users.id, role: users.role })
        .from(users)
        .where(eq(users.id, parsed.data.userId))
        .limit(1)
      if (!target) return { error: "用户不存在" as const, status: 404 }
      const assignmentError = validateUserOrganizationAssignment(
        target.role as Role,
        (organization.category ?? null) as OrganizationCategory | null,
      )
      if (assignmentError) return { error: assignmentError, status: 400 }
      const [row] = await tx
        .update(users)
        .set({ organizationId: id, updatedAt: new Date() })
        .where(eq(users.id, parsed.data.userId))
        .returning({
          id: users.id,
          username: users.username,
          name: users.name,
          role: users.role,
          status: users.status,
          organizationId: users.organizationId,
        })
      if (!row) return { error: "用户不存在" as const, status: 404 }
      await writeAuditLog(
        {
          actor,
          action: "ASSIGN",
          actionLabel: "分配组织用户",
          entityType: "user",
          entityId: row.id,
          detail: { organizationId: id },
        },
        tx,
      )
      return { member: row }
    })
    if ("error" in result)
      return failure(
        result.status === 404 ? "NOT_FOUND" : "VALIDATION_ERROR",
        result.error,
        result.status,
      )
    return success(result.member)
  } catch (error) {
    console.error("[API admin/orgs users POST]", error)
    return failure("INTERNAL_ERROR", "服务器错误", 500)
  }
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  const actor = await getAdminUser()
  if (!actor) return failure("FORBIDDEN", "仅管理员可分配用户", 403)
  const { id } = await params
  if (!z.string().uuid().safeParse(id).success)
    return failure("VALIDATION_ERROR", "组织参数无效", 400)
  const userId = request.nextUrl.searchParams.get("userId")
  if (!userId || !z.string().uuid().safeParse(userId).success)
    return failure("VALIDATION_ERROR", "用户参数无效", 400)
  try {
    const removed = await db.transaction(async (tx) => {
      // 必须同时匹配组织与用户，避免用任意组织 id 解除其他组织成员的归属。
      const [row] = await tx
        .update(users)
        .set({ organizationId: null, updatedAt: new Date() })
        .where(and(eq(users.id, userId), eq(users.organizationId, id)))
        .returning({ id: users.id })
      if (!row) return null
      await writeAuditLog(
        {
          actor,
          action: "UNASSIGN",
          actionLabel: "移出组织用户",
          entityType: "user",
          entityId: userId,
          detail: { organizationId: id },
        },
        tx,
      )
      return row
    })
    if (!removed) return failure("NOT_FOUND", "未找到该组织成员", 404)
    return success({ id: userId })
  } catch (error) {
    console.error("[API admin/orgs users DELETE]", error)
    return failure("INTERNAL_ERROR", "服务器错误", 500)
  }
}
