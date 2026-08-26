import { asc } from "drizzle-orm"
import { NextRequest } from "next/server"

import { failure, success } from "@/lib/api-response"
import { getAdminUser } from "@/lib/admin-api"
import { OrganizationSchema } from "@/lib/admin-schemas"
import { validateOrganizationPlacement } from "@/lib/org-hierarchy"
import { writeAuditLog } from "@/lib/audit"
import { db } from "@/lib/db"
import { organizations } from "@/lib/db/schema"

export async function GET() {
  const actor = await getAdminUser()
  if (!actor) return failure("FORBIDDEN", "仅管理员可查看组织", 403)
  try {
    return success(
      await db
        .select()
        .from(organizations)
        .orderBy(asc(organizations.sort), asc(organizations.name)),
    )
  } catch (error) {
    console.error("[API admin/orgs GET]", error)
    return failure("INTERNAL_ERROR", "服务器错误", 500)
  }
}

export async function POST(request: NextRequest) {
  const actor = await getAdminUser()
  if (!actor) return failure("FORBIDDEN", "仅管理员可管理组织", 403)
  const parsed = OrganizationSchema.safeParse(await request.json())
  if (!parsed.success)
    return failure(
      "VALIDATION_ERROR",
      JSON.stringify(parsed.error.flatten().fieldErrors),
      400,
    )
  try {
    const allOrganizations = await db.select().from(organizations)
    const placementError = validateOrganizationPlacement({
      organizations: allOrganizations,
      parentId: parsed.data.parentId ?? null,
      category: parsed.data.category,
    })
    if (placementError) return failure("VALIDATION_ERROR", placementError, 400)
    const [created] = await db
      .insert(organizations)
      .values({
        ...parsed.data,
        parentId: parsed.data.parentId ?? null,
        category: parsed.data.category,
      })
      .returning()
    if (!created) return failure("INTERNAL_ERROR", "创建组织失败", 500)
    await writeAuditLog({
      actor,
      action: "CREATE",
      actionLabel: "创建组织",
      entityType: "organization",
      entityId: created.id,
      detail: { name: created.name },
    })
    return success(created, { status: 201 })
  } catch (error) {
    console.error("[API admin/orgs POST]", error)
    return failure("INTERNAL_ERROR", "服务器错误", 500)
  }
}
