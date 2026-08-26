import { failure, success } from "@/lib/api-response"
import { SessionUserSchema } from "@/lib/auth-schemas"
import { getSessionUser } from "@/lib/session"

export async function GET() {
  try {
    const user = await getSessionUser()
    if (!user) return failure("UNAUTHORIZED", "未登录", 401)
    return success(SessionUserSchema.parse(user))
  } catch (error) {
    console.error("[API me GET]", error)
    return failure("INTERNAL_ERROR", "服务器错误", 500)
  }
}
