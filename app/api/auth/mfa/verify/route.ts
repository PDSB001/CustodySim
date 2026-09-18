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
import { writeLoginLog } from "@/lib/login-log-server"
import {
  clearLoginFailures,
  getLoginRetryAfterSeconds,
  recordLoginFailure,
} from "@/lib/login-rate-limit"
import { consumeMfaLogin } from "@/lib/mfa-login-server"
import { AUTH_TOKEN_TTL_SECONDS, MFA_CHALLENGE_COOKIE_NAME } from "@/lib/constants"
import { isNativeClient } from "@/lib/native-client"
import { issueRefreshToken } from "@/lib/refresh-token-server"

export const runtime = "nodejs"

export async function POST(request: NextRequest) {
  try {
    // 先解析请求体：原生客户端把挑战令牌放在 body 里，需要先拿到才能校验。
    const parsed = MfaVerificationSchema.safeParse(await request.json())
    if (!parsed.success)
      return failure("VALIDATION_ERROR", "请输入验证器代码或恢复码", 400)
    // 浏览器走 httpOnly cookie；原生客户端读不到 cookie，改用请求体里的令牌。
    const challenge = await verifyMfaChallenge(
      parsed.data.mfaToken ??
        request.cookies.get(MFA_CHALLENGE_COOKIE_NAME)?.value ??
        "",
    )
    if (!challenge)
      return failure("UNAUTHORIZED", "验证已过期，请重新登录", 401)

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

    const verification = await consumeMfaLogin(
      challenge,
      parsed.data.code,
      parsed.data.trustDevice,
      ip,
    )
    if (!verification) {
      await recordLoginFailure(`mfa:${challenge.userId}`, ip)
      return failure(
        "VALIDATION_ERROR",
        "验证代码不正确、已使用或登录挑战已过期",
        400,
      )
    }
    const { user, deviceToken: trustedDeviceToken } = verification
    const sessionUser = SessionUserSchema.parse(user)
    const signedToken = await signToken({
      userId: user.id,
      tokenVersion: user.tokenVersion,
      role: sessionUser.role,
    })
    const trustedDeviceValue =
      trustedDeviceToken && verification.deviceId
        ? `${verification.deviceId}.${trustedDeviceToken}`
        : null
    // 仅对原生客户端回传令牌与受信任设备（浏览器依赖 httpOnly cookie）。
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
            token: signedToken,
            expiresInSeconds: AUTH_TOKEN_TTL_SECONDS,
            refreshToken,
            ...(trustedDeviceValue ? { trustedDevice: trustedDeviceValue } : {}),
          }
        : sessionUser,
    )
    setAuthCookie(response, signedToken)
    clearMfaChallengeCookie(response)
    if (trustedDeviceValue)
      setMfaTrustedDeviceCookie(response, trustedDeviceValue)
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
