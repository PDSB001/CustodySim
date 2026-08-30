import { eq } from "drizzle-orm"
import { NextRequest } from "next/server"

import { failure, success } from "@/lib/api-response"
import { writeAuditLog } from "@/lib/audit"
import { hashPassword, signToken, verifyPassword } from "@/lib/auth"
import { clearMfaTrustedDeviceCookie, setAuthCookie } from "@/lib/auth-cookie"
import { ChangePasswordSchema, SessionUserSchema } from "@/lib/auth-schemas"
import { db } from "@/lib/db"
import { users } from "@/lib/db/schema"
import { computePasswordMeta, validatePassword } from "@/lib/password-rule"
import { getSessionUser } from "@/lib/session"
import { revokeTrustedDevicesInTransaction } from "@/lib/mfa-server"
import {
  clearSensitiveActionFailures,
  getSensitiveActionIp,
  getSensitiveActionRetryAfterSeconds,
  recordSensitiveActionFailure,
} from "@/lib/sensitive-action-rate-limit"

export const runtime = "nodejs"

export async function POST(request: NextRequest) {
  try {
    const sessionUser = await getSessionUser({ allowPasswordChange: true })
    if (!sessionUser) return failure("UNAUTHORIZED", "未登录", 401)
    const ip = getSensitiveActionIp(request.headers)
    const retryAfter = await getSensitiveActionRetryAfterSeconds(sessionUser.id, ip)
    if (retryAfter > 0)
      return failure("RATE_LIMITED", `尝试过于频繁，请在 ${retryAfter} 秒后重试`, 429)
    const parsed = ChangePasswordSchema.safeParse(await request.json())
    if (!parsed.success)
      return failure(
        "VALIDATION_ERROR",
        JSON.stringify(parsed.error.flatten().fieldErrors),
        400,
      )

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, sessionUser.id))
      .limit(1)
    if (
      !user ||
      !(await verifyPassword(parsed.data.currentPassword, user.passwordHash))
    ) {
      await recordSensitiveActionFailure(sessionUser.id, ip)
      return failure("VALIDATION_ERROR", "当前密码不正确", 400)
    }
    const passwordCheck = validatePassword(parsed.data.newPassword)
    if (!passwordCheck.valid)
      return failure("VALIDATION_ERROR", passwordCheck.errors.join("；"), 400)
    if (await verifyPassword(parsed.data.newPassword, user.passwordHash))
      return failure("VALIDATION_ERROR", "新密码不能与当前密码相同", 400)
    const tokenVersion = user.tokenVersion + 1
    const passwordHash = await hashPassword(parsed.data.newPassword)
    const [updated] = await db.transaction(async (tx) => {
      const changed = await tx
        .update(users)
        .set({
          passwordHash,
          passwordMeta: JSON.stringify(
            computePasswordMeta(parsed.data.newPassword),
          ),
          mustChangePassword: false,
          tokenVersion,
          updatedAt: new Date(),
        })
        .where(eq(users.id, user.id))
        .returning()
      const changedUser = changed[0]
      if (!changedUser) return []
      await revokeTrustedDevicesInTransaction(tx, changedUser.id)
      await writeAuditLog(
        {
          actor: sessionUser,
          action: "CHANGE_PASSWORD",
          actionLabel: "修改本人密码",
          entityType: "user",
          entityId: changedUser.id,
        },
        tx,
      )
      return [changedUser]
    })
    if (
      !updated ||
      !["ADMIN", "SUPERVISOR", "SUPERVISED"].includes(updated.role)
    )
      return failure("INTERNAL_ERROR", "密码更新失败", 500)

    const safeUser = SessionUserSchema.parse({
      id: updated.id,
      username: updated.username,
      name: updated.name,
      role: updated.role,
      organizationId: updated.organizationId,
      mustChangePassword: updated.mustChangePassword,
    })
    const response = success(safeUser)
    setAuthCookie(
      response,
      await signToken({
        userId: updated.id,
        tokenVersion,
        role: safeUser.role,
      }),
    )
    clearMfaTrustedDeviceCookie(response)
    await clearSensitiveActionFailures(sessionUser.id, ip)
    return response
  } catch (error) {
    console.error("[API auth/change-password POST]", error)
    return failure("INTERNAL_ERROR", "服务器错误", 500)
  }
}
