import { NextRequest } from "next/server"
import { failure, success } from "@/lib/api-response"
import { getRequestIp } from "@/lib/admin-api"
import { RegistrationSchema } from "@/lib/registration-policy"
import {
  consumeRegistrationAttempt,
  createRegistration,
  getRegistrationSettings,
  RegistrationError,
  assertRegistrationRisk,
} from "@/lib/registration-server"
import { validatePassword } from "@/lib/password-rule"
import { signToken } from "@/lib/auth"
import { setAuthCookie } from "@/lib/auth-cookie"
import { isNativeClient } from "@/lib/native-client"
import { getTrustedOrigins } from "@/lib/request-origin"
import {
  REGISTRATION_BROWSER_COOKIE,
  registrationBrowserCookie,
  registrationRisk,
} from "@/lib/registration-browser"
import {
  registrationCaptchaConfig,
  verifyRegistrationCaptcha,
} from "@/lib/registration-captcha"

export const runtime = "nodejs"
export async function GET(request: NextRequest) {
  try {
    const cookie = registrationBrowserCookie(
      request.cookies.get(REGISTRATION_BROWSER_COOKIE)?.value,
    )
    const response = success({
      enabled: (await getRegistrationSettings()).enabled,
      captcha: {
        ...registrationCaptchaConfig(),
        cData: registrationRisk(cookie, null)!.deviceHash,
      },
    })
    response.cookies.set(REGISTRATION_BROWSER_COOKIE, cookie, {
      httpOnly: true,
      sameSite: "strict",
      path: "/api/auth/register",
      maxAge: 180 * 86400,
      secure:
        process.env.AUTH_COOKIE_SECURE === "false"
          ? false
          : process.env.AUTH_COOKIE_SECURE === "true" ||
            process.env.NODE_ENV === "production",
    })
    return response
  } catch {
    return failure("INTERNAL_ERROR", "注册服务暂不可用", 503)
  }
}
async function registrationBody(request: Request) {
  const reader = request.body?.getReader()
  if (!reader) return null
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > 16_000) {
        await reader.cancel()
        return null
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"))
  } catch {
    return null
  }
}
export async function POST(request: NextRequest) {
  if (
    isNativeClient(request.headers) ||
    !getTrustedOrigins(request).includes(request.headers.get("origin") ?? "")
  )
    return failure("FORBIDDEN", "请通过网站注册页面提交", 403)
  try {
    if (!registrationCaptchaConfig().ready)
      return failure("INTERNAL_ERROR", "注册人机验证尚未配置，请稍后再试", 503)
    const ip = getRequestIp(request.headers)
    const retry = await consumeRegistrationAttempt(ip)
    if (retry) {
      const response = failure(
        "RATE_LIMITED",
        "注册尝试过于频繁，请稍后重试",
        429,
      )
      response.headers.set("Retry-After", String(retry))
      return response
    }
    const input = RegistrationSchema.safeParse(await registrationBody(request))
    if (!input.success)
      return failure(
        "VALIDATION_ERROR",
        "请检查注册信息、密码确认及考察规则确认",
        400,
      )
    const password = validatePassword(input.data.password)
    if (!password.valid)
      return failure("VALIDATION_ERROR", password.errors.join("；"), 400)
    const risk = registrationRisk(
      request.cookies.get(REGISTRATION_BROWSER_COOKIE)?.value,
      ip,
    )
    if (!risk) return failure("FORBIDDEN", "请刷新注册页后完成人机验证", 403)
    await assertRegistrationRisk(risk)
    const verification = await verifyRegistrationCaptcha({
      token: input.data.captchaToken,
      hostname: new URL(request.headers.get("origin")!).hostname,
      deviceHash: risk.deviceHash,
      ip,
    })
    if (verification === "UNAVAILABLE")
      return failure("INTERNAL_ERROR", "人机验证服务暂不可用，请稍后重试", 503)
    if (verification !== "VALID")
      return failure("FORBIDDEN", "人机验证无效或已过期，请重新验证", 403)
    const created = await createRegistration(input.data, new Date(), risk)
    const response = success(
      {
        id: created.id,
        trialStart: created.trialStart,
        trialEnd: created.trialEnd,
      },
      { status: 201 },
    )
    setAuthCookie(
      response,
      await signToken({
        userId: created.id,
        tokenVersion: 0,
        role: "SUPERVISED",
      }),
    )
    return response
  } catch (error) {
    if (error instanceof RegistrationError) {
      const response = failure(
        error.status === 409
          ? "CONFLICT"
          : error.status === 429
            ? "RATE_LIMITED"
            : error.status === 403
              ? "FORBIDDEN"
              : error.status === 503
                ? "INTERNAL_ERROR"
                : "VALIDATION_ERROR",
        error.message,
        error.status,
      )
      if (error.retryAfter)
        response.headers.set("Retry-After", String(error.retryAfter))
      return response
    }
    const cause = error as { code?: string; cause?: { code?: string } }
    if (cause?.code === "23505" || cause?.cause?.code === "23505")
      return failure("CONFLICT", "用户名或邮箱不可用", 409)
    console.error("[registration] signup failed")
    return failure("INTERNAL_ERROR", "注册未完成，请稍后重试", 500)
  }
}
