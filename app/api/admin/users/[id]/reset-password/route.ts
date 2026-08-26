import { eq } from "drizzle-orm"
import { NextRequest } from "next/server"

import { failure, success } from "@/lib/api-response"
import { getAdminUser } from "@/lib/admin-api"
import { ResetPasswordSchema } from "@/lib/admin-schemas"
import { writeAuditLog } from "@/lib/audit"
import { hashPassword } from "@/lib/auth"
import { db } from "@/lib/db"
import { users } from "@/lib/db/schema"
import { computePasswordMeta, validatePassword } from "@/lib/password-rule"

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, { params }: RouteContext) {
  const actor = await getAdminUser()
  if (!actor) return failure("FORBIDDEN", "仅管理员可重置密码", 403)
  const { id } = await params
  const parsed = ResetPasswordSchema.safeParse(await request.json())
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
    const [existing] = await db
      .select({ tokenVersion: users.tokenVersion, username: users.username })
      .from(users)
      .where(eq(users.id, id))
      .limit(1)
    if (!existing) return failure("NOT_FOUND", "用户不存在", 404)
    await db
      .update(users)
      .set({
        passwordHash: await hashPassword(parsed.data.password),
        passwordMeta: JSON.stringify(computePasswordMeta(parsed.data.password)),
        mustChangePassword: true,
        tokenVersion: existing.tokenVersion + 1,
        updatedAt: new Date(),
      })
      .where(eq(users.id, id))
    await writeAuditLog({
      actor,
      action: "RESET_PASSWORD",
      actionLabel: "重置用户密码",
      entityType: "user",
      entityId: id,
      detail: { username: existing.username },
    })
    return success({ id })
  } catch (error) {
    console.error("[API admin/users reset-password POST]", error)
    return failure("INTERNAL_ERROR", "服务器错误", 500)
  }
}
