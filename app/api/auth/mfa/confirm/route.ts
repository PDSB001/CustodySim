import { and, eq } from "drizzle-orm"
import { NextRequest } from "next/server"

import { failure, success } from "@/lib/api-response"
import { writeAuditLog } from "@/lib/audit"
import { MfaCodeSchema } from "@/lib/auth-schemas"
import { db } from "@/lib/db"
import {
  mfaFactors,
  mfaRecoveryCodes,
  users,
  mfaLoginChallenges,
} from "@/lib/db/schema"
import {
  decryptMfaSecret,
  generateRecoveryCodes,
  hashRecoveryCode,
  matchTotpStep,
} from "@/lib/mfa"
import { getSessionUser } from "@/lib/session"
import { signToken } from "@/lib/auth"
import { setAuthCookie, clearMfaTrustedDeviceCookie } from "@/lib/auth-cookie"
import { revokeTrustedDevicesInTransaction } from "@/lib/mfa-server"
import { queueSecurityNotice } from "@/lib/security-mail-server"
import {
  getSensitiveActionIp,
  getSensitiveActionRetryAfterSeconds,
  recordSensitiveActionFailure,
} from "@/lib/sensitive-action-rate-limit"

export const runtime = "nodejs"

export async function POST(request: NextRequest) {
  try {
    const user = await getSessionUser()
    if (!user) return failure("UNAUTHORIZED", "未登录", 401)
    const ip = getSensitiveActionIp(request.headers)
    if ((await getSensitiveActionRetryAfterSeconds(user.id, ip)) > 0)
      return failure("RATE_LIMITED", "尝试过于频繁，请稍后重试", 429)
    const parsed = MfaCodeSchema.safeParse(await request.json())
    if (!parsed.success)
      return failure("VALIDATION_ERROR", "请输入 6 位验证器代码", 400)
    const [factor] = await db
      .select()
      .from(mfaFactors)
      .where(eq(mfaFactors.userId, user.id))
      .limit(1)
    if (!factor || factor.enabled)
      return failure("CONFLICT", "没有待确认的验证器设置", 409)
    const step = matchTotpStep(
      decryptMfaSecret(factor.secretEncrypted),
      parsed.data.code,
    )
    if (step === null) {
      await recordSensitiveActionFailure(user.id, ip)
      return failure("VALIDATION_ERROR", "验证器代码不正确或已过期", 400)
    }
    const recoveryCodes = generateRecoveryCodes()
    const now = new Date()
    const enabled = await db.transaction(async (tx) => {
      const [account] = await tx
        .select()
        .from(users)
        .where(eq(users.id, user.id))
        .for("update")
      if (
        !account ||
        account.status !== "active" ||
        account.tokenVersion !== factor.setupTokenVersion ||
        matchTotpStep(
          decryptMfaSecret(factor.secretEncrypted),
          parsed.data.code,
        ) !== step ||
        account.role !== user.role ||
        account.mustChangePassword
      )
        return false
      const [updated] = await tx
        .update(mfaFactors)
        .set({
          enabled: true,
          verifiedAt: now,
          updatedAt: now,
          lastUsedStep: step,
        })
        .where(
          and(
            eq(mfaFactors.id, factor.id),
            eq(mfaFactors.enabled, false),
            eq(mfaFactors.secretEncrypted, factor.secretEncrypted),
          ),
        )
        .returning({ id: mfaFactors.id })
      if (!updated) return false
      await tx
        .delete(mfaRecoveryCodes)
        .where(eq(mfaRecoveryCodes.factorId, factor.id))
      await tx.insert(mfaRecoveryCodes).values(
        recoveryCodes.map((code) => ({
          factorId: factor.id,
          codeHash: hashRecoveryCode(code),
        })),
      )
      await writeAuditLog(
        {
          actor: user,
          action: "MFA_ENABLE",
          actionLabel: "启用双重验证",
          entityType: "mfa_factor",
          entityId: factor.id,
        },
        tx,
      )
      await tx
        .update(users)
        .set({ tokenVersion: account.tokenVersion + 1 })
        .where(eq(users.id, user.id))
      await revokeTrustedDevicesInTransaction(tx, user.id)
      await tx
        .delete(mfaLoginChallenges)
        .where(eq(mfaLoginChallenges.userId, user.id))
      await queueSecurityNotice(
        tx,
        user.id,
        "账号已启用验证器双重验证；如非本人操作，请联系管理员。",
      )
      return account.tokenVersion + 1
    })
    if (!enabled)
      return failure("CONFLICT", "验证器设置已发生变化，请重新开始配置", 409)
    const response = success({ recoveryCodes })
    setAuthCookie(
      response,
      await signToken({
        userId: user.id,
        tokenVersion: enabled,
        role: user.role,
      }),
    )
    clearMfaTrustedDeviceCookie(response)
    return response
  } catch (error) {
    console.error("[API auth/mfa/confirm POST]", error)
    return failure("INTERNAL_ERROR", "启用双重验证失败", 500)
  }
}
