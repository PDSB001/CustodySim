import { and, eq } from "drizzle-orm"
import { NextRequest } from "next/server"

import { failure, success } from "@/lib/api-response"
import { writeAuditLog } from "@/lib/audit"
import { MfaCodeSchema } from "@/lib/auth-schemas"
import { db } from "@/lib/db"
import { mfaFactors, mfaRecoveryCodes } from "@/lib/db/schema"
import {
  decryptMfaSecret,
  generateRecoveryCodes,
  hashRecoveryCode,
  verifyTotpCode,
} from "@/lib/mfa"
import { getSessionUser } from "@/lib/session"

export const runtime = "nodejs"

export async function POST(request: NextRequest) {
  try {
    const user = await getSessionUser()
    if (!user) return failure("UNAUTHORIZED", "未登录", 401)
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
    if (
      !verifyTotpCode(
        decryptMfaSecret(factor.secretEncrypted),
        parsed.data.code,
      )
    )
      return failure("VALIDATION_ERROR", "验证器代码不正确或已过期", 400)
    const recoveryCodes = generateRecoveryCodes()
    const now = new Date()
    const enabled = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(mfaFactors)
        .set({ enabled: true, verifiedAt: now, updatedAt: now })
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
      return true
    })
    if (!enabled)
      return failure("CONFLICT", "验证器设置已发生变化，请重新开始配置", 409)
    return success({ recoveryCodes })
  } catch (error) {
    console.error("[API auth/mfa/confirm POST]", error)
    return failure("INTERNAL_ERROR", "启用双重验证失败", 500)
  }
}
