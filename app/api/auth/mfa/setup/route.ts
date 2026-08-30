import { and, eq } from "drizzle-orm"
import { NextRequest } from "next/server"

import { failure, success } from "@/lib/api-response"
import { writeAuditLog } from "@/lib/audit"
import { verifyPassword } from "@/lib/auth"
import { MfaSetupSchema } from "@/lib/auth-schemas"
import { db } from "@/lib/db"
import { mfaFactors, users } from "@/lib/db/schema"
import { encryptMfaSecret, generateTotpSecret } from "@/lib/mfa"
import { getSessionUser } from "@/lib/session"
import {
  clearSensitiveActionFailures,
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
    const retryAfter = await getSensitiveActionRetryAfterSeconds(user.id, ip)
    if (retryAfter > 0)
      return failure("RATE_LIMITED", `尝试过于频繁，请在 ${retryAfter} 秒后重试`, 429)
    const parsed = MfaSetupSchema.safeParse(await request.json())
    if (!parsed.success)
      return failure("VALIDATION_ERROR", "请输入当前密码", 400)
    const [account] = await db
      .select({ passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1)
    if (
      !account ||
      !(await verifyPassword(parsed.data.password, account.passwordHash))
    ) {
      await recordSensitiveActionFailure(user.id, ip)
      return failure("VALIDATION_ERROR", "当前密码不正确", 400)
    }
    const [existing] = await db
      .select({ id: mfaFactors.id, enabled: mfaFactors.enabled })
      .from(mfaFactors)
      .where(eq(mfaFactors.userId, user.id))
      .limit(1)
    if (existing?.enabled) return failure("CONFLICT", "双重验证已启用", 409)

    const secret = generateTotpSecret()
    const now = new Date()
    const secretEncrypted = encryptMfaSecret(secret)
    const [factor] = await db.transaction(async (tx) => {
      const created = existing
        ? await tx
            .update(mfaFactors)
            .set({ secretEncrypted, verifiedAt: null, updatedAt: now })
            .where(
              and(
                eq(mfaFactors.id, existing.id),
                eq(mfaFactors.enabled, false),
              ),
            )
            .returning({ id: mfaFactors.id })
        : await tx
            .insert(mfaFactors)
            .values({ userId: user.id, secretEncrypted })
            .returning({ id: mfaFactors.id })
      const pendingFactor = created[0]
      if (!pendingFactor) return []
      await writeAuditLog(
        {
          actor: user,
          action: "MFA_SETUP",
          actionLabel: "开始配置双重验证",
          entityType: "mfa_factor",
          entityId: pendingFactor.id,
        },
        tx,
      )
      return [pendingFactor]
    })
    if (!factor) return failure("INTERNAL_ERROR", "创建验证器设置失败", 500)
    await clearSensitiveActionFailures(user.id, ip)
    const issuer = "CustodySim"
    const accountName = `${issuer}:${user.username}`
    return success({
      secret,
      otpauthUri: `otpauth://totp/${encodeURIComponent(accountName)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`,
    })
  } catch (error) {
    console.error("[API auth/mfa/setup POST]", error)
    return failure("INTERNAL_ERROR", "开始配置双重验证失败", 500)
  }
}
