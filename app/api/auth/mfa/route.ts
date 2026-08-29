import { and, desc, eq, gt, isNull } from "drizzle-orm"

import { failure, success } from "@/lib/api-response"
import { db } from "@/lib/db"
import { mfaFactors, mfaTrustedDevices } from "@/lib/db/schema"
import { getSessionUser } from "@/lib/session"

export const runtime = "nodejs"

export async function GET() {
  try {
    const user = await getSessionUser()
    if (!user) return failure("UNAUTHORIZED", "未登录", 401)
    const [factor] = await db
      .select({
        enabled: mfaFactors.enabled,
        verifiedAt: mfaFactors.verifiedAt,
      })
      .from(mfaFactors)
      .where(eq(mfaFactors.userId, user.id))
      .limit(1)
    const devices = await db
      .select({
        id: mfaTrustedDevices.id,
        label: mfaTrustedDevices.label,
        ip: mfaTrustedDevices.ip,
        createdAt: mfaTrustedDevices.createdAt,
        lastUsedAt: mfaTrustedDevices.lastUsedAt,
        expiresAt: mfaTrustedDevices.expiresAt,
      })
      .from(mfaTrustedDevices)
      .where(
        and(
          eq(mfaTrustedDevices.userId, user.id),
          isNull(mfaTrustedDevices.revokedAt),
          gt(mfaTrustedDevices.expiresAt, new Date()),
        ),
      )
      .orderBy(desc(mfaTrustedDevices.lastUsedAt))
    return success({
      enabled: factor?.enabled === true,
      verifiedAt: factor?.verifiedAt ?? null,
      devices,
    })
  } catch (error) {
    console.error("[API auth/mfa GET]", error)
    return failure("INTERNAL_ERROR", "读取双重验证状态失败", 500)
  }
}
