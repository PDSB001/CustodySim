import { failure, success } from "@/lib/api-response"
import { getHomeOverview } from "@/lib/home-overview"
import { getSessionUser } from "@/lib/session"

export async function GET() {
  const actor = await getSessionUser()
  if (!actor) return failure("UNAUTHORIZED", "请先登录", 401)
  try {
    return success(await getHomeOverview(actor))
  } catch (error) {
    console.error("[API my/overview GET]", error)
    return failure("INTERNAL_ERROR", "暂时无法读取信息概览", 500)
  }
}
