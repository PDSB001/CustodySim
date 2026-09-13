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
import { MFA_CHALLENGE_COOKIE_NAME } from "@/lib/constants"

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
