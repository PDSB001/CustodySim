import { NextRequest } from "next/server"
import { z } from "zod"

import { failure, success } from "@/lib/api-response"
import { getRequestIp } from "@/lib/admin-api"
import { signToken } from "@/lib/auth"
import { SessionUserSchema } from "@/lib/auth-schemas"
import { AUTH_TOKEN_TTL_SECONDS } from "@/lib/constants"
import { isNativeClient } from "@/lib/native-client"
import { rotateRefreshToken } from "@/lib/refresh-token-server"

export const runtime = "nodejs"

const RefreshSchema = z.object({
  refreshToken: z.string().min(20).max(200),
})

/**
 * 用长期刷新令牌换取新的访问令牌（仅原生客户端）。
 *
 * 访问令牌只有 8 小时，专用终端不可能每班重新输密码；这里用可即时吊销的刷新
 * 令牌续期。响应体里回传新的刷新令牌（每次轮换），旧的那枚立即作废。
 *
 * 不接受浏览器调用：该接口把令牌放在响应体里，浏览器一旦存在 XSS 就能读到，
 * 而浏览器路径本来有 httpOnly cookie 保护，不需要也不应该走这里。
 */
export async function POST(request: NextRequest) {
  if (!isNativeClient(request.headers))
    return failure("FORBIDDEN", "该接口仅供原生客户端使用", 403)
  const parsed = RefreshSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return failure("VALIDATION_ERROR", "刷新参数不合法", 400)
  try {
    const rotated = await rotateRefreshToken(parsed.data.refreshToken, {
      ip: getRequestIp(request.headers),
      userAgent: request.headers.get("user-agent"),
    })
    if (!rotated)
      return failure("UNAUTHORIZED", "登录已过期，请重新登录", 401)
    const sessionUser = SessionUserSchema.parse(rotated.user)
    return success({
      ...sessionUser,
      token: await signToken({
        userId: rotated.user.id,
        tokenVersion: rotated.user.tokenVersion,
        role: sessionUser.role,
      }),
      expiresInSeconds: AUTH_TOKEN_TTL_SECONDS,
      refreshToken: rotated.refreshToken,
    })
  } catch (error) {
    console.error("[API auth/refresh POST]", error)
    return failure("INTERNAL_ERROR", "服务器错误", 500)
  }
}
