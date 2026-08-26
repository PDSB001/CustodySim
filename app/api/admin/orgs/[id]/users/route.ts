import { eq } from "drizzle-orm"
import { NextRequest } from "next/server"
import { z } from "zod"

import { failure, success } from "@/lib/api-response"
import { getAdminUser } from "@/lib/admin-api"
import { writeAuditLog } from "@/lib/audit"
import { db } from "@/lib/db"
import { organizations, users } from "@/lib/db/schema"

const AssignSchema = z.object({ userId: z.string().uuid() })
type RouteContext = { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, { params }: RouteContext) {
  const actor = await getAdminUser()
  if (!actor) return failure("FORBIDDEN", "仅管理员可分配用户", 403)
  const { id } = await params
  const parsed = AssignSchema.safeParse(await request.json())
  if (!parsed.success) return failure("VALIDATION_ERROR", "用户参数无效", 400)
  const [organization] = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.id, id))
    .limit(1)
  if (!organization) return failure("NOT_FOUND", "组织不存在", 404)
  const [updated] = await db
    .update(users)
    .set({ organizationId: id, updatedAt: new Date() })
    .where(eq(users.id, parsed.data.userId))
    .returning()
  if (!updated) return failure("NOT_FOUND", "用户不存在", 404)
  await writeAuditLog({
    actor,
    action: "ASSIGN",
    actionLabel: "分配组织用户",
    entityType: "user",
    entityId: updated.id,
    detail: { organizationId: id },
  })
  return success(updated)
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  const actor = await getAdminUser()
  if (!actor) return failure("FORBIDDEN", "仅管理员可分配用户", 403)
  const { id } = await params
  const userId = request.nextUrl.searchParams.get("userId")
  if (!userId || !z.string().uuid().safeParse(userId).success)
    return failure("VALIDATION_ERROR", "用户参数无效", 400)
  const [member] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  if (!member) return failure("NOT_FOUND", "用户不存在", 404)
  const [updated] = await db
    .update(users)
    .set({ organizationId: null, updatedAt: new Date() })
    .where(eq(users.id, userId))
    .returning()
  if (!updated) return failure("NOT_FOUND", "未找到该组织成员", 404)
  await writeAuditLog({
    actor,
    action: "UNASSIGN",
    actionLabel: "移出组织用户",
    entityType: "user",
    entityId: userId,
    detail: { organizationId: id },
  })
  return success({ id: userId })
}
