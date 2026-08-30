import { and, eq } from "drizzle-orm"
import { NextRequest } from "next/server"

import { failure, success } from "@/lib/api-response"
import { writeAuditLog } from "@/lib/audit"
import { clearMfaTrustedDeviceCookie } from "@/lib/auth-cookie"
import { DisableMfaSchema } from "@/lib/auth-schemas"
import { db } from "@/lib/db"
import { mfaFactors, mfaRecoveryCodes, users } from "@/lib/db/schema"
import { decryptMfaSecret, verifyTotpCode } from "@/lib/mfa"
import {
  consumeRecoveryCodeInTransaction,
  revokeTrustedDevicesInTransaction,
} from "@/lib/mfa-server"
import { getSessionUser } from "@/lib/session"
import { verifyPassword } from "@/lib/auth"
import {
  clearSensitiveActionFailures,
  getSensitiveActionIp,
  getSensitiveActionRetryAfterSeconds,
  recordSensitiveActionFailure,
} from "@/lib/sensitive-action-rate-limit"

export const runtime = "nodejs"

export async function POST(request: NextRequest) {
  try {
    const sessionUser = await getSessionUser()
    if (!sessionUser) return failure("UNAUTHORIZED", "未登录", 401)
    const ip = getSensitiveActionIp(request.headers)
    const retryAfter = await getSensitiveActionRetryAfterSeconds(sessionUser.id, ip)
    if (retryAfter > 0)
      return failure("RATE_LIMITED", `尝试过于频繁，请在 ${retryAfter} 秒后重试`, 429)
    const parsed = DisableMfaSchema.safeParse(await request.json())
    if (!parsed.success)
      return failure("VALIDATION_ERROR", "请填写当前密码和验证代码", 400)
    const [user] = await db
      .select({ passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.id, sessionUser.id))
      .limit(1)
    if (!user) return failure("NOT_FOUND", "用户不存在", 404)
    if (!(await verifyPassword(parsed.data.password, user.passwordHash))) {
      await recordSensitiveActionFailure(sessionUser.id, ip)
      return failure("VALIDATION_ERROR", "当前密码不正确", 400)
    }
    const result = await db.transaction(async (tx) => {
      const [factor] = await tx
        .select()
        .from(mfaFactors)
        .where(
          and(
            eq(mfaFactors.userId, sessionUser.id),
            eq(mfaFactors.enabled, true),
          ),
        )
        .limit(1)
        .for("update")
      if (!factor) return "missing" as const
      const verifiedByTotp = verifyTotpCode(
        decryptMfaSecret(factor.secretEncrypted),
        parsed.data.code,
      )
      const verified =
        verifiedByTotp ||
        (await consumeRecoveryCodeInTransaction(
          tx,
          factor.id,
          parsed.data.code,
        ))
      if (!verified) return "invalid" as const
      await tx
        .delete(mfaRecoveryCodes)
        .where(eq(mfaRecoveryCodes.factorId, factor.id))
      await tx.delete(mfaFactors).where(eq(mfaFactors.id, factor.id))
      await revokeTrustedDevicesInTransaction(tx, sessionUser.id)
      await writeAuditLog(
        {
          actor: sessionUser,
          action: "MFA_DISABLE",
          actionLabel: "关闭双重验证",
          entityType: "mfa_factor",
          entityId: factor.id,
        },
        tx,
      )
      return "disabled" as const
    })
    if (result === "missing") return failure("NOT_FOUND", "双重验证未启用", 404)
    if (result === "invalid") {
      await recordSensitiveActionFailure(sessionUser.id, ip)
      return failure("VALIDATION_ERROR", "验证器代码或恢复码不正确", 400)
    }
    await clearSensitiveActionFailures(sessionUser.id, ip)
    const response = success({ disabled: true })
    clearMfaTrustedDeviceCookie(response)
    return response
  } catch (error) {
    console.error("[API auth/mfa/disable POST]", error)
    return failure("INTERNAL_ERROR", "关闭双重验证失败", 500)
  }
}
