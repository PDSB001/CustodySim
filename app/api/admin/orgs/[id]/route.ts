import { eq } from "drizzle-orm"
import { NextRequest } from "next/server"

import { failure, success } from "@/lib/api-response"
import { getAdminUser } from "@/lib/admin-api"
import { OrganizationSchema } from "@/lib/admin-schemas"
import { validateOrganizationPlacement } from "@/lib/org-hierarchy"
import { writeAuditLog } from "@/lib/audit"
import { db } from "@/lib/db"
import { organizations, persons, users } from "@/lib/db/schema"

type RouteContext = { params: Promise<{ id: string }> }

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const actor = await getAdminUser()
  if (!actor) return failure("FORBIDDEN", "仅管理员可管理组织", 403)
  const { id } = await params
  const parsed = OrganizationSchema.safeParse(await request.json())
  if (!parsed.success)
    return failure(
      "VALIDATION_ERROR",
      JSON.stringify(parsed.error.flatten().fieldErrors),
      400,
    )
  if (parsed.data.parentId === id)
    return failure("VALIDATION_ERROR", "组织不能设置自身为上级", 400)
  try {
    const allOrganizations = await db.select().from(organizations)
    const byId = new Map(
      allOrganizations.map((organization) => [organization.id, organization]),
    )
    let parentId = parsed.data.parentId ?? null
    const seen = new Set<string>([id])
    while (parentId) {
      if (seen.has(parentId))
        return failure("VALIDATION_ERROR", "不能将组织移动到其下级组织", 400)
      seen.add(parentId)
      parentId = byId.get(parentId)?.parentId ?? null
    }
    const placementError = validateOrganizationPlacement({
      organizations: allOrganizations,
      parentId: parsed.data.parentId ?? null,
      category: parsed.data.category,
      selfId: id,
    })
    if (placementError) return failure("VALIDATION_ERROR", placementError, 400)
    const [updated] = await db
      .update(organizations)
      .set({
        ...parsed.data,
        parentId: parsed.data.parentId ?? null,
        category: parsed.data.category,
        updatedAt: new Date(),
      })
      .where(eq(organizations.id, id))
      .returning()
    if (!updated) return failure("NOT_FOUND", "组织不存在", 404)
    await writeAuditLog({
      actor,
      action: "UPDATE",
      actionLabel: "编辑组织",
      entityType: "organization",
      entityId: id,
      detail: { name: updated.name },
    })
    return success(updated)
  } catch (error) {
    console.error("[API admin/orgs PATCH]", error)
    return failure("INTERNAL_ERROR", "服务器错误", 500)
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteContext) {
  const actor = await getAdminUser()
  if (!actor) return failure("FORBIDDEN", "仅管理员可管理组织", 403)
  const { id } = await params
  try {
    const [child, member, person] = await Promise.all([
      db
        .select({ id: organizations.id })
        .from(organizations)
        .where(eq(organizations.parentId, id))
        .limit(1),
      db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.organizationId, id))
        .limit(1),
      db
        .select({ id: persons.id })
        .from(persons)
        .where(eq(persons.organizationId, id))
        .limit(1),
    ])
    if (child[0] || member[0] || person[0])
      return failure(
        "CONFLICT",
        "该组织仍有关联的下级、用户或人员，不能删除",
        409,
      )
    const [deleted] = await db
      .delete(organizations)
      .where(eq(organizations.id, id))
      .returning()
    if (!deleted) return failure("NOT_FOUND", "组织不存在", 404)
    await writeAuditLog({
      actor,
      action: "DELETE",
      actionLabel: "删除组织",
      entityType: "organization",
      entityId: id,
      detail: { name: deleted.name },
    })
    return success({ id })
  } catch (error) {
    console.error("[API admin/orgs DELETE]", error)
    return failure("INTERNAL_ERROR", "服务器错误", 500)
  }
}
