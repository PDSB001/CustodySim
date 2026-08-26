import { NextRequest } from "next/server"
import { z } from "zod"

import { failure, success } from "@/lib/api-response"
import { CheckinError, reviewCheckinMakeup } from "@/lib/checkin"
import { getSessionUser } from "@/lib/session"

const Params = z.object({ id: z.string().uuid() })
const ReviewSchema = z.object({
  result: z.enum(["APPROVED", "REJECTED"]),
  comment: z.string().trim().max(1000).optional(),
})

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const actor = await getSessionUser()
  if (!actor) return failure("UNAUTHORIZED", "请先登录", 401)
  if (actor.role === "SUPERVISED")
    return failure("FORBIDDEN", "无补卡审核权限", 403)
  const params = Params.safeParse(await context.params)
  const parsed = ReviewSchema.safeParse(await request.json())
  if (!params.success || !parsed.success)
    return failure("VALIDATION_ERROR", "审核参数不合法", 400)
  try {
    await reviewCheckinMakeup({
      actor,
      makeupId: params.data.id,
      ...parsed.data,
    })
    return success({ id: params.data.id })
  } catch (error) {
    if (error instanceof CheckinError)
      return failure(
        error.status === 403
          ? "FORBIDDEN"
          : error.status === 404
            ? "NOT_FOUND"
            : "VALIDATION_ERROR",
        error.message,
        error.status,
      )
    console.error("[API makeups PATCH]", error)
    return failure("INTERNAL_ERROR", "服务器错误", 500)
  }
}
