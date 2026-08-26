import { failure, success } from "@/lib/api-response"
import { getSupervisionCheckins } from "@/lib/checkin"
import { getSessionUser } from "@/lib/session"

export async function GET() {
  const actor = await getSessionUser()
  if (!actor) return failure("UNAUTHORIZED", "请先登录", 401)
  if (actor.role === "SUPERVISED")
    return failure("FORBIDDEN", "无监管查看权限", 403)
  try {
    return success(await getSupervisionCheckins(actor))
  } catch (error) {
    console.error("[API supervision/checkins GET]", error)
    return failure("INTERNAL_ERROR", "服务器错误", 500)
  }
}
