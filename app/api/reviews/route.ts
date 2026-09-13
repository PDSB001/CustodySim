import { NextRequest } from "next/server"
import { z } from "zod"
import { failure, success } from "@/lib/api-response"
import { getSessionUser } from "@/lib/session"
import { applyTaskReview, ReviewConflictError } from "@/lib/task-review"
const ReviewSchema = z.object({
  submissionId: z.string().uuid(),
  result: z.enum(["APPROVED", "RETURNED"]),
  grade: z.coerce.number().int().min(0).max(100).nullable().optional(),
  comment: z.string().trim().max(2000).nullable().optional(),
})
export async function POST(request: NextRequest) {
  const actor = await getSessionUser()
  if (!actor) return failure("UNAUTHORIZED", "请先登录", 401)
  if (actor.role === "SUPERVISED")
    return failure("FORBIDDEN", "无审核权限", 403)
  const parsed = ReviewSchema.safeParse(await request.json())
  if (!parsed.success) return failure("VALIDATION_ERROR", "审核参数不合法", 400)
  try {
    return success(await applyTaskReview(actor, parsed.data), { status: 201 })
  } catch (error) {
    if (error instanceof ReviewConflictError) {
      const forbidden = error.message === "不在监管范围内"
      return failure(
        forbidden ? "FORBIDDEN" : "CONFLICT",
        error.message || "任务已由其他请求处理",
        forbidden ? 403 : 409,
      )
    }
    throw error
  }
}
