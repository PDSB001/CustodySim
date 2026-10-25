import { z } from "zod"
import { failure, success } from "@/lib/api-response"
import { getSessionUser } from "@/lib/session"
import { deviceRealtimeToken } from "@/lib/push-server"

const Input = z.object({
  deviceId: z.string().uuid(),
  secret: z.string().regex(/^[a-f0-9]{64}$/),
})
export async function POST(request: Request) {
  const actor = await getSessionUser()
  if (!actor) return failure("UNAUTHORIZED", "请先登录", 401)
  const parsed = Input.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return failure("VALIDATION_ERROR", "设备参数不合法", 400)
  try {
    const token = await deviceRealtimeToken(
      actor.id,
      parsed.data.deviceId,
      parsed.data.secret,
    )
    return token
      ? success({ token, expiresInSeconds: 300 })
      : failure("FORBIDDEN", "通知设备未绑定或凭证失效", 403)
  } catch {
    return failure("INTERNAL_ERROR", "创建通知连接凭证失败", 500)
  }
}
