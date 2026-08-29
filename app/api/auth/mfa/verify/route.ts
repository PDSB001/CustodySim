import { and, eq } from "drizzle-orm"
import { NextRequest } from "next/server"

import { failure, success } from "@/lib/api-response"
import { signToken, verifyMfaChallenge } from "@/lib/auth"
import {
  clearMfaChallengeCookie,
  setAuthCookie,
  setMfaTrustedDeviceCookie,
} from "@/lib/auth-cookie"
import { MfaVerificationSchema, SessionUserSchema } from "@/lib/auth-schemas"
import { getRequestIp } from "@/lib/admin-api"
import { db } from "@/lib/db"
import { mfaFactors, mfaTrustedDevices, users } from "@/lib/db/schema"
import { writeLoginLog } from "@/lib/login-log-server"
import {
  clearLoginFailures,
  getLoginRetryAfterSeconds,
  recordLoginFailure,
} from "@/lib/login-rate-limit"
import {
  decryptMfaSecret,
  generateTrustedDeviceToken,
  hashTrustedDeviceToken,
  verifyTotpCode,
} from "@/lib/mfa"
import { consumeRecoveryCodeInTransaction } from "@/lib/mfa-server"
import {
  MFA_CHALLENGE_COOKIE_NAME,
  MFA_TRUSTED_DEVICE_TTL_SECONDS,
} from "@/lib/constants"

export const runtime = "nodejs"

export async function POST(request: NextRequest) {
  try {
    const challenge = await verifyMfaChallenge(
      request.cookies.get(MFA_CHALLENGE_COOKIE_NAME)?.value ?? "",
    )
    if (!challenge)
      return failure("UNAUTHORIZED", "验证已过期，请重新登录", 401)
    const parsed = MfaVerificationSchema.safeParse(await request.json())
    if (!parsed.success)
      return failure("VALIDATION_ERROR", "请输入验证器代码或恢复码", 400)

    const ip = getRequestIp(request.headers)
    const retryAfterSeconds = await getLoginRetryAfterSeconds(
      `mfa:${challenge.userId}`,
      ip,
    )
    if (retryAfterSeconds > 0)
      return failure(
        "RATE_LIMITED",
        `验证尝试过于频繁，请在 ${retryAfterSeconds} 秒后重试`,
        429,
      )

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, challenge.userId))
      .limit(1)
    const [factor] = await db
      .select()
      .from(mfaFactors)
      .where(
        and(
          eq(mfaFactors.userId, challenge.userId),
          eq(mfaFactors.enabled, true),
        ),
      )
      .limit(1)
    if (
      !user ||
      user.status !== "active" ||
      user.tokenVersion !== challenge.tokenVersion ||
      !factor
    ) {
      await recordLoginFailure(`mfa:${challenge.userId}`, ip)
      return failure("UNAUTHORIZED", "验证状态无效，请重新登录", 401)
    }
    if (!["ADMIN", "SUPERVISOR", "SUPERVISED"].includes(user.role))
      return failure("INTERNAL_ERROR", "用户角色配置无效", 500)

    const sessionUser = SessionUserSchema.parse({
      id: user.id,
      username: user.username,
      name: user.name,
      role: user.role,
      organizationId: user.organizationId,
      mustChangePassword: user.mustChangePassword,
    })
    const signedToken = await signToken({
      userId: user.id,
      tokenVersion: user.tokenVersion,
      role: sessionUser.role,
    })
    const code = parsed.data.code
    const verifiedByTotp = verifyTotpCode(
      decryptMfaSecret(factor.secretEncrypted),
      code,
    )
    const trustedDeviceToken = parsed.data.trustDevice
      ? generateTrustedDeviceToken()
      : null
    const verification = await db.transaction(async (tx) => {
      const verified =
        verifiedByTotp ||
        (await consumeRecoveryCodeInTransaction(tx, factor.id, code))
      if (!verified) return { verified: false, deviceId: null }
      if (!trustedDeviceToken) return { verified: true, deviceId: null }
      const expiresAt = new Date(
        Date.now() + MFA_TRUSTED_DEVICE_TTL_SECONDS * 1000,
      )
      const [device] = await tx
        .insert(mfaTrustedDevices)
        .values({
          userId: user.id,
          tokenHash: hashTrustedDeviceToken(trustedDeviceToken),
          label: "受信任设备",
          ip,
          expiresAt,
        })
        .returning({ id: mfaTrustedDevices.id })
      return { verified: true, deviceId: device?.id ?? null }
    })
    if (!verification.verified) {
      await recordLoginFailure(`mfa:${challenge.userId}`, ip)
      return failure("VALIDATION_ERROR", "验证器代码或恢复码不正确", 400)
    }
    const response = success(sessionUser)
    setAuthCookie(response, signedToken)
    clearMfaChallengeCookie(response)
    if (trustedDeviceToken && verification.deviceId)
      setMfaTrustedDeviceCookie(
        response,
        `${verification.deviceId}.${trustedDeviceToken}`,
      )
    await Promise.all([
      clearLoginFailures(`mfa:${challenge.userId}`, ip),
      clearLoginFailures(user.username, ip),
    ]).catch((error) => console.error("[API auth/mfa/verify cleanup]", error))
    await writeLoginLog({
      userId: user.id,
      username: user.username,
      success: true,
      ip,
      userAgent: request.headers.get("user-agent"),
    }).catch(() => undefined)
    return response
  } catch (error) {
    console.error("[API auth/mfa/verify POST]", error)
    return failure("INTERNAL_ERROR", "双重验证失败", 500)
  }
}
