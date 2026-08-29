import { eq } from "drizzle-orm"
import { NextRequest } from "next/server"

import { success, failure } from "@/lib/api-response"
import { getRequestIp } from "@/lib/admin-api"
import { signMfaChallenge, signToken, verifyPassword } from "@/lib/auth"
import {
  clearMfaChallengeCookie,
  setAuthCookie,
  setMfaChallengeCookie,
} from "@/lib/auth-cookie"
import { LoginSchema, SessionUserSchema } from "@/lib/auth-schemas"
import { db } from "@/lib/db"
import { mfaFactors, users } from "@/lib/db/schema"
import { writeLoginLog } from "@/lib/login-log-server"
import {
  clearLoginFailures,
  getLoginRetryAfterSeconds,
  recordLoginFailure,
} from "@/lib/login-rate-limit"
import { getValidTrustedDevice } from "@/lib/mfa-server"
import { MFA_TRUSTED_DEVICE_COOKIE_NAME } from "@/lib/constants"

export const runtime = "nodejs"

export async function POST(request: NextRequest) {
  try {
    const parsed = LoginSchema.safeParse(await request.json())
    if (!parsed.success)
      return failure(
        "VALIDATION_ERROR",
        JSON.stringify(parsed.error.flatten().fieldErrors),
        400,
      )

    const ip = getRequestIp(request.headers)
    const retryAfterSeconds = await getLoginRetryAfterSeconds(
      parsed.data.username,
      ip,
    )
    if (retryAfterSeconds > 0)
      return failure(
        "RATE_LIMITED",
        `登录尝试过于频繁，请在 ${retryAfterSeconds} 秒后重试`,
        429,
      )

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.username, parsed.data.username))
      .limit(1)
    if (
      !user ||
      user.status !== "active" ||
      !(await verifyPassword(parsed.data.password, user.passwordHash))
    ) {
      await recordLoginFailure(parsed.data.username, ip)
      await writeLoginLog({
        username: parsed.data.username,
        success: false,
        failReason: "用户名或密码错误",
        ip,
        userAgent: request.headers.get("user-agent"),
      }).catch(() => undefined)
      return failure("UNAUTHORIZED", "用户名或密码错误", 401)
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
    const [mfaFactor] = await db
      .select({ enabled: mfaFactors.enabled })
      .from(mfaFactors)
      .where(eq(mfaFactors.userId, user.id))
      .limit(1)
    const trustedDevice = mfaFactor?.enabled
      ? await getValidTrustedDevice(
          user.id,
          request.cookies.get(MFA_TRUSTED_DEVICE_COOKIE_NAME)?.value,
        )
      : null
    if (mfaFactor?.enabled && !trustedDevice) {
      const response = success({ requiresMfa: true })
      setMfaChallengeCookie(
        response,
        await signMfaChallenge(user.id, user.tokenVersion),
      )
      return response
    }

    const token = await signToken({
      userId: user.id,
      tokenVersion: user.tokenVersion,
      role: sessionUser.role,
    })
    await clearLoginFailures(parsed.data.username, ip)
    const response = success(sessionUser)
    setAuthCookie(response, token)
    clearMfaChallengeCookie(response)
    await writeLoginLog({
      userId: user.id,
      username: user.username,
      success: true,
      ip,
      userAgent: request.headers.get("user-agent"),
    }).catch(() => undefined)
    return response
  } catch (error) {
    console.error("[API auth/login POST]", error)
    return failure("INTERNAL_ERROR", "服务器错误", 500)
  }
}
