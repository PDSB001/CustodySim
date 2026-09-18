import { eq } from "drizzle-orm"
import { randomUUID } from "node:crypto"
import { NextRequest } from "next/server"

import { success, failure } from "@/lib/api-response"
import { getRequestIp } from "@/lib/admin-api"
import {
  getDummyPasswordHash,
  signMfaChallenge,
  signToken,
  verifyPassword,
} from "@/lib/auth"
import {
  clearMfaChallengeCookie,
  setAuthCookie,
  setMfaChallengeCookie,
} from "@/lib/auth-cookie"
import { LoginSchema, SessionUserSchema } from "@/lib/auth-schemas"
import { db } from "@/lib/db"
import { mfaFactors, mfaLoginChallenges, users } from "@/lib/db/schema"
import { writeLoginLog } from "@/lib/login-log-server"
import {
  clearLoginFailures,
  getLoginRetryAfterSeconds,
  recordLoginFailure,
} from "@/lib/login-rate-limit"
import { getValidTrustedDevice } from "@/lib/mfa-server"
import {
  AUTH_TOKEN_TTL_SECONDS,
  MFA_TRUSTED_DEVICE_COOKIE_NAME,
  MFA_TRUSTED_DEVICE_HEADER,
} from "@/lib/constants"
import { isNativeClient } from "@/lib/native-client"
import { issueRefreshToken } from "@/lib/refresh-token-server"

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
    // 账号不存在或不可用时也执行一次等成本 bcrypt，消除登录时序侧信道。
    const passwordMatches = await verifyPassword(
      parsed.data.password,
      user?.passwordHash ?? (await getDummyPasswordHash()),
    )
    if (!user || user.status !== "active" || !passwordMatches) {
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
    // 浏览器把受信任设备放在 httpOnly cookie 里；原生客户端读不到 cookie，改用请求头。
    const trustedDeviceValue =
      request.cookies.get(MFA_TRUSTED_DEVICE_COOKIE_NAME)?.value ??
      request.headers.get(MFA_TRUSTED_DEVICE_HEADER)?.trim()
    const trustedDevice = mfaFactor?.enabled
      ? await getValidTrustedDevice(user.id, trustedDeviceValue)
      : null
    if (mfaFactor?.enabled && !trustedDevice) {
      const challengeId = randomUUID()
      await db
        .insert(mfaLoginChallenges)
        .values({
          id: challengeId,
          userId: user.id,
          tokenVersion: user.tokenVersion,
          expiresAt: new Date(Date.now() + 5 * 60_000),
        })
      const challengeToken = await signMfaChallenge(
        user.id,
        user.tokenVersion,
        challengeId,
      )
      // 原生客户端读不到 httpOnly cookie，挑战令牌改为在响应体里回传。
      const response = success(
        isNativeClient(request.headers)
          ? { requiresMfa: true, mfaToken: challengeToken }
          : { requiresMfa: true },
      )
      setMfaChallengeCookie(response, challengeToken)
      return response
    }

    const token = await signToken({
      userId: user.id,
      tokenVersion: user.tokenVersion,
      role: sessionUser.role,
    })
    await clearLoginFailures(parsed.data.username, ip)
    // 仅对原生客户端回传令牌：浏览器必须依赖 httpOnly cookie，避免令牌被脚本读取。
    const native = isNativeClient(request.headers)
    const refreshToken = native
      ? await issueRefreshToken({
          userId: user.id,
          tokenVersion: user.tokenVersion,
          ip,
          userAgent: request.headers.get("user-agent"),
        })
      : null
    const response = success(
      native
        ? {
            ...sessionUser,
            token,
            expiresInSeconds: AUTH_TOKEN_TTL_SECONDS,
            refreshToken,
          }
        : sessionUser,
    )
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
