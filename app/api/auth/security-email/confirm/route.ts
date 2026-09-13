import { z } from "zod"
import { failure, success } from "@/lib/api-response"
import { getRequestIp } from "@/lib/admin-api"
import {
  clearAuthCookie,
  clearMfaChallengeCookie,
  clearMfaTrustedDeviceCookie,
} from "@/lib/auth-cookie"
import {
  confirmEmailBinding,
  EmailSecurityError,
} from "@/lib/security-mail-server"
import { getSessionUser } from "@/lib/session"

const Input = z
  .object({ challengeId: z.string().uuid(), code: z.string().regex(/^\d{6}$/) })
  .strict()
export async function POST(request: Request) {
  const user = await getSessionUser()
  if (!user) return failure("UNAUTHORIZED", "请先登录", 401)
  const parsed = Input.safeParse(await request.json().catch(() => null))
  if (!parsed.success)
    return failure("VALIDATION_ERROR", "请输入 6 位邮箱验证码", 400)
  try {
    await confirmEmailBinding(
      user,
      parsed.data.challengeId,
      parsed.data.code,
      getRequestIp(request.headers) ?? "unknown",
    )
    const response = success({ verified: true, requiresLogin: true })
    clearAuthCookie(response)
    clearMfaChallengeCookie(response)
    clearMfaTrustedDeviceCookie(response)
    return response
  } catch (error) {
    if (error instanceof EmailSecurityError)
      return failure(
        error.status === 429 ? "RATE_LIMITED" : "VALIDATION_ERROR",
        error.message,
        error.status,
      )
    return failure("INTERNAL_ERROR", "邮箱验证失败", 500)
  }
}
