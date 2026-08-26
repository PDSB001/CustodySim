import { asc, eq } from "drizzle-orm"
import { NextRequest } from "next/server"

import { failure, success } from "@/lib/api-response"
import { getAdminUser } from "@/lib/admin-api"
import { UserCreateSchema } from "@/lib/admin-schemas"
import { writeAuditLog } from "@/lib/audit"
import { hashPassword } from "@/lib/auth"
import { db } from "@/lib/db"
import { organizations, persons, users } from "@/lib/db/schema"
import { computePasswordMeta, validatePassword } from "@/lib/password-rule"
import { validateUserOrganizationAssignment } from "@/lib/organization-assignment"
import type { OrganizationCategory } from "@/lib/constants"

export async function GET() {
  const actor = await getAdminUser()
  if (!actor) return failure("FORBIDDEN", "仅管理员可查看用户", 403)
  try {
    const data = await db
      .select({
        id: users.id,
        username: users.username,
        name: users.name,
        role: users.role,
        status: users.status,
        mustChangePassword: users.mustChangePassword,
        phone: users.phone,
        organizationId: users.organizationId,
        organizationName: organizations.name,
        createdAt: users.createdAt,
      })
      .from(users)
      .leftJoin(organizations, eq(users.organizationId, organizations.id))
      .orderBy(asc(users.createdAt))
    return success(data)
  } catch (error) {
    console.error("[API admin/users GET]", error)
    return failure("INTERNAL_ERROR", "服务器错误", 500)
  }
}

export async function POST(request: NextRequest) {
  const actor = await getAdminUser()
  if (!actor) return failure("FORBIDDEN", "仅管理员可管理用户", 403)
  const parsed = UserCreateSchema.safeParse(await request.json())
  if (!parsed.success)
    return failure(
      "VALIDATION_ERROR",
      JSON.stringify(parsed.error.flatten().fieldErrors),
      400,
    )
  const passwordCheck = validatePassword(parsed.data.password)
  if (!passwordCheck.valid)
    return failure("VALIDATION_ERROR", passwordCheck.errors.join("；"), 400)
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
    const [created] = await db
      .insert(users)
      .values({
        username: parsed.data.username,
        name: parsed.data.name,
        role: parsed.data.role,
        passwordHash: await hashPassword(parsed.data.password),
        passwordMeta: JSON.stringify(computePasswordMeta(parsed.data.password)),
        organizationId: parsed.data.organizationId ?? null,
        phone: parsed.data.phone ?? null,
        mustChangePassword: true,
      })
      .returning()
    if (!created) return failure("INTERNAL_ERROR", "创建用户失败", 500)
    if (created.role === "SUPERVISED")
      await db.insert(persons).values({
        name: created.name,
        personType: "SUPERVISED",
        organizationId: created.organizationId,
        userId: created.id,
        custodyLevel: "GENERAL",
        custodyStatus: "OUT_OF_CUSTODY",
      })
    await writeAuditLog({
      actor,
      action: "CREATE",
      actionLabel: "创建用户",
      entityType: "user",
      entityId: created.id,
      detail: {
        username: created.username,
        role: created.role,
        custodyStatus:
          created.role === "SUPERVISED" ? "OUT_OF_CUSTODY" : undefined,
      },
    })
    return success(created, { status: 201 })
  } catch (error) {
    const code =
      typeof error === "object" && error && "code" in error ? error.code : null
    if (code === "23505") return failure("CONFLICT", "用户名已存在", 409)
    console.error("[API admin/users POST]", error)
    return failure("INTERNAL_ERROR", "服务器错误", 500)
  }
}
