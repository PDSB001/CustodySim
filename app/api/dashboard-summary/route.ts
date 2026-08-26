import { failure, success } from "@/lib/api-response"
import { getDashboardSummary } from "@/lib/dashboard"
import { getSessionUser } from "@/lib/session"

export async function GET() {
  const actor = await getSessionUser()
  if (!actor) return failure("UNAUTHORIZED", "请先登录", 401)
  try {
    return success(await getDashboardSummary(actor))
  } catch (error) {
    console.error("[API dashboard-summary GET]", error)
    return failure("INTERNAL_ERROR", "服务器错误", 500)
  }
}
